package convert

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"blingmodels/internal/mdl"
	"blingmodels/internal/vmath"
)

// DonorMode says how a new mesh goes into an original Counter-Strike model (the "donor", a file the user already
// has): the donor keeps its skeleton, animations, hitboxes, attachments and events, so the result plays exactly like
// the original in game.
type DonorMode int

const (
	DonorPlayer DonorMode = iota // player model: the new body is bound to the donor skeleton
	DonorView                    // v_ model: the donor hands stay, the weapon is replaced
	DonorWorld                   // p_/w_ model: the whole mesh is replaced
)

func (m DonorMode) String() string {
	switch m {
	case DonorPlayer:
		return "jucător"
	case DonorView:
		return "armă v_ (vedere la persoana întâi)"
	default:
		return "armă p_/w_"
	}
}

type DonorOptions struct {
	Mode       DonorMode
	Name       string
	MaxTexture int
	// Keep, for v_ models, matches bone or texture names of the parts to keep (the hands); empty = built-in rules.
	Keep string
	// MapBones (optional, AI) matches bone names when the built-in rules do not recognize the skeleton.
	MapBones func(src, dst []string) (map[string]string, error)
	// Flip turns the fitted weapon 180°: "updown", "frontback" or both (space separated).
	Flip string
	// AutoRotate turns the new weapon onto the old one (principal axes); off = only size and position are matched.
	AutoRotate bool
}

// LoadDonor reads an original model, with its textures file (nameT.mdl) when the textures live there.
func LoadDonor(path string) (*mdl.Model, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var texData []byte
	orig := strings.TrimSuffix(path, ".blingbak") // a blingmodels backup of the original
	ext := filepath.Ext(orig)
	base := strings.TrimSuffix(orig, ext)
	for _, cand := range []string{base + "T" + ext, base + "t" + ext, base + "T.MDL", base + "t.mdl"} {
		if b, err := os.ReadFile(cand); err == nil {
			texData = b
			break
		}
	}
	m, err := mdl.Decode(data, texData)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return m, nil
}

// DonorBoneWorld returns the donor's bone transforms in its reference pose (the pose the mesh is stored in).
func DonorBoneWorld(m *mdl.Model) []vmath.Bone {
	world := make([]vmath.Bone, len(m.Bones))
	for i, b := range m.Bones {
		v := b.Value
		local := vmath.BoneFromPosAngles(vmath.Vec3{float64(v[0]), float64(v[1]), float64(v[2])}, vmath.Vec3{float64(v[3]), float64(v[4]), float64(v[5])})
		if b.Parent >= 0 && int(b.Parent) < i {
			world[i] = world[b.Parent].Mul(local)
		} else {
			world[i] = local
		}
	}
	return world
}

// DonorTris expands the donor's first submodel of every body part into world-space triangles. Mat is the texture
// index (skin family 0); ST holds the original texel coordinates.
func DonorTris(m *mdl.Model, world []vmath.Bone) []Tri {
	var out []Tri
	for _, bp := range m.BodyParts {
		if len(bp.Models) == 0 {
			continue
		}
		sm := bp.Models[0]
		corner := func(tv mdl.TriVert) (Corner, [2]int16, bool) {
			if int(tv.Vert) < 0 || int(tv.Vert) >= len(sm.Verts) || int(tv.Norm) < 0 || int(tv.Norm) >= len(sm.Norms) {
				return Corner{}, [2]int16{}, false
			}
			vb := int(sm.VertBones[tv.Vert])
			nb := int(sm.NormBones[tv.Norm])
			if vb >= len(world) || nb >= len(world) {
				return Corner{}, [2]int16{}, false
			}
			v, n := sm.Verts[tv.Vert], sm.Norms[tv.Norm]
			return Corner{
				Pos:    world[vb].Apply(vmath.Vec3{float64(v[0]), float64(v[1]), float64(v[2])}),
				Normal: world[nb].Rotate(vmath.Vec3{float64(n[0]), float64(n[1]), float64(n[2])}).Norm(),
				Bone:   vb,
			}, [2]int16{tv.S, tv.T}, true
		}
		for _, me := range sm.Meshes {
			texIdx := int(me.SkinRef)
			if len(m.SkinFamilies) > 0 && texIdx >= 0 && texIdx < len(m.SkinFamilies[0]) {
				texIdx = int(m.SkinFamilies[0][texIdx])
			}
			if texIdx < 0 || texIdx >= len(m.Textures) {
				continue
			}
			tw, th := float64(m.Textures[texIdx].Width), float64(m.Textures[texIdx].Height)
			emit := func(a, b, c mdl.TriVert) {
				// File order is clockwise; Tri keeps glTF's counter-clockwise order (Geometry flips it back).
				var t Tri
				ok := true
				for k, tv := range [3]mdl.TriVert{a, c, b} {
					cr, st, good := corner(tv)
					ok = ok && good
					cr.UV = [2]float64{float64(st[0]) / tw, float64(st[1]) / th}
					t.C[k], t.ST[k] = cr, st
				}
				if ok {
					t.Mat, t.HasST = texIdx, true
					out = append(out, t)
				}
			}
			for _, cmd := range me.TriCmds {
				v := cmd.Verts
				for k := 0; k+2 < len(v); k++ {
					switch {
					case cmd.Fan:
						emit(v[0], v[k+1], v[k+2])
					case k%2 == 0:
						emit(v[k], v[k+1], v[k+2])
					default:
						emit(v[k+1], v[k], v[k+2])
					}
				}
			}
		}
	}
	return out
}

var (
	handBones    = regexp.MustCompile(`(?i)(arm|hand|finger|clavicle|wrist|thumb|palm|elbow|bip01 [lr] )`)
	handTextures = regexp.MustCompile(`(?i)(hand|glove|sleeve|arm|finger|skin|wrist|thumb)`)
)

// splitHands separates a v_ model into the parts to keep (hands, arms) and the weapon. Textures named like hands or
// gloves decide first (weapons are often bound to the hand bone); without such names, triangles whose bones all
// belong to the arms are kept.
func splitHands(m *mdl.Model, tris []Tri, keep string) (kept, weapon []Tri, err error) {
	var custom *regexp.Regexp
	if keep != "" {
		if custom, err = regexp.Compile("(?i)" + keep); err != nil {
			return nil, nil, fmt.Errorf("-keep nu e o expresie validă: %v", err)
		}
	}
	byTexture := false
	texMatch := make([]bool, len(m.Textures))
	for i, t := range m.Textures {
		name := strings.TrimSuffix(strings.ToLower(t.Name), ".bmp")
		if custom != nil {
			texMatch[i] = custom.MatchString(name)
		} else {
			texMatch[i] = handTextures.MatchString(name)
		}
		byTexture = byTexture || texMatch[i]
	}
	for _, t := range tris {
		isHand := false
		if byTexture {
			isHand = texMatch[t.Mat]
		} else {
			isHand = true
			for _, c := range t.C {
				name := m.Bones[c.Bone].Name
				if custom != nil && !custom.MatchString(name) || custom == nil && !handBones.MatchString(name+" ") {
					isHand = false
				}
			}
		}
		if isHand {
			kept = append(kept, t)
		} else {
			weapon = append(weapon, t)
		}
	}
	return kept, weapon, nil
}

// fitPlayer scales the new body to the donor's height, stands it on the donor's feet and binds every vertex to the
// bone of the nearest donor vertex (compared in box-normalized space, so a slimmer or wider body still finds the
// matching limb).
func (s *Scene) fitHeight(donor []Tri) {
	dmn, dmx := boundsOf(donor)
	smn, smx := s.Bounds()
	if smx[2]-smn[2] > 1e-9 {
		scale := (dmx[2] - dmn[2]) / (smx[2] - smn[2])
		sc := smn.Add(smx).Scale(0.5)
		dc := dmn.Add(dmx).Scale(0.5)
		s.Transform(identity3(), 1, sc.Scale(-1))
		s.Transform(identity3(), scale, vmath.Vec3{dc[0], dc[1], dc[2]})
	}
}

// bindNearest binds vertices to the bone of the nearest donor vertex; with onlyUnbound, only corners whose Bone is
// -1 (left over by the skeleton matching).
func (s *Scene) bindNearest(donor []Tri, onlyUnbound bool) {
	dmn, dmx := boundsOf(donor)
	smn, smx := s.Bounds()
	type pv struct {
		p    vmath.Vec3
		bone int
	}
	dext, sext := dmx.Sub(dmn), smx.Sub(smn)
	norm := func(p, mn vmath.Vec3, ext vmath.Vec3) vmath.Vec3 {
		var q vmath.Vec3
		for i := 0; i < 3; i++ {
			if ext[i] > 1e-9 {
				q[i] = (p[i] - mn[i]) / ext[i] * dext[2] // keep proportions comparable (height units)
			}
		}
		return q
	}
	seen := map[vmath.Vec3]bool{}
	var pts []pv
	for _, t := range donor {
		for _, c := range t.C {
			if !seen[c.Pos] {
				seen[c.Pos] = true
				pts = append(pts, pv{norm(c.Pos, dmn, dext), c.Bone})
			}
		}
	}
	// Uniform grid over the normalized box for the nearest-vertex search.
	const cells = 24
	cell := dext[2] / cells
	if cell <= 0 {
		cell = 1
	}
	type ck [3]int
	grid := map[ck][]int{}
	key := func(p vmath.Vec3) ck {
		return ck{int(math.Floor(p[0] / cell)), int(math.Floor(p[1] / cell)), int(math.Floor(p[2] / cell))}
	}
	for i, p := range pts {
		k := key(p.p)
		grid[k] = append(grid[k], i)
	}
	nearest := func(q vmath.Vec3) int {
		k := key(q)
		best, bestD := 0, math.Inf(1)
		for r := 0; r <= cells; r++ {
			for x := k[0] - r; x <= k[0]+r; x++ {
				for y := k[1] - r; y <= k[1]+r; y++ {
					for z := k[2] - r; z <= k[2]+r; z++ {
						if r > 0 && x != k[0]-r && x != k[0]+r && y != k[1]-r && y != k[1]+r && z != k[2]-r && z != k[2]+r {
							continue // inner shells were searched already
						}
						for _, i := range grid[ck{x, y, z}] {
							d := pts[i].p.Sub(q)
							if dd := d.Dot(d); dd < bestD {
								best, bestD = pts[i].bone, dd
							}
						}
					}
				}
			}
			// Anything outside this shell is at least r*cell away.
			if bestD < float64(r*r)*cell*cell {
				break
			}
		}
		return best
	}
	cache := map[vmath.Vec3]int{}
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			if onlyUnbound && s.Tris[i].C[k].Bone >= 0 {
				continue
			}
			p := s.Tris[i].C[k].Pos
			b, ok := cache[p]
			if !ok {
				b = nearest(norm(p, smn, sext))
				cache[p] = b
			}
			s.Tris[i].C[k].Bone = b
		}
	}
}

// BuildWithDonor puts the scene's mesh into the donor model. The returned notes describe what was done.
func BuildWithDonor(s *Scene, donor *mdl.Model, o DonorOptions) (*mdl.Model, []string, error) {
	if o.MaxTexture <= 0 {
		o.MaxTexture = 512
	}
	for _, sq := range donor.Sequences {
		if sq.SeqGroup != 0 {
			return nil, nil, fmt.Errorf("modelul original își ține animațiile în fișiere separate (model01.mdl…); nu e suportat")
		}
	}
	if len(donor.Bones) == 0 {
		return nil, nil, fmt.Errorf("modelul original nu are oase")
	}
	world := DonorBoneWorld(donor)
	dtris := DonorTris(donor, world)
	if len(dtris) == 0 {
		return nil, nil, fmt.Errorf("modelul original nu are geometrie")
	}
	var notes []string
	var kept []Tri
	switch o.Mode {
	case DonorPlayer:
		if len(s.Bones) <= 8 {
			// No usable skeleton (a statue-like export): build one from the shape.
			if msg, err := s.AutoRig(); err == nil {
				notes = append(notes, msg)
			} else {
				notes = append(notes, "nu am putut construi scheletul: "+err.Error())
			}
		}
		if msg := s.orientBody(); msg != "" {
			notes = append(notes, msg)
		}
		s.fitHeight(dtris)
		srcNames := make([]string, len(s.Bones))
		srcParent := make([]int, len(s.Bones))
		for i, b := range s.Bones {
			srcNames[i], srcParent[i] = b.Name, b.Parent
		}
		dstNames := make([]string, len(donor.Bones))
		dstParent := make([]int, len(donor.Bones))
		for i, b := range donor.Bones {
			dstNames[i], dstParent[i] = b.Name, int(b.Parent)
		}
		// The original's skeleton is read from its shape first (immune to helper bones and naming styles).
		dpos := make([]vmath.Vec3, len(world))
		for i := range world {
			dpos[i] = world[i].T
		}
		dmn, dmx := boundsOf(dtris)
		// CS players use Biped names (left/right are certain); helper bones are left out by the name rules. The
		// shape is the fallback for skeletons with other names.
		dstKeys := classifyAll(dstNames)
		if !coreKeys(dstKeys) {
			dstKeys = geoClassifyBones(dpos, dstParent, dmn, dmx)
		}
		var srcKeys map[int]boneKey
		how := ""
		if len(s.Bones) > 8 {
			srcKeys = classifyAll(srcNames)
			how = "după numele oaselor"
			if !coreKeys(srcKeys) {
				if g := s.geoClassify(); coreKeys(g) {
					srcKeys, how = g, "după poziția oaselor (numele nu spuneau nimic)"
				}
			}
		}
		mapping := map[int]int{}
		if coreKeys(srcKeys) && coreKeys(dstKeys) {
			mapping = mapKeys(srcKeys, dstKeys, srcParent, dstParent)
		}
		matched := coreMappedKeys(mapping, srcKeys)
		if !matched && len(s.Bones) > 8 && o.MapBones != nil {
			if byName, err := o.MapBones(srcNames, dstNames); err == nil {
				idx := map[string]int{}
				for i, n := range dstNames {
					idx[strings.ToLower(n)] = i
				}
				mapping = map[int]int{}
				for i, n := range srcNames {
					if d, ok := idx[strings.ToLower(byName[n])]; ok {
						mapping[i] = d
					}
				}
				matched, how = len(mapping) >= 10, "cu ajutorul AI"
			} else {
				notes = append(notes, "AI-ul nu a putut potrivi oasele: "+err.Error())
			}
		}
		if matched {
			before := append([]Tri(nil), s.Tris...)
			s.retargetPlayer(world, dstParent, mapping, dstKeys)
			if bad := stretched(before, s.Tris); bad > 0.06 {
				// Safety net: a broken result is worse than a simple one.
				s.Tris = before
				s.bindNearest(dtris, false)
				notes = append(notes, fmt.Sprintf("potrivirea scheletului ar fi deformat modelul (%.0f%% triunghiuri întinse); am legat corpul după poziție", bad*100))
			} else {
				s.bindNearest(dtris, true)
				notes = append(notes, fmt.Sprintf("scheletul modelului (%d oase) a fost recunoscut %s și potrivit pe cel original (%d oase legate); corpul e adus în poza originalului (%d animații)", len(s.Bones)-1, how, len(mapping), len(donor.Sequences)))
			}
		} else {
			s.bindNearest(dtris, false)
			if len(s.Bones) > 8 {
				notes = append(notes, "scheletul modelului nu seamănă cu unul de om; corpul e legat după poziție (iese bine dacă stă în aceeași poză ca originalul)")
			} else {
				notes = append(notes, "modelul nu are schelet; corpul e legat după poziție de oasele originalului (iese bine dacă stă în aceeași poză ca originalul)")
			}
		}
	case DonorView, DonorWorld:
		weapon := dtris
		if o.Mode == DonorView {
			var err error
			if kept, weapon, err = splitHands(donor, dtris, o.Keep); err != nil {
				return nil, nil, err
			}
			if len(kept) == 0 {
				notes = append(notes, "nu am găsit mâinile în modelul original; tot modelul vechi a fost înlocuit (încearcă -keep)")
			} else {
				notes = append(notes, fmt.Sprintf("am păstrat mâinile originale (%d triunghiuri)", len(kept)))
			}
		}
		if len(weapon) == 0 {
			return nil, nil, fmt.Errorf("nu am găsit arma în modelul original (tot ce e acolo pare a fi mâini); încearcă -keep")
		}
		counts := make([]int, len(donor.Bones))
		for _, t := range weapon {
			for _, c := range t.C {
				counts[c.Bone]++
			}
		}
		main := 0
		for b, n := range counts {
			if n > counts[main] {
				main = b
			}
		}
		s.FitTo(weapon, o.AutoRotate)
		for _, f := range strings.Fields(o.Flip) {
			s.FlipWeapon(f)
		}
		// Moving parts (magazine, slide, bolt…) go to the donor bone that animates the same part.
		partBone := map[string]int{}
		for b, bone := range donor.Bones {
			if g := partGroup(bone.Name); g != "" && !handBones.MatchString(bone.Name+" ") {
				if _, ok := partBone[g]; !ok {
					partBone[g] = b
				}
			}
		}
		moved := map[string]int{}
		for i := range s.Tris {
			bone := main
			if g := partGroup(s.Tris[i].Part); g != "" {
				if b, ok := partBone[g]; ok {
					bone = b
					moved[g]++
				}
			}
			for k := range s.Tris[i].C {
				s.Tris[i].C[k].Bone = bone
			}
		}
		notes = append(notes, fmt.Sprintf("arma nouă e pusă peste cea veche și legată de osul %q", donor.Bones[main].Name))
		for g, n := range moved {
			notes = append(notes, fmt.Sprintf("piesa „%s” (%d triunghiuri) se mișcă cu osul %q din original", partLabel[g], n, donor.Bones[partBone[g]].Name))
		}
	}

	// Textures: the new materials first, then the donor textures the kept parts use.
	textures, plans := s.Textures(o.MaxTexture)
	used := map[string]bool{}
	for _, t := range textures {
		used[strings.ToLower(t.Name)] = true
	}
	remap := map[int]int{}
	for i := range kept {
		old := kept[i].Mat
		ni, ok := remap[old]
		if !ok {
			t := donor.Textures[old]
			t.Pixels = append([]byte(nil), t.Pixels...)
			name := strings.TrimSuffix(t.Name, filepath.Ext(t.Name))
			t.Name = uniqueName(name, 58, used) + ".bmp"
			ni = len(textures)
			remap[old] = ni
			textures = append(textures, t)
			plans = append(plans, texPlan{1, 1})
		}
		kept[i].Mat = ni
	}
	if len(textures) > mdl.MaxTextures {
		return nil, nil, fmt.Errorf("prea multe texturi: %d (maxim %d)", len(textures), mdl.MaxTextures)
	}
	all := append(append([]Tri(nil), s.Tris...), kept...)
	parts, err := Geometry(all, world, textures, plans, func(mat int) int { return mat }, "body")
	if err != nil {
		return nil, nil, err
	}
	out := *donor
	out.Name = o.Name
	out.Textures = textures
	fam := make([]int16, len(textures))
	for i := range fam {
		fam[i] = int16(i)
	}
	out.SkinFamilies = [][]int16{fam}
	out.BodyParts = parts
	if o.Mode == DonorWorld {
		out.Hitboxes = hitboxes(parts, len(donor.Bones))
	}
	return &out, notes, nil
}

var partGroups = []struct {
	group string
	re    *regexp.Regexp
}{
	{"mag", regexp.MustCompile(`(?i)(mag|clip|ammo|cartridge|incarcator)`)},
	{"slide", regexp.MustCompile(`(?i)(slide|bolt|charg|cocking|pump|carrier|handle|lever)`)},
	{"trigger", regexp.MustCompile(`(?i)trigger`)},
	{"hammer", regexp.MustCompile(`(?i)hammer`)},
	{"cylinder", regexp.MustCompile(`(?i)(cylinder|drum)`)},
	{"pin", regexp.MustCompile(`(?i)(\bpin\b|spoon)`)},
}

var partLabel = map[string]string{"mag": "încărcător", "slide": "închizător", "trigger": "trăgaci", "hammer": "cocoș", "cylinder": "butoiaș", "pin": "cui/siguranță"}

// partGroup tells which moving weapon part a node or bone name is ("" = the weapon body).
func partGroup(name string) string {
	for _, g := range partGroups {
		if g.re.MatchString(name) {
			return g.group
		}
	}
	return ""
}

// stretched is the share of triangles whose longest edge grew more than 2.5 times (a sign of a broken retarget).
func stretched(before, after []Tri) float64 {
	if len(before) == 0 || len(before) != len(after) {
		return 0
	}
	longest := func(t Tri) float64 {
		return math.Max(t.C[0].Pos.Sub(t.C[1].Pos).Len(), math.Max(t.C[1].Pos.Sub(t.C[2].Pos).Len(), t.C[2].Pos.Sub(t.C[0].Pos).Len()))
	}
	bad := 0
	for i := range before {
		if l0 := longest(before[i]); l0 > 1e-6 && longest(after[i]) > 2.5*l0+0.5 {
			bad++
		}
	}
	return float64(bad) / float64(len(before))
}
