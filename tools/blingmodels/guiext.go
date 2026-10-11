package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"blingmodels/internal/ai"
	"blingmodels/internal/convert"
)

// gameScan finds the game in the background (scanning drives can take a few seconds) and remembers the result.
type gameScan struct {
	mu       sync.Mutex
	done     bool
	found    []string
	scanning bool
}

func (g *gameScan) start(cfg config) {
	g.mu.Lock()
	if g.scanning {
		g.mu.Unlock()
		return
	}
	g.scanning, g.done = true, false
	g.mu.Unlock()
	go func() {
		found := findCstrike(cfg)
		g.mu.Lock()
		g.found, g.done, g.scanning = found, true, false
		g.mu.Unlock()
	}()
}

func (g *gameScan) get() ([]string, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.found...), g.done
}

var scan gameScan

// currentCstrike is the configured game folder, or the first one found.
func currentCstrike(cfg config) string {
	if cfg.Cstrike != "" && isCstrike(cfg.Cstrike) {
		return cfg.Cstrike
	}
	if found, _ := scan.get(); len(found) > 0 {
		return found[0]
	}
	return ""
}

type guiState struct {
	Cstrike    string            `json:"cstrike"`
	Found      []string          `json:"found"`
	Scanning   bool              `json:"scanning"`
	Refs       []refModel        `json:"refs"`
	AIMode     string            `json:"aiMode"`
	HasKey     bool              `json:"hasKey"`
	ClaudeCode bool              `json:"claudeCode"`
	ClaudePath string            `json:"claudePath"`
	AIName     string            `json:"aiName"`
	AIError    string            `json:"aiError,omitempty"`
	AIAuto     bool              `json:"aiAuto"`
	AIReview   bool              `json:"aiReview"`
	GenAnims   map[string]string `json:"genAnims"`
}

func buildState() guiState {
	cfg := loadConfig()
	found, done := scan.get()
	st := guiState{Found: found, Scanning: !done, AIMode: cfg.AIMode, HasKey: cfg.APIKey != "", AIAuto: boolOr(cfg.AIAuto, true), AIReview: boolOr(cfg.AIReview, true), GenAnims: convert.GenAnimKinds}
	if st.AIMode == "" {
		st.AIMode = "auto"
	}
	st.Cstrike = currentCstrike(cfg)
	if st.Cstrike != "" {
		st.Refs = listRefs(st.Cstrike)
	}
	if p, err := ai.FindClaudeCode(); err == nil {
		st.ClaudeCode, st.ClaudePath = true, p
	}
	if c, err := ai.New(st.AIMode, cfg.APIKey, cfg.AIModel); err == nil {
		st.AIName = c.Name()
	} else {
		st.AIError = err.Error()
	}
	return st
}

// setupAI prepares aiNow for a conversion from the saved settings and the window's switches.
func setupAI(useAuto, useReview bool) {
	cfg := loadConfig()
	aiNow = aiState{}
	if st := currentCstrike(cfg); st != "" {
		aiNow.refs = listRefs(st)
	}
	mode := cfg.AIMode
	if mode == "" {
		mode = "auto"
	}
	if !useAuto && !useReview {
		return
	}
	c, err := ai.New(mode, cfg.APIKey, cfg.AIModel)
	if err != nil {
		return
	}
	aiNow.client, aiNow.auto, aiNow.review = c, useAuto, useReview
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// registerExtra adds the settings, game, install and assistant endpoints.
func registerExtra(mux *http.ServeMux, guard func(http.HandlerFunc) http.HandlerFunc, outDir string, mu *sync.Mutex) {
	scan.start(loadConfig())
	mux.HandleFunc("/state", guard(func(w http.ResponseWriter, r *http.Request) { writeJSON(w, buildState()) }))
	mux.HandleFunc("/rescan", guard(func(w http.ResponseWriter, r *http.Request) {
		scan.start(loadConfig())
		writeJSON(w, buildState())
	}))
	mux.HandleFunc("/settings", guard(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", http.StatusMethodNotAllowed)
			return
		}
		var in struct {
			Cstrike  *string `json:"cstrike"`
			AIMode   *string `json:"aiMode"`
			APIKey   *string `json:"apiKey"`
			AIAuto   *bool   `json:"aiAuto"`
			AIReview *bool   `json:"aiReview"`
			Claude   *string `json:"claude"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
			jsonError(w, "date invalide")
			return
		}
		cfg := loadConfig()
		if in.Cstrike != nil {
			p := strings.Trim(strings.TrimSpace(*in.Cstrike), `"`)
			if p != "" {
				// Accept the game folder or the cstrike folder itself.
				if !isCstrike(p) && isCstrike(filepath.Join(p, "cstrike")) {
					p = filepath.Join(p, "cstrike")
				}
				if !isCstrike(p) {
					jsonError(w, "în folderul ăsta nu e Counter-Strike (caut folderul cstrike cu models în el)")
					return
				}
			}
			cfg.Cstrike = p
		}
		if in.AIMode != nil {
			switch *in.AIMode {
			case "auto", "claude", "api", "off":
				cfg.AIMode = *in.AIMode
			}
		}
		if in.APIKey != nil {
			cfg.APIKey = strings.TrimSpace(*in.APIKey)
		}
		if in.AIAuto != nil {
			cfg.AIAuto = in.AIAuto
		}
		if in.Claude != nil {
			p := strings.Trim(strings.TrimSpace(*in.Claude), `"`)
			if p != "" {
				if st, err := os.Stat(p); err == nil && st.IsDir() {
					for _, n := range []string{"claude.exe", "claude.cmd", "claude"} {
						if fileExists(filepath.Join(p, n)) {
							p = filepath.Join(p, n)
							break
						}
					}
				}
				if st, err := os.Stat(p); err != nil || st.IsDir() {
					jsonError(w, "nu găsesc claude.exe la calea asta")
					return
				}
			}
			cfg.Claude = p
			if p != "" && (cfg.AIMode == "" || cfg.AIMode == "off") {
				cfg.AIMode = "auto"
			}
		}
		if in.AIReview != nil {
			cfg.AIReview = in.AIReview
		}
		if err := saveConfig(cfg); err != nil {
			jsonError(w, err.Error())
			return
		}
		writeJSON(w, buildState())
	}))
	inOut := func(p string) (string, bool) {
		p = filepath.Clean(p)
		rel, err := filepath.Rel(outDir, p)
		if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
			return "", false
		}
		return rel, true
	}
	mux.HandleFunc("/install", guard(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Path string `json:"path"`
		}
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in)
		rel, ok := inOut(in.Path)
		if !ok || !strings.HasSuffix(strings.ToLower(rel), ".mdl") {
			jsonError(w, "fișier invalid")
			return
		}
		cs := currentCstrike(loadConfig())
		if cs == "" {
			jsonError(w, "nu am găsit jocul; alege folderul cstrike în Setări")
			return
		}
		dst, err := installModel(cs, in.Path, rel)
		if err != nil {
			jsonError(w, err.Error())
			return
		}
		writeJSON(w, map[string]any{"dst": dst, "backup": fileExists(dst + backupSuffix)})
	}))
	mux.HandleFunc("/restore", guard(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Path string `json:"path"`
		}
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in)
		rel, ok := inOut(in.Path)
		if !ok {
			jsonError(w, "fișier invalid")
			return
		}
		if err := restoreModel(currentCstrike(loadConfig()), rel); err != nil {
			jsonError(w, err.Error())
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("/assistant", guard(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Message string          `json:"message"`
			State   json.RawMessage `json:"state"`
			Log     string          `json:"log"`
			Preview string          `json:"preview"` // a converted model's preview to show the AI
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil || strings.TrimSpace(in.Message) == "" {
			jsonError(w, "mesaj gol")
			return
		}
		mu.Lock()
		setupAI(true, false)
		client := aiNow.client
		mu.Unlock()
		if client == nil {
			cfg := loadConfig()
			_, err := ai.New(map[bool]string{true: cfg.AIMode, false: "auto"}[cfg.AIMode != ""], cfg.APIKey, cfg.AIModel)
			msg := "AI-ul nu e configurat. Deschide Setări → AI."
			if err != nil {
				msg = err.Error()
			}
			writeJSON(w, assistantReply{Reply: msg})
			return
		}
		var img []byte
		if in.Preview != "" {
			if _, ok := inOut(in.Preview); ok {
				img, _ = os.ReadFile(in.Preview)
			}
		}
		rep, err := aiAssistant(in.Message, string(in.State), in.Log, img)
		if err != nil {
			writeJSON(w, assistantReply{Reply: "Eroare AI: " + err.Error()})
			return
		}
		writeJSON(w, rep)
	}))
}
