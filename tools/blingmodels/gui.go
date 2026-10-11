package main

import (
	"bytes"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

//go:embed gui.html
var guiPage string

// runGUI serves the drag & drop window on 127.0.0.1 and opens it in the default browser. Conversions run on this
// computer; nothing leaves it.
func runGUI(o *options) error {
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
	mux.HandleFunc("/", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		page := strings.NewReplacer("{{TOKEN}}", token, "{{VERSION}}", version, "{{OUTDIR}}", htmlEscape(outDir)).Replace(guiPage)
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
	fmt.Fprintln(out, "Fereastra blingmodels s-a deschis în browser:")
	fmt.Fprintln(out, " ", url)
	fmt.Fprintln(out, "\nModelele convertite ajung în:", outDir)
	fmt.Fprintln(out, "\nNu închide acest terminal cât lucrezi; închide-l când ai terminat.")
	openPath(url)
	return http.Serve(ln, mux)
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
	Name    string `json:"name"`
	Path    string `json:"path"`
	Preview string `json:"preview,omitempty"`
	Size    int64  `json:"size"`
	Hint    string `json:"hint"`
}

// guiConvert saves the uploaded files (keeping their names, so a .gltf finds its .bin and textures) and runs the same
// conversion as drag & drop on the exe.
func guiConvert(base *options, outDir string, r *http.Request) guiResult {
	var logBuf bytes.Buffer
	prev := out
	out = io.MultiWriter(&logBuf, os.Stdout)
	defer func() { out = prev }()

	fail := func(msg string) guiResult {
		fmt.Fprintln(out, "EROARE:", msg)
		return guiResult{Log: logBuf.String()}
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
	if v, err := strconv.Atoi(f("maxtris")); err == nil && v > 0 {
		o.maxTris = v
	}
	if v, err := strconv.ParseFloat(strings.ReplaceAll(f("height"), ",", "."), 64); err == nil && v > 0 {
		o.height = v
	}
	if v := f("name"); v != "" {
		o.name = v
	}
	failed, written := run(&o, inputs)
	res := guiResult{OK: failed == 0 && len(written) > 0}
	for _, p := range written {
		g := guiOutput{Name: filepath.Base(p), Path: p}
		if st, err := os.Stat(p); err == nil {
			g.Size = st.Size()
		}
		if pv := strings.TrimSuffix(p, ".mdl") + "_preview.png"; fileExists(pv) {
			g.Preview = pv
		}
		if rel, err := filepath.Rel(outDir, p); err == nil && strings.HasPrefix(filepath.ToSlash(rel), "player/") {
			g.Hint = `cstrike\models\` + rel
		} else {
			g.Hint = `cstrike\models\` + g.Name
		}
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
