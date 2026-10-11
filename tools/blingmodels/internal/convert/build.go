package convert

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"blingmodels/internal/mdl"
	"blingmodels/internal/tex"
	"blingmodels/internal/vmath"
)

type BuildOptions struct {
	Name       string // internal model name (file name)
	MaxTexture int    // 512 by default
}

func f32(v vmath.Vec3) mdl.Vec { return mdl.Vec{float32(v[0]), float32(v[1]), float32(v[2])} }

var noControllers = [6]int32{-1, -1, -1, -1, -1, -1}

// localPose turns world transforms into the six bone values (position, Euler angles) relative to each parent.
func localPose(bones []SBone, world []vmath.Bone) [][6]float64 {
	out := make([][6]float64, len(bones))
	for i, b := range bones {
		local := world[i]
		if b.Parent >= 0 {
			local = world[b.Parent].Inverse().Mul(world[i])
		}
		p, a := local.PosAngles()
		out[i] = [6]float64{p[0], p[1], p[2], a[0], a[1], a[2]}
	}
	return out
}

func wrapPi(a float64) float64 {
	a = math.Mod(a+math.Pi, 2*math.Pi)
	if a < 0 {
		a += 2 * math.Pi
	}
	return a - math.Pi
}

// Skeleton builds the MDL bones and, for every clip, the sequence animation channels.
func (s *Scene) Skeleton() ([]mdl.Bone, []mdl.Sequence) {
	rest := make([]vmath.Bone, len(s.Bones))
	for i, b := range s.Bones {
		rest[i] = b.Rest
	}
	restLocal := localPose(s.Bones, rest)
	type clipLocal struct {
		frames [][][6]float64
	}
	var clips []clipLocal
	maxDelta := make([][6]float64, len(s.Bones))
	for _, c := range s.Clips {
		var cl clipLocal
		for _, fr := range c.Frames {
			lp := localPose(s.Bones, fr)
			for b := range lp {
				for ch := 0; ch < 6; ch++ {
					d := lp[b][ch] - restLocal[b][ch]
					if ch >= 3 {
						d = wrapPi(d)
					}
					lp[b][ch] = d
					maxDelta[b][ch] = math.Max(maxDelta[b][ch], math.Abs(d))
				}
			}
			cl.frames = append(cl.frames, lp)
		}
		clips = append(clips, cl)
	}
	bones := make([]mdl.Bone, len(s.Bones))
	for i, b := range s.Bones {
		mb := mdl.Bone{Name: b.Name, Parent: int32(b.Parent), Controller: noControllers}
		for ch := 0; ch < 6; ch++ {
			mb.Value[ch] = float32(restLocal[i][ch])
			if maxDelta[i][ch] > 1e-7 {
				mb.Scale[ch] = float32(maxDelta[i][ch] / 32000)
			} else if ch < 3 {
				mb.Scale[ch] = 1
			} else {
				mb.Scale[ch] = float32(math.Pi / 32000)
			}
		}
		bones[i] = mb
	}
	var seqs []mdl.Sequence
	used := map[string]bool{}
	for ci, c := range s.Clips {
		frames := clips[ci].frames
		anim := make([][6][]int16, len(s.Bones))
		for b := range s.Bones {
			for ch := 0; ch < 6; ch++ {
				if maxDelta[b][ch] <= 1e-7 {
					continue
				}
				vals := make([]int16, len(frames))
				nonzero := false
				for f := range frames {
					v := math.Round(frames[f][b][ch] / float64(bones[b].Scale[ch]))
					vals[f] = int16(math.Max(-32767, math.Min(32767, v)))
					if vals[f] != 0 {
						nonzero = true
					}
				}
				if nonzero {
					anim[b][ch] = vals
				}
			}
		}
		seqs = append(seqs, mdl.Sequence{
			Label: uniqueName(cleanName(c.Name, fmt.Sprintf("anim%d", ci+1)), 31, used), FPS: float32(c.FPS), Flags: mdl.SeqLooping,
			NumFrames: int32(len(frames)), Anims: [][][6][]int16{anim},
		})
	}
	if len(seqs) == 0 {
		seqs = []mdl.Sequence{{Label: "idle", FPS: 30, Flags: mdl.SeqLooping, NumFrames: 1, Anims: [][][6][]int16{make([][6][]int16, len(s.Bones))}}}
	}
	seqs[0].Activity, seqs[0].ActWeight = mdl.ActIdle, 1
	return bones, seqs
}

// texPlan is how a material becomes a texture: how many times the image repeats (UVs beyond 0..1).
type texPlan struct{ tileU, tileV int }

func planTextures(tris []Tri, nmat int) []texPlan {
	plans := make([]texPlan, nmat)
	for i := range plans {
		plans[i] = texPlan{1, 1}
	}
	for _, t := range tris {
		minU, minV := math.Inf(1), math.Inf(1)
		maxU, maxV := math.Inf(-1), math.Inf(-1)
		for _, c := range t.C {
			minU, maxU = math.Min(minU, c.UV[0]), math.Max(maxU, c.UV[0])
			minV, maxV = math.Min(minV, c.UV[1]), math.Max(maxV, c.UV[1])
		}
		eu := int(math.Ceil(maxU - math.Floor(minU) - 1e-6))
		ev := int(math.Ceil(maxV - math.Floor(minV) - 1e-6))
		p := &plans[t.Mat]
		if eu > p.tileU {
			p.tileU = eu
		}
		if ev > p.tileV {
			p.tileV = ev
		}
	}
	for i := range plans {
		// More than 4 repeats would waste the 512 px budget; such UVs are clamped instead.
		plans[i].tileU = min(plans[i].tileU, 4)
		plans[i].tileV = min(plans[i].tileV, 4)
	}
	return plans
}

// Textures converts the scene materials (one texture each).
func (s *Scene) Textures(maxSide int) ([]mdl.Texture, []texPlan) {
	plans := planTextures(s.Tris, len(s.Materials))
	used := map[string]bool{}
	var out []mdl.Texture
	for i, m := range s.Materials {
		var r tex.Result
		if m.Image != nil {
			r = tex.Convert(m.Image, tex.Options{MaxSide: maxSide, Factor: m.Factor, Mask: m.Mask, Cutoff: m.Cutoff, TileU: plans[i].tileU, TileV: plans[i].tileV})
		} else {
			r = tex.Solid(m.Factor)
			plans[i] = texPlan{1, 1}
		}
		name := cleanName(m.Name, fmt.Sprintf("tex%d", i))
		// Names drive engine features (chrome, remap colors): keep ours plain.
		lower := strings.ToLower(name)
		if strings.Contains(lower, "chrome") || strings.HasPrefix(lower, "remap") || strings.HasPrefix(lower, "dm_") {
			name = "t_" + name
		}
		name = uniqueName(strings.ReplaceAll(name, " ", "_"), 58, used) + ".bmp"
		t := mdl.Texture{Name: name, Width: r.Width, Height: r.Height, Pixels: r.Pixels, Palette: r.Palette}
		if r.Masked {
			t.Flags |= mdl.TexMasked
		}
		out = append(out, t)
	}
	return out, plans
}

// texCoords maps a triangle's UVs to texel coordinates (s, t), shifting it by whole tiles so it lands on the
// (possibly tiled) texture.
func texCoords(t Tri, plan texPlan, w, h int) [3][2]int16 {
	minU, minV := math.Inf(1), math.Inf(1)
	for _, c := range t.C {
		minU, minV = math.Min(minU, c.UV[0]), math.Min(minV, c.UV[1])
	}
	shiftU, shiftV := math.Floor(minU+1e-6), math.Floor(minV+1e-6)
	var out [3][2]int16
	for k, c := range t.C {
		u := (c.UV[0] - shiftU) / float64(plan.tileU)
		v := (c.UV[1] - shiftV) / float64(plan.tileV)
		u = math.Max(0, math.Min(1, u))
		v = math.Max(0, math.Min(1, v))
		out[k] = [2]int16{int16(math.Round(u * float64(w))), int16(math.Round(v * float64(h)))}
	}
	return out
}

type vertKey struct {
	bone    int
	x, y, z float32
}

type normKey struct {
	bone    int
	x, y, z float32
}

// Geometry builds body parts from triangles: vertices in bone space, normals grouped by mesh, triangle strips, and a
// new body part whenever a submodel would pass 2048 vertices or normals.
func Geometry(tris []Tri, boneWorld []vmath.Bone, textures []mdl.Texture, plans []texPlan, skinRefOf func(mat int) int, namePrefix string) ([]mdl.BodyPart, error) {
	inv := make([]vmath.Bone, len(boneWorld))
	for i, b := range boneWorld {
		inv[i] = b.Inverse()
	}
	order := make([]int, len(tris))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return tris[order[a]].Mat < tris[order[b]].Mat })

	type meshBuild struct {
		mat     int
		corners [][3]mdl.TriVert
		norms   map[normKey]int
		normArr []mdl.Vec
		normBn  []byte
	}
	type modelBuild struct {
		verts  map[vertKey]int
		vArr   []mdl.Vec
		vBones []byte
		meshes []*meshBuild
		nnorms int
	}
	var models []*modelBuild
	cur := &modelBuild{verts: map[vertKey]int{}}
	models = append(models, cur)
	meshFor := func(m *modelBuild, mat int) *meshBuild {
		if n := len(m.meshes); n > 0 && m.meshes[n-1].mat == mat {
			return m.meshes[n-1]
		}
		mb := &meshBuild{mat: mat, norms: map[normKey]int{}}
		m.meshes = append(m.meshes, mb)
		return mb
	}
	for _, ti := range order {
		t := tris[ti]
		var vk [3]vertKey
		var nk [3]normKey
		var lp [3]vmath.Vec3
		var ln [3]vmath.Vec3
		for k, c := range t.C {
			b := c.Bone
			if b < 0 || b >= len(inv) {
				b = 0
			}
			lp[k] = inv[b].Apply(c.Pos)
			ln[k] = inv[b].Rotate(c.Normal).Norm()
			vk[k] = vertKey{b, float32(lp[k][0]), float32(lp[k][1]), float32(lp[k][2])}
			nk[k] = normKey{b, float32(ln[k][0]), float32(ln[k][1]), float32(ln[k][2])}
		}
		// Room left in the current submodel?
		newV, newN := 0, 0
		mesh := meshFor(cur, t.Mat)
		for k := 0; k < 3; k++ {
			if _, ok := cur.verts[vk[k]]; !ok {
				newV++
			}
			if _, ok := mesh.norms[nk[k]]; !ok {
				newN++
			}
		}
		if len(cur.vArr)+newV > mdl.MaxVerts || cur.nnorms+newN > mdl.MaxNorms {
			if len(cur.meshes) > 0 && len(mesh.corners) == 0 {
				cur.meshes = cur.meshes[:len(cur.meshes)-1]
			}
			cur = &modelBuild{verts: map[vertKey]int{}}
			models = append(models, cur)
			mesh = meshFor(cur, t.Mat)
		}
		var tv [3]mdl.TriVert
		st := t.ST
		if !t.HasST {
			st = texCoords(t, plans[t.Mat], textures[skinRefOf(t.Mat)].Width, textures[skinRefOf(t.Mat)].Height)
		}
		for k := 0; k < 3; k++ {
			vi, ok := cur.verts[vk[k]]
			if !ok {
				vi = len(cur.vArr)
				cur.verts[vk[k]] = vi
				cur.vArr = append(cur.vArr, mdl.Vec{vk[k].x, vk[k].y, vk[k].z})
				cur.vBones = append(cur.vBones, byte(vk[k].bone))
			}
			ni, ok := mesh.norms[nk[k]]
			if !ok {
				ni = len(mesh.normArr)
				mesh.norms[nk[k]] = ni
				mesh.normArr = append(mesh.normArr, mdl.Vec{nk[k].x, nk[k].y, nk[k].z})
				mesh.normBn = append(mesh.normBn, byte(nk[k].bone))
				cur.nnorms++
			}
			tv[k] = mdl.TriVert{Vert: int16(vi), Norm: int16(ni), S: st[k][0], T: st[k][1]}
		}
		// GoldSrc front faces are clockwise (glTF: counter-clockwise).
		tv[1], tv[2] = tv[2], tv[1]
		mesh.corners = append(mesh.corners, tv)
	}

	var parts []mdl.BodyPart
	for mi, m := range models {
		if len(m.meshes) == 0 {
			continue
		}
		sm := mdl.SubModel{Name: fmt.Sprintf("%s%d", namePrefix, mi+1), Verts: m.vArr, VertBones: m.vBones}
		// Normals grouped by mesh; tri commands use model-wide normal indices.
		for _, me := range m.meshes {
			base := len(sm.Norms)
			sm.Norms = append(sm.Norms, me.normArr...)
			sm.NormBones = append(sm.NormBones, me.normBn...)
			for i := range me.corners {
				for k := 0; k < 3; k++ {
					me.corners[i][k].Norm += int16(base)
				}
			}
			cmds := Stripify(me.corners)
			sm.Meshes = append(sm.Meshes, mdl.Mesh{SkinRef: int32(skinRefOf(me.mat)), NumNorms: int32(len(me.normArr)), NumTris: int32(len(me.corners)), TriCmds: cmds})
		}
		var r float64
		for i, v := range sm.Verts {
			// Bounding radius in the reference pose (vertices are bone-local).
			wp := boneWorld[sm.VertBones[i]].Apply(vmath.Vec3{float64(v[0]), float64(v[1]), float64(v[2])})
			r = math.Max(r, wp.Len())
		}
		sm.BoundingRadius = float32(r)
		parts = append(parts, mdl.BodyPart{Name: sm.Name, Base: 1, Models: []mdl.SubModel{sm}})
	}
	if len(parts) == 0 {
		return nil, fmt.Errorf("nu a rămas niciun triunghi")
	}
	if len(parts) > mdl.MaxBodyParts {
		return nil, fmt.Errorf("modelul e prea mare pentru GoldSrc (%d părți de câte 2048 vârfuri; maxim %d); folosește -maxtris mai mic", len(parts), mdl.MaxBodyParts)
	}
	return parts, nil
}

// Stripify joins triangles into OpenGL triangle strips (the engine draws each command with glBegin/glEnd, so fewer,
// longer strips render faster). Triangles keep their winding: in a strip, triangle k uses (v[k], v[k+1], v[k+2]) for
// even k and (v[k+1], v[k], v[k+2]) for odd k.
func Stripify(tris [][3]mdl.TriVert) []mdl.TriCmd {
	type edge struct{ a, b mdl.TriVert }
	byEdge := map[edge][]int{}
	for i, t := range tris {
		for k := 0; k < 3; k++ {
			byEdge[edge{t[k], t[(k+1)%3]}] = append(byEdge[edge{t[k], t[(k+1)%3]}], i)
		}
	}
	used := make([]bool, len(tris))
	// next finds an unused triangle containing the directed edge a→b and returns its third corner.
	next := func(a, b mdl.TriVert) (int, mdl.TriVert, bool) {
		for _, ti := range byEdge[edge{a, b}] {
			if used[ti] {
				continue
			}
			t := tris[ti]
			for k := 0; k < 3; k++ {
				if t[k] == a && t[(k+1)%3] == b {
					return ti, t[(k+2)%3], true
				}
			}
		}
		return 0, mdl.TriVert{}, false
	}
	var cmds []mdl.TriCmd
	for start := range tris {
		if used[start] {
			continue
		}
		// Try the three rotations of the first triangle and keep the longest strip.
		var best []mdl.TriVert
		var bestTris []int
		for rot := 0; rot < 3; rot++ {
			t := tris[start]
			strip := []mdl.TriVert{t[rot], t[(rot+1)%3], t[(rot+2)%3]}
			taken := []int{start}
			used[start] = true
			for len(strip) < 30000 {
				n := len(strip)
				k := n - 2 // index of the next triangle in the strip
				var a, b mdl.TriVert
				if k%2 == 0 {
					a, b = strip[n-2], strip[n-1]
				} else {
					a, b = strip[n-1], strip[n-2]
				}
				ti, c, ok := next(a, b)
				if !ok {
					break
				}
				used[ti] = true
				taken = append(taken, ti)
				strip = append(strip, c)
			}
			for _, ti := range taken {
				used[ti] = false
			}
			if len(strip) > len(best) {
				best, bestTris = strip, taken
			}
		}
		for _, ti := range bestTris {
			used[ti] = true
		}
		cmds = append(cmds, mdl.TriCmd{Verts: best})
	}
	return cmds
}

// BuildProp converts a scene into a standalone model (props, world models, animated objects).
func BuildProp(s *Scene, o BuildOptions) (*mdl.Model, error) {
	if o.MaxTexture <= 0 {
		o.MaxTexture = 512
	}
	bones, seqs := s.Skeleton()
	textures, plans := s.Textures(o.MaxTexture)
	if len(textures) > mdl.MaxTextures {
		return nil, fmt.Errorf("modelul are %d materiale; GoldSrc acceptă cel mult %d", len(textures), mdl.MaxTextures)
	}
	rest := make([]vmath.Bone, len(s.Bones))
	for i, b := range s.Bones {
		rest[i] = b.Rest
	}
	parts, err := Geometry(s.Tris, rest, textures, plans, func(mat int) int { return mat }, "body")
	if err != nil {
		return nil, err
	}
	mn, mx := s.Bounds()
	fam := make([]int16, len(textures))
	for i := range fam {
		fam[i] = int16(i)
	}
	for i := range seqs {
		seqs[i].BBMin, seqs[i].BBMax = f32(mn), f32(mx)
	}
	m := &mdl.Model{
		Name:         o.Name,
		BBMin:        f32(mn),
		BBMax:        f32(mx),
		Bones:        bones,
		Sequences:    seqs,
		Textures:     textures,
		SkinFamilies: [][]int16{fam},
		BodyParts:    parts,
		Hitboxes:     hitboxes(parts, len(bones)),
	}
	return m, nil
}

// hitboxes: one box per bone that has vertices (bone space), like studiomdl's automatic hitboxes.
func hitboxes(parts []mdl.BodyPart, nbones int) []mdl.Hitbox {
	mins := make([]mdl.Vec, nbones)
	maxs := make([]mdl.Vec, nbones)
	has := make([]bool, nbones)
	for _, bp := range parts {
		for _, sm := range bp.Models {
			for i, v := range sm.Verts {
				b := sm.VertBones[i]
				if !has[b] {
					mins[b], maxs[b], has[b] = v, v, true
					continue
				}
				for c := 0; c < 3; c++ {
					mins[b][c] = float32(math.Min(float64(mins[b][c]), float64(v[c])))
					maxs[b][c] = float32(math.Max(float64(maxs[b][c]), float64(v[c])))
				}
			}
		}
	}
	var out []mdl.Hitbox
	for b := 0; b < nbones; b++ {
		if has[b] {
			out = append(out, mdl.Hitbox{Bone: int32(b), BBMin: mins[b], BBMax: maxs[b]})
		}
	}
	return out
}
