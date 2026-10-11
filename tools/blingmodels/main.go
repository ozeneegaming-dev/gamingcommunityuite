// blingmodels converts Sketchfab downloads (GLB, glTF, and .blend/.fbx/.obj/.usdz through Blender) into Counter-Strike
// 1.6 models (GoldSrc .mdl version 10). Drag the files onto blingmodels.exe; drop an original CS model (.mdl) together
// with them to make a player, v_, p_ or w_ model that keeps all of the original's animations.
package main

import (
	"archive/zip"
	"bufio"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"blingmodels/internal/convert"
	"blingmodels/internal/gltf"
	"blingmodels/internal/mdl"
	"blingmodels/internal/preview"
	"blingmodels/internal/vmath"
)

const version = "1.0.0"

type options struct {
	mode, donor, name, out, blender, origin, keep, rotate string
	scale, height, size, fps                              float64
	maxTris, tex, maxFPS                                  int
	anims, noPause, preview, noFit, console, double       bool
	genanim                                               string
	useAI                                                 bool
	flip                                                  string
	aiRot                                                 *vmath.Mat3 // orientation chosen by the AI (kept for a retry)
	postRotate                                            string      // AI review correction, applied last
}

var boolFlags = map[string]bool{"anims": true, "nopause": true, "preview": true, "nofit": true, "console": true, "double": true, "ai": true}

// lastMode/lastDonor describe the latest conversion (shown in the window).
var (
	lastMode  string
	lastDonor bool
)

// out receives all messages (the console, or the window's log).
var out io.Writer = os.Stdout

func main() {
	o, inputs, err := parseArgs(os.Args[1:])
	if err != nil {
		if !hasConsole {
			showError("blingmodels: " + err.Error())
			os.Exit(2)
		}
		fmt.Fprintln(out, "Eroare:", err)
		pause(o)
		os.Exit(2)
	}
	if !hasConsole {
		o.noPause = true
	}
	fmt.Fprintf(out, "blingmodels %s — modele Sketchfab → Counter-Strike 1.6 (.mdl)\n\n", version)
	// Double-click, or files dropped on the exe in Explorer: the app window opens (with those files converted).
	// From a command prompt with files: plain console conversion.
	if len(inputs) == 0 && o.console {
		usage()
		pause(o)
		return
	}
	if len(inputs) == 0 || !hasConsole {
		if err := runGUI(o, inputs); err != nil {
			if !hasConsole {
				showError("blingmodels nu a putut deschide fereastra: " + err.Error())
				os.Exit(1)
			}
			fmt.Fprintln(out, "Nu am putut deschide fereastra:", err)
			usage()
			pause(o)
		}
		return
	}
	if o.useAI {
		setupAI(true, true)
		if aiNow.client == nil {
			fmt.Fprintln(out, "AI indisponibil: instalează Claude Code sau pune cheia API în Setări (fereastra programului).")
		}
	} else {
		setupAI(false, false) // still lists the game's reference models
	}
	failed, _ := run(o, inputs)
	pause(o)
	if failed > 0 {
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(out, `Cum se folosește:
  • Dublu-click pe blingmodels.exe deschide fereastra cu drag & drop (în browser).
  • Sau trage fișierul descărcat de pe Sketchfab (.glb, .gltf, .zip, .blend, .usdz…) peste blingmodels.exe.
  • Obiect / decor (prop): trage doar modelul → iese un .mdl gata de pus în cstrike/models.
  • Armă sau jucător: trage modelul nou ÎMPREUNĂ cu modelul original din CS pe care îl înlocuiești
      v_ak47.mdl  → armă la persoana întâi (mâinile originale rămân, animațiile rămân)
      p_ak47.mdl  → arma din mâna celorlalți jucători
      w_ak47.mdl  → arma de pe jos
      gign.mdl (+ gignT.mdl) → model de jucător (toate animațiile originale)
  • .blend / .fbx / .obj / .usdz au nevoie de Blender instalat (gratuit, blender.org).

Opțiuni (pot fi puse și în blingmodels.ini lângă exe, ca nume=valoare):
  -mode auto|prop|player|v|p|w   ce fel de model (auto = după numele modelului original)
  -donor fișier.mdl              modelul original din CS (în loc să-l tragi)
  -name nume                     numele fișierului rezultat
  -out folder                    unde se scrie (implicit blingmodels_out lângă fișier)
  -scale 39.37                   unități de joc pe metru (1 m = 39.37)
  -height N                      înălțimea finală în unități (decor; jucătorul ia înălțimea originalului)
  -size N                        lungimea cea mai mare în unități (w_ fără original: implicit 30)
  -rotate "x y z"                rotire în grade înainte de potrivire (ex. "0 0 90")
  -nofit                         armele nu se rotesc automat peste cea veche (doar mărime și poziție)
  -keep regex                    v_: ce păstrez din original (nume de oase/texturi), implicit mâinile
  -maxtris N                     triunghiuri maxime (implicit: decor 12000, jucător 6000, v_ 8000, p_/w_ 3000)
  -tex 512                       latura maximă a texturilor (putere a lui 2, maxim 512)
  -origin floor|center|keep      unde e originea la decor (implicit floor = pe sol)
  -anims=false                   fără animații la decor
  -fps 30 / -maxfps 60           cadre pe secundă la animații
  -preview=false                 fără imaginea de previzualizare .png
  -blender cale\blender.exe      unde e Blender, dacă nu e găsit singur
  -double                        toate suprafețele subțiri desenate pe ambele fețe
  -genanim spin|bob|spinbob|sway|pulse  animație generată pentru obiecte statice
  -ai                            AI: recunoaște, alege referința din joc, orientează și verifică
  -flip "updown frontback"       armă întoarsă: sus-jos și/sau față-spate (după potrivire)
  -nopause                       nu aștepta Enter la final
  -console                       fără fereastră (dublu-click arată doar acest ajutor)
`)
}

func pause(o *options) {
	if o != nil && o.noPause {
		return
	}
	if runtime.GOOS != "windows" {
		if st, err := os.Stdin.Stat(); err != nil || st.Mode()&os.ModeCharDevice == 0 {
			return
		}
	}
	fmt.Fprint(out, "\nApasă Enter pentru a închide…")
	bufio.NewReader(os.Stdin).ReadString('\n')
}

func newFlagSet(o *options) *flag.FlagSet {
	fs := flag.NewFlagSet("blingmodels", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	fs.StringVar(&o.mode, "mode", "auto", "")
	fs.StringVar(&o.donor, "donor", "", "")
	fs.StringVar(&o.name, "name", "", "")
	fs.StringVar(&o.out, "out", "", "")
	fs.StringVar(&o.blender, "blender", "", "")
	fs.StringVar(&o.origin, "origin", "floor", "")
	fs.StringVar(&o.keep, "keep", "", "")
	fs.StringVar(&o.rotate, "rotate", "", "")
	fs.Float64Var(&o.scale, "scale", 39.37, "")
	fs.Float64Var(&o.height, "height", 0, "")
	fs.Float64Var(&o.size, "size", 0, "")
	fs.Float64Var(&o.fps, "fps", 30, "")
	fs.IntVar(&o.maxTris, "maxtris", 0, "")
	fs.IntVar(&o.tex, "tex", 512, "")
	fs.IntVar(&o.maxFPS, "maxfps", 60, "")
	fs.BoolVar(&o.anims, "anims", true, "")
	fs.BoolVar(&o.noPause, "nopause", false, "")
	fs.BoolVar(&o.preview, "preview", true, "")
	fs.BoolVar(&o.noFit, "nofit", false, "")
	fs.BoolVar(&o.console, "console", false, "")
	fs.BoolVar(&o.double, "double", false, "")
	fs.StringVar(&o.genanim, "genanim", "", "")
	fs.BoolVar(&o.useAI, "ai", false, "")
	fs.StringVar(&o.flip, "flip", "", "")
	fs.Usage = func() {}
	return fs
}

// parseArgs reads blingmodels.ini (next to the exe), then the command line, where flags may come before or after the
// files (drag & drop passes only files).
func parseArgs(args []string) (*options, []string, error) {
	o := &options{}
	fs := newFlagSet(o)
	var flagArgs, files []string
	if exe, err := os.Executable(); err == nil {
		if data, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "blingmodels.ini")); err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "[") {
					continue
				}
				k, v, ok := strings.Cut(line, "=")
				if !ok {
					continue
				}
				flagArgs = append(flagArgs, "-"+strings.ToLower(strings.TrimSpace(k))+"="+strings.Trim(strings.TrimSpace(v), `"`))
			}
		}
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") && len(a) > 1 {
			name := strings.ToLower(strings.TrimLeft(a, "-"))
			if strings.Contains(name, "=") || boolFlags[name] {
				flagArgs = append(flagArgs, "-"+name)
				continue
			}
			if fs.Lookup(name) == nil {
				return o, nil, fmt.Errorf("opțiune necunoscută %s", a)
			}
			if i+1 >= len(args) {
				return o, nil, fmt.Errorf("opțiunea %s are nevoie de o valoare", a)
			}
			flagArgs = append(flagArgs, "-"+name, args[i+1])
			i++
			continue
		}
		files = append(files, a)
	}
	if err := fs.Parse(flagArgs); err != nil {
		return o, nil, err
	}
	o.mode = strings.ToLower(strings.TrimSuffix(o.mode, "_"))
	switch o.mode {
	case "auto", "prop", "player", "v", "p", "w":
	default:
		return o, nil, fmt.Errorf("-mode trebuie să fie auto, prop, player, v, p sau w")
	}
	if o.tex < 16 || o.tex > mdl.MaxTextureSide {
		return o, nil, fmt.Errorf("-tex trebuie să fie între 16 și %d", mdl.MaxTextureSide)
	}
	return o, files, nil
}

func parseRotate(s string) (vmath.Vec3, error) {
	var r vmath.Vec3
	if strings.TrimSpace(s) == "" {
		return r, nil
	}
	parts := strings.FieldsFunc(s, func(c rune) bool { return c == ' ' || c == ',' || c == ';' })
	if len(parts) != 3 {
		return r, fmt.Errorf("-rotate vrea trei unghiuri, ex. \"0 0 90\"")
	}
	for i, p := range parts {
		v, err := strconv.ParseFloat(p, 64)
		if err != nil {
			return r, fmt.Errorf("-rotate: %q nu e un număr", p)
		}
		r[i] = v
	}
	return r, nil
}

// modelExts are the files run converts; anything else dropped (.bin, textures) only travels with a .gltf.
func isModelFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".glb" || ext == ".gltf" || ext == ".mdl" || ext == ".zip" || convert.BlenderFormats[ext]
}

// run converts every model among inputs (an original CS .mdl among them is the donor) and returns how many failed
// and the written files.
func run(o *options, inputs []string) (int, []string) {
	var expanded []string
	for _, in := range inputs {
		if !strings.EqualFold(filepath.Ext(in), ".zip") {
			expanded = append(expanded, in)
			continue
		}
		// Sketchfab's glTF download is a .zip (scene.gltf + scene.bin + textures/).
		found, cleanup, err := extractZip(in)
		if err != nil {
			fmt.Fprintf(out, "Nu pot deschide %s: %v\n", filepath.Base(in), err)
			continue
		}
		defer cleanup()
		if len(found) == 0 {
			fmt.Fprintf(out, "În %s nu e niciun model (.gltf, .glb, .blend…)\n", filepath.Base(in))
		}
		expanded = append(expanded, found...)
	}
	inputs = expanded
	donorPath := o.donor
	var models []string
	for _, in := range inputs {
		if strings.EqualFold(filepath.Ext(in), ".mdl") {
			if isTextureFile(in, inputs) {
				continue // gignT.mdl, read together with gign.mdl
			}
			if donorPath != "" && donorPath != in {
				fmt.Fprintf(out, "Atenție: am primit mai multe modele originale; îl folosesc pe %s\n", filepath.Base(donorPath))
				continue
			}
			donorPath = in
			continue
		}
		models = append(models, in)
	}
	if len(models) == 0 {
		fmt.Fprintln(out, "Nu am primit niciun model de convertit (.glb, .gltf, .zip de pe Sketchfab, .blend, .usdz…).")
		if donorPath != "" {
			fmt.Fprintln(out, "Ai dat doar modelul original din CS; adaugă și modelul nou.")
		}
		return 1, nil
	}
	var donor *mdl.Model
	if donorPath != "" {
		var err error
		if donor, err = convert.LoadDonor(donorPath); err != nil {
			fmt.Fprintln(out, "Eroare la modelul original:", err)
			return 1, nil
		}
		fmt.Fprintf(out, "Model original: %s (%d oase, %d animații)\n", filepath.Base(donorPath), len(donor.Bones), len(donor.Sequences))
	}
	failed := 0
	var written []string
	for _, in := range models {
		start := time.Now()
		fmt.Fprintf(out, "\n→ %s\n", filepath.Base(in))
		path, err := convertOne(o, in, donor, donorPath)
		if err != nil {
			fmt.Fprintln(out, "  EROARE:", err)
			failed++
			continue
		}
		written = append(written, path)
		fmt.Fprintf(out, "  Gata în %.1fs: %s\n", time.Since(start).Seconds(), path)
	}
	if failed > 0 {
		fmt.Fprintf(out, "\n%d fișier(e) nu au putut fi convertite.\n", failed)
	}
	return failed, written
}

// extractZip unpacks an archive into a temporary folder and returns the model files in it (one per folder, the
// .gltf/.glb first).
func extractZip(path string) ([]string, func(), error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, nil, err
	}
	defer zr.Close()
	dir, err := os.MkdirTemp("", "blingmodels-zip-")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { os.RemoveAll(dir) }
	var total int64
	var found []string
	for _, f := range zr.File {
		name := filepath.FromSlash(f.Name)
		if f.FileInfo().IsDir() || strings.Contains(f.Name, "..") || filepath.IsAbs(name) || strings.HasPrefix(f.Name, "__MACOSX") {
			continue
		}
		total += int64(f.UncompressedSize64)
		if total > 2<<30 {
			cleanup()
			return nil, nil, fmt.Errorf("arhiva e prea mare")
		}
		dst := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			cleanup()
			return nil, nil, err
		}
		rc, err := f.Open()
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		w, err := os.Create(dst)
		if err == nil {
			_, err = io.Copy(w, rc)
			w.Close()
		}
		rc.Close()
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		if ext := strings.ToLower(filepath.Ext(dst)); isModelFile(dst) && ext != ".zip" {
			found = append(found, dst)
		}
	}
	// Prefer glTF/GLB over other formats exported next to it (Sketchfab zips sometimes carry both).
	byDir := map[string][]string{}
	for _, f := range found {
		byDir[filepath.Dir(f)] = append(byDir[filepath.Dir(f)], f)
	}
	var out []string
	for _, f := range found {
		group := byDir[filepath.Dir(f)]
		hasGLTF := false
		for _, g := range group {
			e := strings.ToLower(filepath.Ext(g))
			hasGLTF = hasGLTF || e == ".gltf" || e == ".glb"
		}
		e := strings.ToLower(filepath.Ext(f))
		if e == ".mdl" || !hasGLTF || e == ".gltf" || e == ".glb" {
			out = append(out, f)
		}
	}
	return out, cleanup, nil
}

// isTextureFile reports whether path is the T.mdl companion of another dropped model.
func isTextureFile(path string, all []string) bool {
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	if !strings.HasSuffix(strings.ToLower(stem), "t") {
		return false
	}
	base := strings.ToLower(stem[:len(stem)-1] + ext)
	for _, a := range all {
		if strings.ToLower(a) == base {
			return true
		}
	}
	// Alone: a T file has no bones.
	if m, err := mdl.Decode(mustRead(path), nil); err == nil && len(m.Bones) == 0 {
		return true
	}
	return false
}

func mustRead(p string) []byte {
	b, _ := os.ReadFile(p)
	return b
}

func pickMode(o *options, donor *mdl.Model, donorPath, input string) (string, error) {
	mode := o.mode
	if mode == "auto" {
		switch {
		case donor == nil:
			if strings.HasPrefix(strings.ToLower(filepath.Base(input)), "w_") {
				mode = "w"
			} else {
				mode = "prop"
			}
		default:
			b := strings.ToLower(filepath.Base(donorPath))
			switch {
			case strings.HasPrefix(b, "v_"):
				mode = "v"
			case strings.HasPrefix(b, "p_"):
				mode = "p"
			case strings.HasPrefix(b, "w_"):
				mode = "w"
			case len(donor.Sequences) >= 20 && hasBone(donor, "bip01"):
				mode = "player"
			default:
				return "", fmt.Errorf("nu-mi dau seama ce fel de model e %s; alege cu -mode player, v, p sau w", filepath.Base(donorPath))
			}
		}
	}
	if donor == nil && (mode == "player" || mode == "v" || mode == "p") {
		return "", fmt.Errorf("pentru -mode %s trage și modelul original din CS (ex. v_ak47.mdl sau gign.mdl) împreună cu modelul nou", mode)
	}
	return mode, nil
}

func hasBone(m *mdl.Model, prefix string) bool {
	for _, b := range m.Bones {
		if strings.HasPrefix(strings.ToLower(b.Name), prefix) {
			return true
		}
	}
	return false
}

func safeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		case r == ' ' || r == '.':
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "_-")
	if out == "" {
		out = "model"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func convertOne(o *options, input string, donor *mdl.Model, donorPath string) (string, error) {
	oc := *o // the AI may change the mode for this file only
	return convertAttempt(&oc, input, donor, donorPath, 0)
}

// donorStem is the original model's name (v_ak47 for v_ak47.mdl or its backup v_ak47.mdl.blingbak).
func donorStem(p string) string {
	b := strings.TrimSuffix(filepath.Base(p), backupSuffix)
	return strings.TrimSuffix(b, filepath.Ext(b))
}

func convertAttempt(o *options, input string, donor *mdl.Model, donorPath string, attempt int) (string, error) {
	rot, err := parseRotate(o.rotate)
	if err != nil {
		return "", err
	}
	src := input
	if convert.BlenderFormats[strings.ToLower(filepath.Ext(input))] {
		fmt.Fprintln(out, "  Deschid fișierul în Blender…")
		glb, cleanup, err := convert.ViaBlender(input, o.blender)
		if err != nil {
			return "", err
		}
		defer cleanup()
		src = glb
	} else if ext := strings.ToLower(filepath.Ext(input)); ext != ".glb" && ext != ".gltf" {
		return "", fmt.Errorf("format necunoscut %q (merg: .glb .gltf .blend .fbx .obj .dae .usdz)", ext)
	}
	doc, err := gltf.Load(src)
	if err != nil {
		return "", err
	}
	scene, err := convert.LoadScene(doc, convert.LoadOptions{Scale: o.scale, FPS: o.fps, MaxFPS: o.maxFPS, Anims: o.anims, DoubleSided: o.double})
	if err != nil {
		return "", err
	}
	if len(scene.Tris) == 0 {
		return "", fmt.Errorf("fișierul nu conține niciun triunghi vizibil")
	}
	origTris := len(scene.Tris)
	if n := len(scene.Clips); n > 0 {
		fmt.Fprintf(out, "  Animații găsite în fișier: %d\n", n)
	}
	if nb := len(scene.Bones) - 1; nb > 0 {
		fmt.Fprintf(out, "  Schelet găsit: %d oase\n", nb)
	}
	scene.RotateDegrees(rot)
	source := scene.Clone()

	// AI: what is it, which original does it replace, which way does it face.
	aiOriented := false
	if o.aiRot != nil {
		scene.Transform(*o.aiRot, 1, vmath.Vec3{})
		aiOriented = true
	}
	genanim := o.genanim
	if aiNow.client != nil && aiNow.auto && attempt == 0 {
		fmt.Fprintf(out, "  AI (%s) analizează modelul…\n", aiNow.client.Name())
		if a, err := aiAnalyze(scene, filepath.Base(input), o.mode); err != nil {
			fmt.Fprintln(out, "  • AI indisponibil:", err)
		} else {
			fmt.Fprintf(out, "  • AI: %s (tip %s%s, sigur %.0f%%)\n", a.Notes, a.Type, ifs(a.Weapon != "", ", "+a.Weapon, ""), a.Confidence*100)
			if o.mode == "auto" && donor == nil {
				switch a.Type {
				case "v", "p", "w", "player":
					if r, ok := refByFile(a.Reference); ok && (r.Kind == a.Type) {
						if d, err := convert.LoadDonor(r.Path); err == nil {
							donor, donorPath = d, r.Path
							o.mode = a.Type
							fmt.Fprintf(out, "  • AI a ales referința %s (%d animații)\n", r.File, len(d.Sequences))
						}
					} else if a.Type == "w" {
						o.mode = "w"
					} else {
						fmt.Fprintf(out, "  • AI crede că e %s, dar nu am găsit referința în joc; îl fac obiect (alege referința manual)\n", modeLabel(a.Type, true))
					}
				}
			}
			if strings.TrimSpace(o.rotate) == "" {
				if r, ok := a.orientation(); ok {
					if r != (vmath.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}) {
						scene.Transform(r, 1, vmath.Vec3{})
						fmt.Fprintln(out, "  • AI a întors modelul cu fața înainte și în picioare")
					}
					rr := r
					o.aiRot = &rr
					aiOriented = true
				}
			}
			if genanim == "auto" {
				genanim = a.Animation
			}
		}
	}
	if pr, err := parseRotate(o.postRotate); err == nil {
		scene.RotateDegrees(pr)
	}
	mode, err := pickMode(o, donor, donorPath, input)
	if err != nil {
		return "", err
	}
	lastMode, lastDonor = mode, donor != nil

	maxTris := o.maxTris
	if maxTris <= 0 {
		maxTris = map[string]int{"prop": 12000, "player": 9000, "v": 8000, "p": 3000, "w": 3000}[mode]
	}
	scene.Simplify(maxTris)
	if len(scene.Tris) < origTris {
		fmt.Fprintf(out, "  Triunghiuri: %d → %d (simplificat pentru CS 1.6)\n", origTris, len(scene.Tris))
	} else {
		fmt.Fprintf(out, "  Triunghiuri: %d\n", origTris)
	}
	if mode == "prop" && genanim != "" && genanim != "auto" && genanim != "none" {
		if scene.GenerateAnim(genanim) {
			fmt.Fprintf(out, "  • Animație generată: %s\n", convert.GenAnimKinds[genanim])
		}
	}
	texSide := o.tex
	if (mode == "p" || mode == "w") && o.tex == 512 {
		texSide = 256
	}

	name := o.name
	if name == "" {
		if donorPath != "" && mode != "prop" {
			name = donorStem(donorPath)
		} else {
			name = strings.TrimSuffix(filepath.Base(input), filepath.Ext(input))
		}
	}
	name = safeName(name)
	if mode == "w" && donor == nil && !strings.HasPrefix(name, "w_") {
		name = "w_" + name
	}

	var model *mdl.Model
	var notes []string
	switch {
	case donor != nil && mode != "prop":
		dm := map[string]convert.DonorMode{"player": convert.DonorPlayer, "v": convert.DonorView, "p": convert.DonorWorld, "w": convert.DonorWorld}[mode]
		dopts := convert.DonorOptions{Mode: dm, Name: name + ".mdl", MaxTexture: texSide, Keep: o.keep, AutoRotate: !o.noFit && !aiOriented, Flip: o.flip}
		if aiNow.client != nil {
			dopts.MapBones = aiMapBones
		}
		model, notes, err = convert.BuildWithDonor(scene, donor, dopts)
		if err != nil {
			return "", err
		}
	default:
		if mode == "w" {
			scene.LayFlat()
			for _, f := range strings.Fields(o.flip) {
				scene.FlipWeapon(f)
			}
			size := o.size
			mn, mx := scene.Bounds()
			if long := math.Max(mx[0]-mn[0], math.Max(mx[1]-mn[1], mx[2]-mn[2])); long > 1e-9 {
				if size <= 0 && (long < 10 || long > 80) {
					size = 30
				}
				if size > 0 {
					scene.Transform(vmath.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, size/long, vmath.Vec3{})
				}
			}
			scene.PlaceOrigin("floor")
		} else {
			if o.height > 0 {
				scene.ScaleToHeight(o.height)
			}
			if o.size > 0 {
				mn, mx := scene.Bounds()
				if long := math.Max(mx[0]-mn[0], math.Max(mx[1]-mn[1], mx[2]-mn[2])); long > 1e-9 {
					scene.Transform(vmath.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, o.size/long, vmath.Vec3{})
				}
			}
			mn, mx := scene.Bounds()
			if long := math.Max(mx[0]-mn[0], math.Max(mx[1]-mn[1], mx[2]-mn[2])); long > 2000 && o.height <= 0 && o.size <= 0 && o.scale == 39.37 {
				// Exported in centimeters (a common Sketchfab mistake): 100 times too big.
				scene.Transform(vmath.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, 0.01, vmath.Vec3{})
				notes = append(notes, fmt.Sprintf("modelul era în centimetri (%.0f unități); l-am micșorat de 100 de ori", long))
			}
			scene.PlaceOrigin(o.origin)
			mn, mx = scene.Bounds()
			if long := math.Max(mx[0]-mn[0], math.Max(mx[1]-mn[1], mx[2]-mn[2])); long > 2000 || long < 2 {
				notes = append(notes, fmt.Sprintf("modelul are %.0f unități (un jucător are 72); dacă e prea mare/mic folosește -height sau -scale", long))
			}
		}
		model, err = convert.BuildProp(scene, convert.BuildOptions{Name: name + ".mdl", MaxTexture: texSide})
		if err != nil {
			return "", err
		}
	}
	if err := model.Validate(); err != nil {
		return "", err
	}
	data, err := model.Encode()
	if err != nil {
		return "", err
	}
	// Self-check: the written file must read back with the same structure.
	back, err := mdl.Decode(data, nil)
	if err != nil {
		return "", fmt.Errorf("verificarea fișierului scris a eșuat: %v", err)
	}
	if len(back.Bones) != len(model.Bones) || len(back.Sequences) != len(model.Sequences) || len(back.Textures) != len(model.Textures) || len(back.BodyParts) != len(model.BodyParts) {
		return "", fmt.Errorf("verificarea fișierului scris a eșuat (structură diferită)")
	}

	outDir := o.out
	if outDir == "" {
		outDir = filepath.Join(filepath.Dir(input), "blingmodels_out")
	}
	rel := name + ".mdl"
	if mode == "player" {
		rel = filepath.Join("player", name, name+".mdl")
	}
	outPath := filepath.Join(outDir, rel)
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(outPath, data, 0o644); err != nil {
		return "", err
	}
	verts, tris := 0, 0
	for _, bp := range back.BodyParts {
		for _, sm := range bp.Models {
			verts += len(sm.Verts)
			for _, me := range sm.Meshes {
				tris += int(me.NumTris)
			}
		}
	}
	fmt.Fprintf(out, "  Tip: %s | %d triunghiuri, %d vârfuri, %d texturi, %d oase, %d animații, %d KB\n",
		modeLabel(mode, donor != nil), tris, verts, len(back.Textures), len(back.Bones), len(back.Sequences), (len(data)+1023)/1024)
	for _, n := range notes {
		fmt.Fprintln(out, "  •", n)
	}
	if o.preview {
		png := strings.TrimSuffix(outPath, ".mdl") + "_preview.png"
		if err := preview.Render(back, png); err == nil {
			fmt.Fprintln(out, "  Previzualizare:", png)
		}
	}
	fmt.Fprintln(out, "  Copiază în:", installHint(mode, name))
	if aiNow.client != nil && aiNow.review {
		fmt.Fprintln(out, "  AI verifică rezultatul…")
		r, err := aiReview(back, source, modeLabel(mode, donor != nil))
		switch {
		case err != nil:
			fmt.Fprintln(out, "  • AI indisponibil:", err)
		case r.OK && len(r.Problems) == 0:
			fmt.Fprintln(out, "  • AI: arată bine.", r.Summary)
		default:
			for _, p := range r.Problems {
				fmt.Fprintln(out, "  • AI a observat:", p)
			}
			if attempt == 0 && r.hasFixes() {
				o2 := *o
				o2.mode = mode
				o2.double = o.double || r.Fixes.Double
				o2.postRotate = r.Fixes.Rotate
				if r.Fixes.MaxTris > 0 {
					o2.maxTris = r.Fixes.MaxTris
				}
				if r.Fixes.Height > 0 {
					o2.height = r.Fixes.Height
				}
				o2.noFit = o.noFit || r.Fixes.NoFit
				fmt.Fprintln(out, "  • AI repară și convertește din nou…")
				return convertAttempt(&o2, input, donor, donorPath, 1)
			}
		}
	}
	return outPath, nil
}

func modeLabel(mode string, donor bool) string {
	switch mode {
	case "player":
		return "jucător"
	case "v":
		return "armă v_ (persoana întâi)"
	case "p":
		return "armă p_ (în mâna altora)"
	case "w":
		if donor {
			return "armă w_ (pe jos)"
		}
		return "armă w_ (pe jos, fără original)"
	}
	return "decor / obiect"
}

func installHint(mode, name string) string {
	switch mode {
	case "player":
		return fmt.Sprintf(`cstrike\models\player\%s\%s.mdl`, name, name)
	case "prop":
		return fmt.Sprintf(`cstrike\models\%s.mdl (sau un subfolder, apoi în hartă/plugin)`, name)
	}
	return fmt.Sprintf(`cstrike\models\%s.mdl`, name)
}

func ifs(c bool, a, b string) string {
	if c {
		return a
	}
	return b
}
