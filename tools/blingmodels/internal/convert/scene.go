// Package convert turns a glTF scene into a GoldSrc studio model: axis and unit conversion, bones and animations,
// rigid skinning, materials and textures, engine limits (2048 vertices per submodel, 128 bones, 512 px textures).
package convert

import (
	"fmt"
	"image"
	"math"
	"sort"
	"strings"

	"blingmodels/internal/gltf"
	"blingmodels/internal/simplify"
	"blingmodels/internal/vmath"
)

// Corner is one triangle corner in GoldSrc space (Z up, model facing +X, game units).
type Corner struct {
	Pos    vmath.Vec3
	Normal vmath.Vec3
	UV     [2]float64
	Bone   int
	// W keeps the skin weights (up to 4 bones, largest first) for re-posing; the engine itself binds each vertex
	// to Bone only.
	W [4]Weight
}

// Weight is one bone's share in a skinned vertex.
type Weight = simplify.Weight

type Tri struct {
	C   [3]Corner
	Mat int
	// Double: also drawn from the back (open surfaces of double-sided materials); the back face is added last, in
	// Geometry, so simplification sees each surface once.
	Double bool
	// Part names the glTF node/mesh the triangle came from (weapon parts: magazine, slide…).
	Part string
	// ST, when HasST is set, are texel coordinates used as they are (triangles kept from an original model).
	ST    [3][2]int16
	HasST bool
}

type Material struct {
	Name   string
	Image  image.Image // nil = solid color
	Factor [4]float64
	Mask   bool
	Cutoff float64
}

type SBone struct {
	Name   string
	Parent int
	Rest   vmath.Bone // world transform in the reference pose
}

// Clip is an animation sampled at FPS: Frames[f][bone] = world transform.
type Clip struct {
	Name   string
	FPS    float64
	Frames [][]vmath.Bone
}

type Scene struct {
	Bones     []SBone
	Tris      []Tri
	Materials []Material
	Clips     []Clip
}

// P maps glTF axes (Y up, model facing +Z) to GoldSrc (Z up, facing +X): GS = (z, x, y). It is a rotation (det +1),
// so triangle winding is kept.
var axisP = vmath.Mat3{{0, 0, 1}, {1, 0, 0}, {0, 1, 0}}

type LoadOptions struct {
	Scale  float64 // glTF units (meters) to game units; 39.37 = 1 m → 1 inch-unit
	FPS    float64
	MaxFPS int
	Anims  bool
	// DoubleSided draws every open surface from both sides (not only materials marked double-sided).
	DoubleSided bool
}

func toGSBone(m vmath.Mat4, scale float64) vmath.Bone {
	r := vmath.Orthonormalize(m.Rot3())
	return vmath.Bone{R: axisP.Mul(r).Mul(axisP.Transpose()), T: axisP.MulVec(m.Translation()).Scale(scale)}
}

func toGSPoint(v vmath.Vec3, scale float64) vmath.Vec3 { return axisP.MulVec(v).Scale(scale) }
func toGSDir(v vmath.Vec3) vmath.Vec3                  { return axisP.MulVec(v).Norm() }

// LoadScene reads every visible mesh of the default scene.
func LoadScene(d *gltf.Doc, o LoadOptions) (*Scene, error) {
	if o.Scale <= 0 {
		o.Scale = 39.37
	}
	if o.FPS <= 0 {
		o.FPS = 30
	}
	parents := d.Parents()
	rest := d.WorldMatrices(nil, 0)
	for i, m := range rest {
		if !gltf.IsFinite(m) {
			return nil, fmt.Errorf("nodul %q are o transformare invalidă (NaN)", d.Nodes[i].Name)
		}
	}

	// Visible nodes: everything reachable from the scene roots.
	visible := make([]bool, len(d.Nodes))
	var mark func(i, depth int)
	mark = func(i, depth int) {
		if i < 0 || i >= len(d.Nodes) || visible[i] || depth > 512 {
			return
		}
		visible[i] = true
		for _, c := range d.Nodes[i].Children {
			mark(c, depth+1)
		}
	}
	for _, r := range d.SceneRoots() {
		mark(r, 0)
	}

	clips, err := d.Clips()
	if err != nil {
		return nil, err
	}
	if !o.Anims {
		clips = nil
	}

	// Which nodes become bones: skin joints, else animated nodes; always behind a static root bone.
	isBone := make([]bool, len(d.Nodes))
	usedSkins := map[int]bool{}
	for i, n := range d.Nodes {
		if visible[i] && n.Mesh != nil && n.Skin != nil && *n.Skin >= 0 && *n.Skin < len(d.Skins) {
			usedSkins[*n.Skin] = true
		}
	}
	jointIBM := map[int]vmath.Mat4{}
	for si := range usedSkins {
		sk := d.Skins[si]
		var ibms [][]float64
		if sk.InverseBindMatrices != nil {
			if ibms, err = d.Floats(*sk.InverseBindMatrices); err != nil {
				return nil, err
			}
		}
		for k, j := range sk.Joints {
			if j < 0 || j >= len(d.Nodes) {
				continue
			}
			isBone[j] = true
			if _, ok := jointIBM[j]; !ok && k < len(ibms) && len(ibms[k]) == 16 {
				var m vmath.Mat4
				copy(m[:], ibms[k])
				jointIBM[j] = m
			}
		}
	}
	if len(usedSkins) == 0 {
		for _, c := range clips {
			for n := range c.Translation {
				isBone[n] = true
			}
			for n := range c.Rotation {
				isBone[n] = true
			}
			for n := range c.Scale {
				isBone[n] = true
			}
		}
	}
	// Order bones so parents come first (by depth, then index).
	depth := func(i int) int {
		k := 0
		for p := parents[i]; p >= 0 && k < 1024; p = parents[p] {
			k++
		}
		return k
	}
	var boneNodes []int
	for i := range d.Nodes {
		if isBone[i] && visible[i] {
			boneNodes = append(boneNodes, i)
		}
	}
	sort.SliceStable(boneNodes, func(a, b int) bool { return depth(boneNodes[a]) < depth(boneNodes[b]) })
	if len(boneNodes)+1 > 128 {
		return nil, fmt.Errorf("modelul are %d oase; GoldSrc acceptă cel mult 128", len(boneNodes)+1)
	}
	nodeBone := map[int]int{}
	sc := &Scene{Bones: []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}}}
	usedNames := map[string]bool{"root": true}
	for _, n := range boneNodes {
		parent := 0
		for p := parents[n]; p >= 0; p = parents[p] {
			if b, ok := nodeBone[p]; ok {
				parent = b
				break
			}
		}
		// The rest pose is what glTF viewers show: the joints' node transforms (the bind pose only enters the skinned
		// vertices below, through the inverse bind matrices).
		world := rest[n]
		name := uniqueName(cleanName(d.Nodes[n].Name, fmt.Sprintf("bone%d", len(sc.Bones))), 31, usedNames)
		nodeBone[n] = len(sc.Bones)
		sc.Bones = append(sc.Bones, SBone{Name: name, Parent: parent, Rest: toGSBone(world, o.Scale)})
	}
	nearestBone := func(n int) int {
		for p := n; p >= 0; p = parents[p] {
			if b, ok := nodeBone[p]; ok {
				return b
			}
		}
		return 0
	}

	// Materials.
	matIndex := map[int]int{}
	material := func(mi *int) (int, int) {
		key := -1
		if mi != nil {
			key = *mi
		}
		if v, ok := matIndex[key]; ok {
			return v, texCoordOf(d, key)
		}
		m := Material{Name: "default", Factor: [4]float64{0.75, 0.75, 0.75, 1}, Cutoff: 0.5}
		if key >= 0 && key < len(d.Materials) {
			gm := d.Materials[key]
			m.Name = gm.Name
			if m.Name == "" {
				m.Name = fmt.Sprintf("material%d", key)
			}
			m.Factor = [4]float64{1, 1, 1, 1}
			if len(gm.PBR.BaseColorFactor) == 4 {
				copy(m.Factor[:], gm.PBR.BaseColorFactor)
			}
			ti := gm.PBR.BaseColorTexture
			if sg := gm.Extensions.SpecGloss; sg != nil {
				if len(sg.DiffuseFactor) == 4 {
					copy(m.Factor[:], sg.DiffuseFactor)
				}
				if sg.DiffuseTexture != nil {
					ti = sg.DiffuseTexture
				}
			}
			if ti == nil && gm.EmissiveTexture != nil {
				ti = gm.EmissiveTexture // unlit exports sometimes keep the color only there
			}
			if ti != nil {
				img, err := d.TextureImage(ti.Index)
				if err != nil {
					return -1, 0
				}
				m.Image = img
			}
			m.Mask = gm.AlphaMode == "MASK" || gm.AlphaMode == "BLEND"
			if gm.AlphaCutoff != nil {
				m.Cutoff = *gm.AlphaCutoff
			}
		}
		matIndex[key] = len(sc.Materials)
		sc.Materials = append(sc.Materials, m)
		return matIndex[key], texCoordOf(d, key)
	}

	// Triangles. skinMats marks bones whose skinning transform mirrors (negative scale).
	skinMats := map[int]bool{}
	for ni, node := range d.Nodes {
		if !visible[ni] || node.Mesh == nil || *node.Mesh < 0 || *node.Mesh >= len(d.Meshes) {
			continue
		}
		mesh := d.Meshes[*node.Mesh]
		skinned := node.Skin != nil && usedSkins[*node.Skin]
		world := rest[ni]
		normalM := world.NormalMatrix()
		mirrored := !skinned && world.Det3() < 0
		for _, prim := range mesh.Primitives {
			primStart := len(sc.Tris)
			mode := 4
			if prim.Mode != nil {
				mode = *prim.Mode
			}
			if mode != 4 && mode != 5 && mode != 6 {
				continue // points and lines have no place in a studio model
			}
			posAcc, ok := prim.Attributes["POSITION"]
			if !ok {
				continue
			}
			pos, err := d.Floats(posAcc)
			if err != nil {
				return nil, err
			}
			var norms [][]float64
			if a, ok := prim.Attributes["NORMAL"]; ok {
				if norms, err = d.Floats(a); err != nil {
					return nil, err
				}
			}
			mat, texCoord := material(prim.Material)
			if mat < 0 {
				return nil, fmt.Errorf("nu pot citi textura materialului din %q", mesh.Name)
			}
			var uvs [][]float64
			if a, ok := prim.Attributes[fmt.Sprintf("TEXCOORD_%d", texCoord)]; ok {
				if uvs, err = d.Floats(a); err != nil {
					return nil, err
				}
			}
			var joints [][]int
			var weights [][]float64
			if skinned {
				if a, ok := prim.Attributes["JOINTS_0"]; ok {
					if joints, err = d.Ints(a); err != nil {
						return nil, err
					}
				}
				if a, ok := prim.Attributes["WEIGHTS_0"]; ok {
					if weights, err = d.Floats(a); err != nil {
						return nil, err
					}
				}
			}
			var idx []int
			if prim.Indices != nil {
				ii, err := d.Ints(*prim.Indices)
				if err != nil {
					return nil, err
				}
				for _, v := range ii {
					idx = append(idx, v[0])
				}
			} else {
				for i := range pos {
					idx = append(idx, i)
				}
			}
			var triIdx [][3]int
			switch mode {
			case 4:
				for i := 0; i+2 < len(idx); i += 3 {
					triIdx = append(triIdx, [3]int{idx[i], idx[i+1], idx[i+2]})
				}
			case 5:
				for i := 0; i+2 < len(idx); i++ {
					if i%2 == 0 {
						triIdx = append(triIdx, [3]int{idx[i], idx[i+1], idx[i+2]})
					} else {
						triIdx = append(triIdx, [3]int{idx[i+1], idx[i], idx[i+2]})
					}
				}
			case 6:
				for i := 1; i+1 < len(idx); i++ {
					triIdx = append(triIdx, [3]int{idx[0], idx[i], idx[i+1]})
				}
			}
			var skin *gltf.Skin
			if skinned {
				skin = &d.Skins[*node.Skin]
			}
			corner := func(vi int) (Corner, bool) {
				if vi < 0 || vi >= len(pos) {
					return Corner{}, false
				}
				p := vmath.Vec3{pos[vi][0], pos[vi][1], pos[vi][2]}
				var n vmath.Vec3
				if vi < len(norms) {
					n = vmath.Vec3{norms[vi][0], norms[vi][1], norms[vi][2]}
				}
				c := Corner{}
				if vi < len(uvs) {
					c.UV = [2]float64{uvs[vi][0], uvs[vi][1]}
				}
				if skinned {
					// Rigid skinning: the joint with the largest weight.
					c.Bone = 0
					jointNode := -1
					if vi < len(joints) {
						best := -1.0
						var ws []Weight
						for k, j := range joints[vi] {
							w := 1.0
							if vi < len(weights) && k < len(weights[vi]) {
								w = weights[vi][k]
							}
							if j >= 0 && j < len(skin.Joints) {
								if b, ok := nodeBone[skin.Joints[j]]; ok {
									if w > 0 {
										ws = append(ws, Weight{Bone: b, W: w})
									}
									if w > best {
										best, c.Bone, jointNode = w, b, skin.Joints[j]
									}
								}
							}
						}
						sort.Slice(ws, func(a, b int) bool { return ws[a].W > ws[b].W })
						var total float64
						for k := 0; k < len(ws) && k < 4; k++ {
							total += ws[k].W
						}
						for k := 0; k < len(ws) && k < 4 && total > 0; k++ {
							c.W[k] = Weight{Bone: ws[k].Bone, W: ws[k].W / total}
						}
					}
					skinM := vmath.Mat4Identity()
					if jointNode >= 0 {
						skinM = rest[jointNode]
						if ibm, ok := jointIBM[jointNode]; ok {
							skinM = skinM.Mul(ibm)
						}
					}
					if skinM.Det3() < 0 {
						skinMats[c.Bone] = true
					}
					c.Pos = toGSPoint(skinM.Apply(p), o.Scale)
					c.Normal = toGSDir(skinM.NormalMatrix().MulVec(n))
				} else {
					c.Bone = nearestBone(ni)
					c.Pos = toGSPoint(world.Apply(p), o.Scale)
					c.Normal = toGSDir(normalM.MulVec(n))
				}
				return c, true
			}
			for _, t := range triIdx {
				var tri Tri
				ok := true
				for k := 0; k < 3 && ok; k++ {
					tri.C[k], ok = corner(t[k])
				}
				if !ok {
					continue
				}
				if mirrored {
					tri.C[1], tri.C[2] = tri.C[2], tri.C[1]
				}
				tri.Mat = mat
				tri.Part = node.Name + " " + mesh.Name
				if len(norms) == 0 {
					fn := tri.C[1].Pos.Sub(tri.C[0].Pos).Cross(tri.C[2].Pos.Sub(tri.C[0].Pos)).Norm()
					for k := range tri.C {
						tri.C[k].Normal = fn
					}
				}
				if degenerate(tri) {
					continue
				}
				if skinned && skinDet(skinMats, tri) < 0 {
					tri.C[1], tri.C[2] = tri.C[2], tri.C[1] // mirrored joint transform
				}
				sc.Tris = append(sc.Tris, tri)
			}
			doubleSided := prim.Material != nil && *prim.Material >= 0 && *prim.Material < len(d.Materials) && d.Materials[*prim.Material].DoubleSided
			sc.Tris = append(sc.Tris[:primStart], orientFaces(sc.Tris[primStart:], doubleSided || o.DoubleSided)...)
		}
	}
	if len(sc.Tris) == 0 {
		return nil, fmt.Errorf("modelul nu are niciun triunghi vizibil")
	}

	// Animations: sampled world transforms of every bone.
	for _, c := range clips {
		frames := int(math.Ceil(c.Duration*o.FPS)) + 1
		if frames < 1 {
			frames = 1
		}
		fps := o.FPS
		if o.MaxFPS > 0 && frames > o.MaxFPS*4 {
			// Long clips: fewer frames per second keeps the animation data inside the format limits.
			frames = o.MaxFPS*4 + 1
			fps = float64(frames-1) / math.Max(c.Duration, 1e-6)
		}
		cc := c
		clip := Clip{Name: c.Name, FPS: fps}
		for f := 0; f < frames; f++ {
			t := math.Min(float64(f)/fps, c.Duration)
			worlds := d.WorldMatrices(&cc, t)
			fr := make([]vmath.Bone, len(sc.Bones))
			fr[0] = vmath.BoneIdentity()
			for _, n := range boneNodes {
				fr[nodeBone[n]] = toGSBone(worlds[n], o.Scale)
			}
			clip.Frames = append(clip.Frames, fr)
		}
		sc.Clips = append(sc.Clips, clip)
	}
	return sc, nil
}

func texCoordOf(d *gltf.Doc, mat int) int {
	if mat < 0 || mat >= len(d.Materials) {
		return 0
	}
	if t := d.Materials[mat].PBR.BaseColorTexture; t != nil {
		return t.TexCoord
	}
	return 0
}

func degenerate(t Tri) bool {
	a := t.C[1].Pos.Sub(t.C[0].Pos)
	b := t.C[2].Pos.Sub(t.C[0].Pos)
	return a.Cross(b).Len() < 1e-10
}

// cleanName keeps names engine-safe: ASCII letters, digits, '_', '-', '.', ' '.
func cleanName(s, fallback string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '.', r == ' ':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "" || strings.Trim(out, "_") == "" {
		return fallback
	}
	return out
}

func uniqueName(name string, max int, used map[string]bool) string {
	if len(name) > max {
		name = name[:max]
	}
	base := name
	for i := 2; used[strings.ToLower(name)]; i++ {
		suffix := fmt.Sprintf("_%d", i)
		cut := base
		if len(cut)+len(suffix) > max {
			cut = cut[:max-len(suffix)]
		}
		name = cut + suffix
	}
	used[strings.ToLower(name)] = true
	return name
}

// Transform applies a rigid transform plus uniform scale to the whole scene (vertices, bones and every frame).
func (s *Scene) Transform(r vmath.Mat3, scale float64, offset vmath.Vec3) {
	tf := func(p vmath.Vec3) vmath.Vec3 { return r.MulVec(p).Scale(scale).Add(offset) }
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			s.Tris[i].C[k].Pos = tf(s.Tris[i].C[k].Pos)
			s.Tris[i].C[k].Normal = r.MulVec(s.Tris[i].C[k].Normal)
		}
	}
	fixBone := func(b *vmath.Bone, root bool) {
		if root {
			return
		}
		b.R = r.Mul(b.R)
		b.T = tf(b.T)
	}
	for i := range s.Bones {
		fixBone(&s.Bones[i].Rest, i == 0)
	}
	for c := range s.Clips {
		for f := range s.Clips[c].Frames {
			for b := range s.Clips[c].Frames[f] {
				fixBone(&s.Clips[c].Frames[f][b], b == 0)
			}
		}
	}
}

// Bounds of the reference pose geometry.
func (s *Scene) Bounds() (vmath.Vec3, vmath.Vec3) {
	mn := vmath.Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx := vmath.Vec3{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for _, t := range s.Tris {
		for _, c := range t.C {
			mn, mx = mn.Min(c.Pos), mx.Max(c.Pos)
		}
	}
	return mn, mx
}

// skinDet is negative when the triangle's first corner was skinned through a mirroring transform.
func skinDet(mirror map[int]bool, t Tri) float64 {
	if mirror[t.C[0].Bone] {
		return -1
	}
	return 1
}

// orientFaces fixes a primitive's faces for an engine that draws only front faces (GoldSrc), while glTF viewers
// often draw both sides and hide mistakes:
//   - a piece whose faces point inward overall (clothes, armor exported inside out) is flipped;
//   - normals pointing inward are turned around (lighting);
//   - open surfaces of double-sided materials (capes, wings, leaves, hair cards) get a back face.
func orientFaces(tris []Tri, doubleSided bool) []Tri {
	if len(tris) == 0 {
		return tris
	}
	var center vmath.Vec3
	var total float64
	for _, t := range tris {
		a := t.C[1].Pos.Sub(t.C[0].Pos).Cross(t.C[2].Pos.Sub(t.C[0].Pos)).Len() / 2
		center = center.Add(t.C[0].Pos.Add(t.C[1].Pos).Add(t.C[2].Pos).Scale(a / 3))
		total += a
	}
	if total <= 0 {
		return tris
	}
	center = center.Scale(1 / total)
	// Outwardness: do faces (winding) and normals point away from the piece's center?
	var wind, wabs, norm, nabs float64
	for _, t := range tris {
		fn := t.C[1].Pos.Sub(t.C[0].Pos).Cross(t.C[2].Pos.Sub(t.C[0].Pos))
		area := fn.Len() / 2
		if area <= 0 {
			continue
		}
		fn = fn.Norm()
		dir := t.C[0].Pos.Add(t.C[1].Pos).Add(t.C[2].Pos).Scale(1.0 / 3).Sub(center).Norm()
		d := fn.Dot(dir) * area
		wind += d
		wabs += math.Abs(d)
		vn := t.C[0].Normal.Add(t.C[1].Normal).Add(t.C[2].Normal).Norm()
		dn := vn.Dot(dir) * area
		norm += dn
		nabs += math.Abs(dn)
	}
	inward := wabs > 0 && wind/wabs < -0.15
	if !isOpen(tris) {
		// Closed shape: the signed volume is the reliable test.
		var vol, vabs float64
		for _, t := range tris {
			a, b, c := t.C[0].Pos.Sub(center), t.C[1].Pos.Sub(center), t.C[2].Pos.Sub(center)
			v := a.Dot(b.Cross(c))
			vol += v
			vabs += math.Abs(v)
		}
		inward = vabs > 0 && vol/vabs < -0.1
	}
	if inward {
		for i := range tris {
			tris[i].C[1], tris[i].C[2] = tris[i].C[2], tris[i].C[1]
		}
	}
	if nabs > 0 && norm/nabs < -0.15 {
		for i := range tris {
			for k := range tris[i].C {
				tris[i].C[k].Normal = tris[i].C[k].Normal.Scale(-1)
			}
		}
	}
	// Normals that disagree with the (fixed) winding get the face's side, so lighting matches what is drawn.
	for i := range tris {
		t := &tris[i]
		fn := t.C[1].Pos.Sub(t.C[0].Pos).Cross(t.C[2].Pos.Sub(t.C[0].Pos))
		for k := range t.C {
			if t.C[k].Normal.Dot(fn) < 0 && math.Abs(t.C[k].Normal.Dot(fn.Norm())) > 0.5 {
				t.C[k].Normal = t.C[k].Normal.Scale(-1)
			}
		}
	}
	if doubleSided && isOpen(tris) {
		for i := range tris {
			tris[i].Double = true
		}
	}
	return tris
}

// withBackFaces adds the back side of every Double triangle.
func withBackFaces(tris []Tri) []Tri {
	out := tris
	for _, t := range tris {
		if !t.Double {
			continue
		}
		b := t
		b.Double = false
		b.C[1], b.C[2] = t.C[2], t.C[1]
		b.ST[1], b.ST[2] = t.ST[2], t.ST[1]
		for k := range b.C {
			b.C[k].Normal = b.C[k].Normal.Scale(-1)
		}
		out = append(out, b)
	}
	return out
}

// isOpen reports whether a surface has a real border (more than 3% of its edges used by one triangle only): a thin
// sheet rather than a closed shape, so its back side can be seen.
func isOpen(tris []Tri) bool {
	type ek struct{ a, b [3]float32 }
	key := func(p vmath.Vec3) [3]float32 { return [3]float32{float32(p[0]), float32(p[1]), float32(p[2])} }
	edges := map[ek]int{}
	for _, t := range tris {
		for k := 0; k < 3; k++ {
			a, b := key(t.C[k].Pos), key(t.C[(k+1)%3].Pos)
			if b[0] < a[0] || b[0] == a[0] && (b[1] < a[1] || b[1] == a[1] && b[2] < a[2]) {
				a, b = b, a
			}
			edges[ek{a, b}]++
		}
	}
	border := 0
	for _, n := range edges {
		if n == 1 {
			border++
		}
	}
	return len(edges) > 0 && float64(border)/float64(len(edges)) > 0.03
}

// Clone copies the geometry and skeleton (materials and images are shared; animations are left out).
func (s *Scene) Clone() *Scene {
	c := &Scene{Materials: s.Materials}
	c.Bones = append([]SBone(nil), s.Bones...)
	c.Tris = append([]Tri(nil), s.Tris...)
	return c
}
