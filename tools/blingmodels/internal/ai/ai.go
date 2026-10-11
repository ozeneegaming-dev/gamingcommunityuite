// Package ai asks Claude to look at renders of a model and answer in JSON. Two ways to reach Claude: Claude Code
// installed on this computer (uses the person's Claude subscription, `claude -p`), or a Claude API key (Anthropic SDK).
package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

// DefaultModel is used unless another model is configured: Claude Haiku 5.5, fast and light on the subscription's
// limits (the person chose it for blingmodels).
const DefaultModel = "claude-haiku-5-5"

// Image is a PNG with a caption the prompt can refer to.
type Image struct {
	Label string
	PNG   []byte
}

// Client answers one question (text plus images) with text.
type Client interface {
	Ask(ctx context.Context, system, prompt string, images []Image) (string, error)
	Name() string
}

// ErrNoAI means neither Claude Code nor an API key is available.
var ErrNoAI = errors.New("AI-ul nu e configurat: instalează Claude Code (abonamentul tău) sau pune o cheie API în Setări")

// ClaudePath, when set, is used instead of searching for Claude Code.
var ClaudePath string

// New picks a backend. mode: "auto" (API key if given, else Claude Code), "claude", "api", "off".
func New(mode, apiKey, model string) (Client, error) {
	if model == "" {
		model = DefaultModel
	}
	switch mode {
	case "off":
		return nil, ErrNoAI
	case "api":
		if apiKey == "" {
			return nil, errors.New("lipsește cheia API (Setări → AI)")
		}
		return &apiClient{key: apiKey, model: model}, nil
	case "claude":
		exe, err := FindClaudeCode()
		if err != nil {
			return nil, err
		}
		return &cliClient{exe: exe, model: model}, nil
	}
	if apiKey != "" {
		return &apiClient{key: apiKey, model: model}, nil
	}
	if exe, err := FindClaudeCode(); err == nil {
		return &cliClient{exe: exe, model: model}, nil
	}
	return nil, ErrNoAI
}

// FindClaudeCode locates the `claude` command (Claude Code): PATH, the native installer, npm, and the copy the
// Claude desktop app keeps for its Code tab.
func FindClaudeCode() (string, error) {
	if ClaudePath != "" {
		if st, err := os.Stat(ClaudePath); err == nil && !st.IsDir() {
			return ClaudePath, nil
		}
	}
	if p, err := exec.LookPath("claude"); err == nil {
		return p, nil
	}
	exeName := "claude"
	if runtime.GOOS == "windows" {
		exeName = "claude.exe"
	}
	var cands []string
	home, _ := os.UserHomeDir()
	if home != "" {
		cands = append(cands, filepath.Join(home, ".local", "bin", exeName), filepath.Join(home, ".claude", "local", exeName), filepath.Join(home, ".claude", "local", "claude"))
	}
	var globs []string
	if runtime.GOOS == "windows" {
		appdata, local := os.Getenv("APPDATA"), os.Getenv("LOCALAPPDATA")
		cands = append(cands,
			filepath.Join(appdata, "npm", "claude.cmd"),
			filepath.Join(local, "Programs", "claude", "claude.exe"),
			filepath.Join(local, "Programs", "Claude Code", "claude.exe"),
			filepath.Join(home, "AppData", "Roaming", "npm", "claude.cmd"),
			filepath.Join(home, ".bun", "bin", "claude.exe"),
			filepath.Join(home, ".volta", "bin", "claude.exe"))
		for _, root := range []string{appdata, local} {
			if root == "" {
				continue
			}
			globs = append(globs,
				filepath.Join(root, "Claude", "claude-code", "*", "claude.exe"),
				filepath.Join(root, "Claude", "claude-code", "*", "*", "claude.exe"),
				filepath.Join(root, "Claude", "claude-code-vm", "*", "claude.exe"),
				filepath.Join(root, "AnthropicClaude", "app-*", "resources", "*", "claude.exe"),
				filepath.Join(root, "AnthropicClaude", "app-*", "resources", "*", "*", "claude.exe"),
				filepath.Join(root, "Claude", "*", "claude.exe"),
				filepath.Join(root, "Programs", "Claude*", "*", "claude.exe"))
		}
	} else {
		globs = append(globs,
			filepath.Join(home, "Library", "Application Support", "Claude", "claude-code", "*", "claude"),
			filepath.Join(home, ".config", "Claude", "claude-code", "*", "claude"))
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	for _, g := range globs {
		matches, _ := filepath.Glob(g)
		sort.Strings(matches)
		for i := len(matches) - 1; i >= 0; i-- { // newest version folder first
			if st, err := os.Stat(matches[i]); err == nil && !st.IsDir() {
				return matches[i], nil
			}
		}
	}
	return "", errors.New("nu găsesc Claude Code pe acest calculator. Instalează-l o dată din PowerShell: irm https://claude.ai/install.ps1 | iex — apoi scrie claude și conectează-te cu contul tău (sau pune o cheie API în Setări)")
}

// ---- Claude Code (subscription) ----

type cliClient struct{ exe, model string }

func (c *cliClient) Name() string { return "Claude Code (abonament, " + c.model + ")" }

func (c *cliClient) Ask(ctx context.Context, system, prompt string, images []Image) (string, error) {
	dir, err := os.MkdirTemp("", "blingmodels-ai-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	var b strings.Builder
	b.WriteString(system)
	b.WriteString("\n\n")
	if len(images) > 0 {
		b.WriteString("Imagini (citește fiecare fișier cu instrumentul Read înainte să răspunzi):\n")
		for i, im := range images {
			p := filepath.Join(dir, fmt.Sprintf("img%d.png", i+1))
			if err := os.WriteFile(p, im.PNG, 0o644); err != nil {
				return "", err
			}
			fmt.Fprintf(&b, "- %s: %s\n", p, im.Label)
		}
		b.WriteString("\n")
	}
	b.WriteString(prompt)
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.exe, "-p", "--output-format", "json", "--model", c.model, "--allowedTools", "Read", "--add-dir", dir)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(b.String())
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		// The JSON answer carries the reason in "result" (not logged in, usage limit, …).
		var res struct {
			Result string `json:"result"`
		}
		if json.Unmarshal(stdout.Bytes(), &res) == nil && strings.TrimSpace(res.Result) != "" {
			return "", fmt.Errorf("Claude Code: %s", strings.TrimSpace(res.Result))
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if len(msg) > 600 {
			msg = msg[:600]
		}
		return "", fmt.Errorf("Claude Code a dat eroare: %v %s", err, msg)
	}
	var res struct {
		Result  string `json:"result"`
		IsError bool   `json:"is_error"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &res); err != nil {
		return stdout.String(), nil
	}
	if res.IsError {
		return "", fmt.Errorf("Claude Code: %s", res.Result)
	}
	return res.Result, nil
}

// ---- Claude API (key) ----

type apiClient struct{ key, model string }

func (c *apiClient) Name() string { return "Claude API (" + c.model + ")" }

func (c *apiClient) Ask(ctx context.Context, system, prompt string, images []Image) (string, error) {
	client := anthropic.NewClient(option.WithAPIKey(c.key), option.WithRequestTimeout(4*time.Minute))
	var blocks []anthropic.BetaContentBlockParamUnion
	for _, im := range images {
		blocks = append(blocks, anthropic.NewBetaTextBlock(im.Label+":"))
		blocks = append(blocks, anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
			Data: base64.StdEncoding.EncodeToString(im.PNG), MediaType: anthropic.BetaBase64ImageSourceMediaTypeImagePNG,
		}))
	}
	blocks = append(blocks, anthropic.NewBetaTextBlock(prompt))
	resp, err := client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
		Model:        anthropic.Model(c.model),
		MaxTokens:    16000,
		System:       []anthropic.BetaTextBlockParam{{Text: system}},
		Messages:     []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(blocks...)},
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortMedium},
		// A declined request is re-served by a fallback model inside the same call.
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
		Fallbacks: anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()},
	})
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			switch apiErr.StatusCode {
			case 401:
				return "", errors.New("cheia API nu e validă")
			case 429:
				return "", errors.New("prea multe cereri către Claude; încearcă din nou peste un minut")
			}
		}
		return "", fmt.Errorf("Claude API: %v", err)
	}
	if resp.StopReason == anthropic.BetaStopReasonRefusal {
		return "", errors.New("Claude a refuzat cererea")
	}
	var out strings.Builder
	for _, b := range resp.Content {
		if t, ok := b.AsAny().(anthropic.BetaTextBlock); ok {
			out.WriteString(t.Text)
		}
	}
	return out.String(), nil
}

// JSON extracts the first JSON object from an answer (models sometimes add a sentence around it) into v.
func JSON(answer string, v any) error {
	s := answer
	if i := strings.Index(s, "```json"); i >= 0 {
		s = s[i+7:]
	}
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return fmt.Errorf("răspunsul AI nu conține JSON: %.200s", answer)
	}
	return json.Unmarshal([]byte(s[start:end+1]), v)
}
