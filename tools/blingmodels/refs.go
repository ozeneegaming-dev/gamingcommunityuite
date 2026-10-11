package main

import (
	"encoding/json"

	"blingmodels/internal/ai"

	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// config is remembered between runs (UserConfigDir/blingmodels/config.json).
type config struct {
	Cstrike  string `json:"cstrike,omitempty"`  // the game's cstrike folder chosen by the user
	AIMode   string `json:"aiMode,omitempty"`   // "auto", "claude" (Claude Code, subscription), "api", "off"
	APIKey   string `json:"apiKey,omitempty"`   // Claude API key, stored only on this computer
	AIModel  string `json:"aiModel,omitempty"`  // empty = default
	Claude   string `json:"claude,omitempty"`   // path to claude(.exe), when it is not found on its own
	AIAuto   *bool  `json:"aiAuto,omitempty"`   // AI matching + orientation on each conversion
	AIReview *bool  `json:"aiReview,omitempty"` // AI quality check after each conversion
}

func configPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "blingmodels", "config.json")
}

func loadConfig() config {
	var c config
	if data, err := os.ReadFile(configPath()); err == nil {
		json.Unmarshal(data, &c)
	}
	ai.ClaudePath = c.Claude
	return c
}

func saveConfig(c config) error {
	p := configPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(p, data, 0o600)
}

func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

// isCstrike reports whether dir looks like a Counter-Strike 1.6 game folder.
func isCstrike(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, "models"))
	if err != nil || !st.IsDir() {
		return false
	}
	return fileExists(filepath.Join(dir, "liblist.gam")) || fileExists(filepath.Join(dir, "models", "v_ak47.mdl")) || fileExists(filepath.Join(dir, "models", "player"))
}

// findCstrike looks for Counter-Strike 1.6 installs: Steam libraries, the usual folders on every drive, and a shallow
// search of folders named like games. The configured folder comes first.
func findCstrike(cfg config) []string {
	seen := map[string]bool{}
	var out []string
	add := func(dir string) {
		dir = filepath.Clean(dir)
		key := strings.ToLower(dir)
		if seen[key] {
			return
		}
		seen[key] = true
		if isCstrike(dir) {
			out = append(out, dir)
		}
	}
	if cfg.Cstrike != "" {
		add(cfg.Cstrike)
	}
	var roots []string
	if runtime.GOOS == "windows" {
		for c := 'C'; c <= 'Z'; c++ {
			if st, err := os.Stat(string(c) + `:\`); err == nil && st.IsDir() {
				roots = append(roots, string(c)+`:\`)
			}
		}
		// Steam and its extra libraries.
		var steams []string
		for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles"} {
			if p := os.Getenv(env); p != "" {
				steams = append(steams, filepath.Join(p, "Steam"))
			}
		}
		for _, r := range roots {
			steams = append(steams, filepath.Join(r, "Steam"), filepath.Join(r, "SteamLibrary"), filepath.Join(r, "Program Files (x86)", "Steam"))
		}
		libRe := regexp.MustCompile(`"path"\s+"([^"]+)"`)
		for _, s := range steams {
			add(filepath.Join(s, "steamapps", "common", "Half-Life", "cstrike"))
			if data, err := os.ReadFile(filepath.Join(s, "steamapps", "libraryfolders.vdf")); err == nil {
				for _, m := range libRe.FindAllStringSubmatch(string(data), -1) {
					lib := strings.ReplaceAll(m[1], `\\`, `\`)
					add(filepath.Join(lib, "steamapps", "common", "Half-Life", "cstrike"))
				}
			}
		}
	} else {
		if home, err := os.UserHomeDir(); err == nil {
			roots = append(roots, home)
			add(filepath.Join(home, ".steam", "steam", "steamapps", "common", "Half-Life", "cstrike"))
			add(filepath.Join(home, ".local", "share", "Steam", "steamapps", "common", "Half-Life", "cstrike"))
		}
	}
	// Shallow search: up to three levels below each drive, only through folders named like games.
	gameish := regexp.MustCompile(`(?i)(counter|strike|cs|half|steam|game|joc|hlds|server|valve|program files)`)
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			p := filepath.Join(dir, name)
			if strings.EqualFold(name, "cstrike") {
				add(p)
				continue
			}
			if depth < 3 && gameish.MatchString(name) && !strings.HasPrefix(name, "$") {
				walk(p, depth+1)
			}
		}
	}
	for _, r := range roots {
		walk(r, 0)
	}
	return out
}

type refModel struct {
	Kind string `json:"kind"` // v, p, w, player
	Name string `json:"name"` // ak47, gign…
	File string `json:"file"` // v_ak47.mdl
	Path string `json:"path"`
	Bak  bool   `json:"bak"` // a blingmodels backup exists (already replaced once)
}

// listRefs lists the original models of a cstrike folder that can serve as references. When a model was already
// replaced by blingmodels, the reference is its backup (the real original).
func listRefs(cstrike string) []refModel {
	var out []refModel
	models := filepath.Join(cstrike, "models")
	entries, _ := os.ReadDir(models)
	for _, e := range entries {
		n := strings.ToLower(e.Name())
		if e.IsDir() || !strings.HasSuffix(n, ".mdl") || len(n) < 7 || n[1] != '_' {
			continue
		}
		kind := n[:1]
		if kind != "v" && kind != "p" && kind != "w" {
			continue
		}
		p := filepath.Join(models, e.Name())
		r := refModel{Kind: kind, Name: strings.TrimSuffix(n[2:], ".mdl"), File: e.Name(), Path: p}
		if fileExists(p + backupSuffix) {
			r.Path, r.Bak = p+backupSuffix, true
		}
		out = append(out, r)
	}
	players, _ := os.ReadDir(filepath.Join(models, "player"))
	for _, e := range players {
		if !e.IsDir() {
			continue
		}
		p := filepath.Join(models, "player", e.Name(), e.Name()+".mdl")
		if !fileExists(p) {
			continue
		}
		r := refModel{Kind: "player", Name: e.Name(), File: e.Name() + ".mdl", Path: p}
		if fileExists(p + backupSuffix) {
			r.Path, r.Bak = p+backupSuffix, true
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Name < out[j].Name
	})
	return out
}

const backupSuffix = ".blingbak"

// installModel copies a converted model into the game, keeping the original once as name.mdl.blingbak (and its T.mdl
// textures file, which an embedded-texture model no longer needs but the original does).
func installModel(cstrike, src, rel string) (string, error) {
	rel = filepath.Clean(rel)
	if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", fmt.Errorf("cale invalidă")
	}
	dst := filepath.Join(cstrike, "models", rel)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	if fileExists(dst) && !fileExists(dst+backupSuffix) {
		if err := copyFile(dst, dst+backupSuffix); err != nil {
			return "", fmt.Errorf("nu pot face copia de siguranță: %v", err)
		}
	}
	if err := copyFile(src, dst); err != nil {
		return "", err
	}
	return dst, nil
}

// restoreModel puts the original back from its backup.
func restoreModel(cstrike, rel string) error {
	dst := filepath.Join(cstrike, "models", filepath.Clean(rel))
	if !fileExists(dst + backupSuffix) {
		return fmt.Errorf("nu există copie de siguranță pentru %s", rel)
	}
	if err := copyFile(dst+backupSuffix, dst); err != nil {
		return err
	}
	return os.Remove(dst + backupSuffix)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}
