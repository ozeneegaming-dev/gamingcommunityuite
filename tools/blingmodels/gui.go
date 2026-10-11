package main

import (
	"bytes"
	"crypto/rand"
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"blingmodels/internal/convert"
	"blingmodels/internal/mdl"
	"blingmodels/internal/preview"
	"blingmodels/internal/vmath"
)

//go:embed gui.html
var guiPage string

// runGUI serves the drag & drop window on 127.0.0.1 and opens it in the default browser. Conversions run on this
// computer; nothing leaves it.
func runGUI(o *options, initial []string) error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	tokenBytes := make([]byte, 16)
	rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)
	host := ln.Addr().String()
	outDir := guiOutDir(o)

	var mu sync.Mutex // one conversion at a time (the log writer is shared)
	mux := http.NewServeMux()
	// Only this window may talk to the server: same Host (no DNS rebinding) and the per-run token on every action.
	guard := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Host != host {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			if r.URL.Path != "/" && r.Header.Get("X-Token") != token && r.URL.Query().Get("t") != token {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			h(w, r)
		}
	}
	registerExtra(mux, guard, outDir, &mu)
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		hasInitial := "0"
		if len(initial) > 0 {
			hasInitial = "1"
		}
		page := strings.NewReplacer("{{TOKEN}}", token, "{{VERSION}}", version, "{{OUTDIR}}", htmlEscape(outDir), "{{INITIAL}}", hasInitial).Replace(guiPage)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, page)
	}))
	mux.HandleFunc("/convert", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", http.StatusMethodNotAllowed)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		res := guiConvert(o, outDir, r)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}))
	// Files dropped on the exe in Explorer: converted once, when the window asks.
	var initialOnce sync.Once
	mux.HandleFunc("/initial", guard(func(w http.ResponseWriter, r *http.Request) {
		res := guiResult{}
		initialOnce.Do(func() {
			mu.Lock()
			defer mu.Unlock()
			o2 := *o
			o2.out, o2.noPause = outDir, true
			cfg := loadConfig()
			setupAI(boolOr(cfg.AIAuto, true), boolOr(cfg.AIReview, true))
			res = guiRun(&o2, outDir, initial)
		})
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}))
	// The window pings while it is open; when it closes, the program ends.
	alive := make(chan bool, 8)
	mux.HandleFunc("/ping", guard(func(w http.ResponseWriter, r *http.Request) {
		select {
		case alive <- r.URL.Query().Get("bye") == "1":
		default:
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	go watchWindow(alive)
	mux.HandleFunc("/file", guard(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Clean(r.URL.Query().Get("p"))
		rel, err := filepath.Rel(outDir, p)
		if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.URL.Query().Get("dl") == "1" {
			w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(p)+"\"")
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, p)
	}))
	mux.HandleFunc("/mesh", guard(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Clean(r.URL.Query().Get("p"))
		if rel, err := filepath.Rel(outDir, p); err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		seq, _ := strconv.Atoi(r.URL.Query().Get("seq"))
		md, err := meshData(p, seq)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(md)
	}))
	mux.HandleFunc("/open", guard(func(w http.ResponseWriter, r *http.Request) {
		dir := outDir
		if p := r.URL.Query().Get("p"); p != "" {
			if rel, err := filepath.Rel(outDir, filepath.Clean(p)); err == nil && !strings.HasPrefix(rel, "..") {
				dir = filepath.Dir(filepath.Clean(p))
			}
		}
		os.MkdirAll(dir, 0o755)
		openPath(dir)
		w.WriteHeader(http.StatusNoContent)
	}))

	url := "http://" + host + "/"
	fmt.Fprintln(out, "Fereastra blingmodels:", url)
	fmt.Fprintln(out, "Modelele convertite ajung în:", outDir)
	openAppWindow(url)
	return http.Serve(ln, mux)
}

// watchWindow ends the program once the window is gone: it said goodbye and did not come back (a reload pings again
// at once), or it stopped pinging (closed browser, crash). Background windows ping at least once a minute.
func watchWindow(alive <-chan bool) {
	first := time.NewTimer(3 * time.Minute)
	select {
	case <-alive:
	case <-first.C:
		os.Exit(0) // the window never opened
	}
	for {
		timeout := 150 * time.Second
		select {
		case bye := <-alive:
			if !bye {
				continue
			}
			timeout = 4 * time.Second
		case <-time.After(timeout):
			os.Exit(0)
		}
		select {
		case bye := <-alive:
			if bye {
				continue
			}
		case <-time.After(timeout):
			os.Exit(0)
		}
	}
}

// openAppWindow opens the page as its own window, without tabs or address bar (Edge or Chrome "app" mode, with a
// separate profile so it does not mix with the user's browsing); otherwise in the default browser.
func openAppWindow(url string) {
	if runtime.GOOS == "windows" {
		var cands []string
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
			root := os.Getenv(env)
			if root == "" {
				continue
			}
			cands = append(cands,
				filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"),
				filepath.Join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"))
		}
		profile := filepath.Join(os.TempDir(), "blingmodels-window")
		if dir, err := os.UserCacheDir(); err == nil {
			profile = filepath.Join(dir, "blingmodels", "window")
		}
		for _, c := range cands {
			if !fileExists(c) {
				continue
			}
			cmd := exec.Command(c, "--app="+url, "--user-data-dir="+profile, "--window-size=1060,920",
				"--no-first-run", "--no-default-browser-check", "--disable-extensions")
			if cmd.Start() == nil {
				return
			}
		}
	}
	openPath(url)
}

// guiOutDir: blingmodels_out next to the exe, or in Documents when that folder is read-only (Program Files).
func guiOutDir(o *options) string {
	if o.out != "" {
		abs, _ := filepath.Abs(o.out)
		return abs
	}
	var cands []string
	if exe, err := os.Executable(); err == nil {
		cands = append(cands, filepath.Join(filepath.Dir(exe), "blingmodels_out"))
	}
	if home, err := os.UserHomeDir(); err == nil {
		cands = append(cands, filepath.Join(home, "Documents", "blingmodels_out"), filepath.Join(home, "blingmodels_out"))
	}
	for _, c := range cands {
		if os.MkdirAll(c, 0o755) == nil {
			probe := filepath.Join(c, ".write-test")
			if os.WriteFile(probe, nil, 0o644) == nil {
				os.Remove(probe)
				return c
			}
		}
	}
	return filepath.Join(os.TempDir(), "blingmodels_out")
}

func openPath(target string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		if strings.HasPrefix(target, "http") {
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
		} else {
			cmd = exec.Command("explorer", target)
		}
	case "darwin":
		cmd = exec.Command("open", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	cmd.Start()
}

type guiResult struct {
	OK      bool        `json:"ok"`
	Log     string      `json:"log"`
	Outputs []guiOutput `json:"outputs"`
}

type guiOutput struct {
	Name    string   `json:"name"`
	Path    string   `json:"path"`
	Preview string   `json:"preview,omitempty"`
	Size    int64    `json:"size"`
	Hint    string   `json:"hint"`
	Tris    int      `json:"tris"`
	Verts   int      `json:"verts"`
	Bones   int      `json:"bones"`
	Texts   int      `json:"textures"`
	Seqs    []string `json:"seqs"`
	Kind    string   `json:"kind"`
	Rel     string   `json:"rel"` // path under cstrike/models
}

// guiConvert saves the uploaded files (keeping their names, so a .gltf finds its .bin and textures) and runs the same
// conversion as drag & drop on the exe.
func guiConvert(base *options, outDir string, r *http.Request) guiResult {
	fail := func(msg string) guiResult {
		fmt.Fprintln(out, "EROARE:", msg)
		return guiResult{Log: "EROARE: " + msg}
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		return fail("încărcarea fișierelor a eșuat: " + err.Error())
	}
	defer r.MultipartForm.RemoveAll()
	dir, err := os.MkdirTemp("", "blingmodels-in-")
	if err != nil {
		return fail(err.Error())
	}
	defer os.RemoveAll(dir)

	var inputs []string
	for _, fh := range r.MultipartForm.File["files"] {
		// The browser sends folder-relative names for dropped folders ("model/textures/a.png").
		rel := filepath.Clean(filepath.FromSlash(strings.ReplaceAll(fh.Filename, "\\", "/")))
		if rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) || strings.Contains(rel, ":") {
			rel = filepath.Base(rel)
		}
		dst := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return fail(err.Error())
		}
		src, err := fh.Open()
		if err != nil {
			return fail(err.Error())
		}
		w, err := os.Create(dst)
		if err == nil {
			_, err = io.Copy(w, src)
			w.Close()
		}
		src.Close()
		if err != nil {
			return fail(err.Error())
		}
		if isModelFile(dst) {
			inputs = append(inputs, dst)
		}
	}
	if len(inputs) == 0 {
		return fail("nu ai adăugat niciun model (.glb, .gltf, .zip de pe Sketchfab, .blend, .usdz…)")
	}

	o := *base
	o.out = outDir
	o.noPause = true
	f := r.FormValue
	if v := f("mode"); v != "" {
		o.mode = v
	}
	o.rotate = f("rotate")
	o.noFit = f("nofit") == "1"
	o.keep = f("keep")
	o.anims = f("anims") != "0"
	o.double = f("double") == "1"
	if v, err := strconv.Atoi(f("maxtris")); err == nil && v > 0 {
		o.maxTris = v
	}
	if v, err := strconv.ParseFloat(strings.ReplaceAll(f("height"), ",", "."), 64); err == nil && v > 0 {
		o.height = v
	}
	if v := f("name"); v != "" {
		o.name = v
	}
	o.genanim = f("genanim")
	o.flip = f("flip")
	if ref := f("ref"); ref != "" {
		low := strings.ToLower(ref)
		if fileExists(ref) && (strings.HasSuffix(low, ".mdl") || strings.HasSuffix(low, ".mdl"+backupSuffix)) {
			o.donor = ref
		}
	}
	setupAI(f("ai") == "1", f("review") == "1")
	return guiRun(&o, outDir, inputs)
}

// guiRun converts and describes the written files for the window.
func guiRun(o *options, outDir string, inputs []string) guiResult {
	var logBuf bytes.Buffer
	prev := out
	out = io.MultiWriter(&logBuf, prev)
	defer func() { out = prev }()
	failed, written := run(o, inputs)
	res := guiResult{OK: failed == 0 && len(written) > 0}
	for _, p := range written {
		g := guiOutput{Name: filepath.Base(p), Path: p}
		if st, err := os.Stat(p); err == nil {
			g.Size = st.Size()
		}
		if pv := strings.TrimSuffix(p, ".mdl") + "_preview.png"; fileExists(pv) {
			g.Preview = pv
		}
		if rel, err := filepath.Rel(outDir, p); err == nil {
			g.Rel = filepath.ToSlash(rel)
		}
		if rel, err := filepath.Rel(outDir, p); err == nil && strings.HasPrefix(filepath.ToSlash(rel), "player/") {
			g.Hint = `cstrike\models\` + rel
		} else {
			g.Hint = `cstrike\models\` + g.Name
		}
		if data, err := os.ReadFile(p); err == nil {
			if m, err := mdl.Decode(data, nil); err == nil {
				g.Bones, g.Texts = len(m.Bones), len(m.Textures)
				for _, sq := range m.Sequences {
					g.Seqs = append(g.Seqs, sq.Label)
				}
				for _, bp := range m.BodyParts {
					for _, sm := range bp.Models {
						g.Verts += len(sm.Verts)
						for _, me := range sm.Meshes {
							g.Tris += int(me.NumTris)
						}
					}
				}
			}
		}
		g.Kind = modeLabel(lastMode, lastDonor)
		res.Outputs = append(res.Outputs, g)
	}
	res.Log = logBuf.String()
	return res
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

type meshGroup struct {
	Tex   int `json:"tex"`
	First int `json:"first"` // first corner
	Count int `json:"count"` // corners
}

type meshJSON struct {
	Textures []string    `json:"textures"` // PNG data URLs
	Groups   []meshGroup `json:"groups"`
	UV       string      `json:"uv"`      // base64 float32 (s, t) per corner, 0..1
	Normals  string      `json:"normals"` // base64 float32, reference pose
	Frames   []string    `json:"frames"`  // base64 float32 positions per corner, per frame
	FPS      float64     `json:"fps"`
	Center   [3]float64  `json:"center"`
	Radius   float64     `json:"radius"`
}

// meshData poses the model the way the engine does (every frame of one sequence, capped in size) for the window's
// 3D view.
func meshData(path string, seq int) (*meshJSON, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	m, err := mdl.Decode(data, nil)
	if err != nil {
		return nil, err
	}
	if seq < 0 || seq >= len(m.Sequences) {
		seq = 0
	}
	tris := convert.DonorTris(m, convert.DonorBoneWorld(m))
	sort.SliceStable(tris, func(a, b int) bool { return tris[a].Mat < tris[b].Mat })
	md := &meshJSON{FPS: 30}
	for _, t := range m.Textures {
		img := image.NewNRGBA(image.Rect(0, 0, t.Width, t.Height))
		for i, idx := range t.Pixels {
			a := uint8(255)
			if t.Flags&mdl.TexMasked != 0 && idx == 255 {
				a = 0
			}
			pal := t.Palette[int(idx)*3:]
			img.Pix[i*4], img.Pix[i*4+1], img.Pix[i*4+2], img.Pix[i*4+3] = pal[0], pal[1], pal[2], a
		}
		var buf bytes.Buffer
		png.Encode(&buf, img)
		md.Textures = append(md.Textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(buf.Bytes()))
	}
	var uv, nrm []float32
	for i, t := range tris {
		if len(md.Groups) == 0 || md.Groups[len(md.Groups)-1].Tex != t.Mat {
			md.Groups = append(md.Groups, meshGroup{Tex: t.Mat, First: i * 3})
		}
		md.Groups[len(md.Groups)-1].Count += 3
		tw, th := float32(m.Textures[t.Mat].Width), float32(m.Textures[t.Mat].Height)
		for k := 0; k < 3; k++ {
			uv = append(uv, float32(t.ST[k][0])/tw, float32(t.ST[k][1])/th)
			n := t.C[k].Normal
			nrm = append(nrm, float32(n[0]), float32(n[1]), float32(n[2]))
		}
	}
	md.UV, md.Normals = f32base64(uv), f32base64(nrm)

	// Frames: the corners posed per frame; at most ~24 MB of positions in total.
	nframes := 1
	if sq := m.Sequences[seq]; sq.NumFrames > 1 {
		nframes = int(sq.NumFrames)
		if sq.FPS > 0 {
			md.FPS = float64(sq.FPS)
		}
	}
	step := 1
	for nframes/step > 1 && len(tris)*9*4*(nframes/step) > 24<<20 {
		step++
	}
	md.FPS /= float64(step)
	mn := vmath.Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx := mn.Scale(-1)
	for f := 0; f < nframes; f += step {
		posed := convert.DonorTris(m, preview.Pose(m, seq, f))
		sort.SliceStable(posed, func(a, b int) bool { return posed[a].Mat < posed[b].Mat })
		pos := make([]float32, 0, len(posed)*9)
		for _, t := range posed {
			for _, c := range t.C {
				pos = append(pos, float32(c.Pos[0]), float32(c.Pos[1]), float32(c.Pos[2]))
				if f == 0 {
					mn, mx = mn.Min(c.Pos), mx.Max(c.Pos)
				}
			}
		}
		md.Frames = append(md.Frames, f32base64(pos))
	}
	c := mn.Add(mx).Scale(0.5)
	md.Center = [3]float64{c[0], c[1], c[2]}
	md.Radius = math.Max(1, mx.Sub(mn).Len()/2)
	return md, nil
}

func f32base64(v []float32) string {
	b := make([]byte, len(v)*4)
	for i, f := range v {
		binary.LittleEndian.PutUint32(b[i*4:], math.Float32bits(f))
	}
	return base64.StdEncoding.EncodeToString(b)
}
