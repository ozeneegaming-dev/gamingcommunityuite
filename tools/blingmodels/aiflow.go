package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"

	"blingmodels/internal/ai"
	"blingmodels/internal/convert"
	"blingmodels/internal/mdl"
	"blingmodels/internal/preview"
	"blingmodels/internal/vmath"
)

// aiState is the AI setup for the current conversion (the window sets it from Settings; the command line from -ai).
type aiState struct {
	client ai.Client
	auto   bool // match type/reference/orientation before converting
	review bool // check the result and fix it once
	refs   []refModel
}

var aiNow aiState

const aiSystem = `You are the vision assistant inside blingmodels, a converter of 3D models (Sketchfab glTF) to Counter-Strike 1.6 GoldSrc .mdl files. You look at renders and answer ONLY with one JSON object, no prose around it. Write any human-readable text in Romanian.`

// quickModel builds a small, untextured-safe model of the scene for renders (textures at 128 px).
func quickModel(s *convert.Scene) (*mdl.Model, error) {
	c := *s
	c.Clips = nil
	return convert.BuildProp(&c, convert.BuildOptions{Name: "ai.mdl", MaxTexture: 128})
}

var axisNames = []string{"+X", "-X", "+Y", "-Y", "+Z", "-Z"}
var axisVecs = []vmath.Vec3{{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}}

type aiAnalysis struct {
	Type       string  `json:"type"`      // prop, player, v, p, w
	Weapon     string  `json:"weapon"`    // e.g. ak47, m4a1, deagle, knife
	Reference  string  `json:"reference"` // file from the list, e.g. v_ak47.mdl
	Front      int     `json:"front"`     // image number showing the front
	Top        int     `json:"top"`       // image number showing the top
	Animation  string  `json:"animation"` // for props: none, spin, bob, spinbob, sway, pulse
	Confidence float64 `json:"confidence"`
	Notes      string  `json:"notes"`
}

// aiAnalyze shows Claude the model from six sides and asks what it is, which original CS model it should replace
// and which way it faces.
func aiAnalyze(s *convert.Scene, inputName, mode string) (*aiAnalysis, error) {
	m, err := quickModel(s)
	if err != nil {
		return nil, err
	}
	pngs := preview.Views(m, preview.AxisEyes, false)
	var imgs []ai.Image
	for i, p := range pngs {
		imgs = append(imgs, ai.Image{Label: fmt.Sprintf("Image %d: camera on the %s side looking at the model", i+1, axisNames[i]), PNG: p})
	}
	var refList []string
	for _, r := range aiNow.refs {
		refList = append(refList, r.File)
	}
	prompt := fmt.Sprintf(`The file is %q. The user chose type %q ("auto" = decide yourself).
Original Counter-Strike models available as references: %s

Decide:
- "type": "prop" (object/decoration), "player" (a human character to use as a CS player model), "v" (a weapon for the first-person view), "p" (weapon seen in other players' hands) or "w" (weapon lying on the ground). For a weapon when the user chose "auto", answer "v".
- "weapon": which CS weapon it resembles most (ak47, m4a1, awp, deagle, glock18, usp, mp5, p90, famas, galil, aug, sg552, scout, m3, xm1014, knife, hegrenade, c4…) or "".
- "reference": the best matching file from the list for that type (e.g. "v_ak47.mdl", or a player model like "gign.mdl" for a soldier, "terror.mdl"…); "" if none fits or the list is empty.
- "front": the image number (1-6) showing the model's FRONT: a character's face, a weapon seen looking into the muzzle (barrel end), a vehicle's front.
- "top": the image number (1-6) showing the model from ABOVE: top of the head, the top of a weapon (sights side), a vehicle's roof.
- "animation": for a prop only, a fitting generated animation: "none", "spin" (pickups, coins, trophies), "bob", "spinbob", "sway" (flags, plants, hanging lamps), "pulse".
- "confidence": 0..1, "notes": one short sentence in Romanian about what you see.
JSON keys: type, weapon, reference, front, top, animation, confidence, notes.`, inputName, mode, strings.Join(refList, ", "))
	ans, err := aiNow.client.Ask(context.Background(), aiSystem, prompt, imgs)
	if err != nil {
		return nil, err
	}
	var a aiAnalysis
	if err := ai.JSON(ans, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

// orientation turns the "front"/"top" images into a rotation that makes the model face +X with its top up (+Z).
func (a *aiAnalysis) orientation() (vmath.Mat3, bool) {
	if a.Front < 1 || a.Front > 6 || a.Top < 1 || a.Top > 6 {
		return vmath.Mat3{}, false
	}
	f, u := axisVecs[a.Front-1], axisVecs[a.Top-1]
	if math.Abs(f.Dot(u)) > 0.1 {
		return vmath.Mat3{}, false
	}
	l := u.Cross(f)
	return vmath.Mat3{{f[0], f[1], f[2]}, {l[0], l[1], l[2]}, {u[0], u[1], u[2]}}, true
}

type aiReviewResult struct {
	OK       bool     `json:"ok"`
	Problems []string `json:"problems"`
	Fixes    struct {
		Double  bool    `json:"double"`
		Rotate  string  `json:"rotate"`
		MaxTris int     `json:"maxtris"`
		Height  float64 `json:"height"`
		NoFit   bool    `json:"nofit"`
	} `json:"fixes"`
	Summary string `json:"summary"`
}

func (r *aiReviewResult) hasFixes() bool {
	return r.Fixes.Double || r.Fixes.Rotate != "" || r.Fixes.MaxTris > 0 || r.Fixes.Height > 0 || r.Fixes.NoFit
}

// aiReview compares the converted model as the game draws it with the source as Sketchfab shows it.
func aiReview(out *mdl.Model, src *convert.Scene, kind string) (*aiReviewResult, error) {
	eyes := []vmath.Vec3{{1, 0, 0.15}, {0, -1, 0.15}, {-1, 1, 0.5}}
	var imgs []ai.Image
	for i, p := range preview.Views(out, eyes, true) {
		imgs = append(imgs, ai.Image{Label: fmt.Sprintf("RESULT view %d (as Counter-Strike draws it: front faces only)", i+1), PNG: p})
	}
	if src != nil {
		if qm, err := quickModel(src); err == nil {
			for i, p := range preview.Views(qm, eyes, false) {
				imgs = append(imgs, ai.Image{Label: fmt.Sprintf("SOURCE view %d (all faces, like the Sketchfab viewer; may be oriented differently)", i+1), PNG: p})
			}
		}
	}
	prompt := fmt.Sprintf(`This is a converted %s. Compare RESULT with SOURCE and check, for Counter-Strike 1.6:
- missing or see-through parts in RESULT (faces drawn from the wrong side) → fix "double": true;
- the model is not upright or does not face the camera in RESULT view 1 (models must face +X = view 1, stand on Z) → fix "rotate": "x y z" degrees about X (forward axis, roll), Y (left axis, tips forward/back), Z (vertical, turns left/right);
- a player looks broken/stretched, or a weapon lies wrong → describe it;
- obviously wrong size → "height" in game units (a player is 72).
Only propose fixes you are sure about. JSON: {"ok": bool, "problems": [Romanian strings], "fixes": {"double": bool, "rotate": "", "maxtris": 0, "height": 0, "nofit": false}, "summary": "one Romanian sentence"}.`, kind)
	ans, err := aiNow.client.Ask(context.Background(), aiSystem, prompt, imgs)
	if err != nil {
		return nil, err
	}
	var r aiReviewResult
	if err := ai.JSON(ans, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// aiMapBones asks Claude to match bone names when neither the names nor the shape gave a full humanoid match.
func aiMapBones(src, dst []string) (map[string]string, error) {
	prompt := fmt.Sprintf(`Match the bones of a character's skeleton (SOURCE) to the bones of a Counter-Strike 1.6 player skeleton (TARGET, Biped naming). Map every SOURCE bone that clearly corresponds (pelvis/hips, spine bones in order, neck, head, clavicles, upper arms, forearms, hands, fingers → finger bones or the hand, thighs, calves, feet, toes; left/right carefully). Leave out helper/twist/end bones.
SOURCE: %s
TARGET: %s
JSON: {"map": {"source bone": "target bone", ...}}`, jsonList(src), jsonList(dst))
	ans, err := aiNow.client.Ask(context.Background(), aiSystem, prompt, nil)
	if err != nil {
		return nil, err
	}
	var r struct {
		Map map[string]string `json:"map"`
	}
	if err := ai.JSON(ans, &r); err != nil {
		return nil, err
	}
	return r.Map, nil
}

func jsonList(v []string) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// assistantReply is what the in-app assistant answers: a message plus settings for the window to apply.
type assistantReply struct {
	Reply    string            `json:"reply"`
	Settings map[string]string `json:"settings"`
	Convert  bool              `json:"convert"`
}

// aiAssistant answers a chat message about the current work.
func aiAssistant(message, stateJSON, lastLog string, image []byte) (*assistantReply, error) {
	var refs []string
	for _, r := range aiNow.refs {
		refs = append(refs, r.File)
	}
	prompt := fmt.Sprintf(`You are the assistant inside blingmodels. The user writes in Romanian (often without diacritics). Help them convert their model for Counter-Strike 1.6, explain problems simply, and change the window's settings when asked.

Settings you can set (all strings): "mode" (auto|prop|player|v|p|w), "ref" (a reference file from the list, or ""), "rotate" ("x y z" degrees about X = the model's forward axis (roll), Y = its left axis (pitch: tips it forward/back), Z = vertical (turns it left/right); e.g. "0 0 90" turns it a quarter to the left, "0 0 180" makes it face the other way), "maxtris" (number), "height" (game units, only for objects; players always take the reference model's height), "name" (output file name without .mdl), "double" ("1"/"0": draw thin surfaces on both sides), "nofit" ("1"/"0"), "genanim" (none|spin|bob|spinbob|sway|pulse), "anims" ("1"/"0").
Set "convert": true when the user asks to convert/redo now.
Available reference models: %s
Current window state: %s
Last conversion log:
%s

User message: %s

JSON: {"reply": "short Romanian answer", "settings": {...only what changes...}, "convert": bool}`, strings.Join(refs, ", "), stateJSON, tail(lastLog, 3000), message)
	var imgs []ai.Image
	if len(image) > 0 {
		imgs = append(imgs, ai.Image{Label: "Current preview of the converted model", PNG: image})
	}
	ans, err := aiNow.client.Ask(context.Background(), aiSystem, prompt, imgs)
	if err != nil {
		return nil, err
	}
	var r assistantReply
	if err := ai.JSON(ans, &r); err != nil {
		return &assistantReply{Reply: strings.TrimSpace(ans)}, nil
	}
	return &r, nil
}

func tail(s string, n int) string {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}

// refByFile finds a reference model by file name (as the AI or the window names it).
func refByFile(name string) (refModel, bool) {
	name = strings.ToLower(filepath.Base(strings.TrimSpace(name)))
	if name == "" {
		return refModel{}, false
	}
	if !strings.HasSuffix(name, ".mdl") {
		name += ".mdl"
	}
	for _, r := range aiNow.refs {
		if strings.ToLower(r.File) == name {
			return r, true
		}
	}
	return refModel{}, false
}
