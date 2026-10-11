package convert

import (
	"image"
	"image/color"
	"math"
	"math/rand"
	"testing"

	"blingmodels/internal/mdl"
	"blingmodels/internal/vmath"
)

// box returns the 12 triangles of an axis-aligned box, counter-clockwise seen from outside.
func box(mn, mx vmath.Vec3, bone, mat int) []Tri {
	p := func(i int) vmath.Vec3 {
		v := mn
		if i&1 != 0 {
			v[0] = mx[0]
		}
		if i&2 != 0 {
			v[1] = mx[1]
		}
		if i&4 != 0 {
			v[2] = mx[2]
		}
		return v
	}
	quads := [][4]int{{0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5}}
	uv := [4][2]float64{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	var out []Tri
	for _, q := range quads {
		a, b, c := p(q[0]), p(q[1]), p(q[2])
		n := b.Sub(a).Cross(c.Sub(a)).Norm()
		for _, tri := range [][3]int{{0, 1, 2}, {0, 2, 3}} {
			var t Tri
			t.Mat = mat
			for k, qi := range tri {
				t.C[k] = Corner{Pos: p(q[qi]), Normal: n, UV: uv[qi], Bone: bone}
			}
			out = append(out, t)
		}
	}
	return out
}

func checker(c color.NRGBA) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			if (x/8+y/8)%2 == 0 {
				img.SetNRGBA(x, y, c)
			} else {
				img.SetNRGBA(x, y, color.NRGBA{20, 20, 20, 255})
			}
		}
	}
	return img
}

// enginePose computes bone world transforms the way the engine does: value + raw * scale, angles to a quaternion,
// parent chain.
func enginePose(m *mdl.Model, seq, frame int) []vmath.Bone {
	world := make([]vmath.Bone, len(m.Bones))
	for i, b := range m.Bones {
		var v [6]float64
		for ch := 0; ch < 6; ch++ {
			v[ch] = float64(b.Value[ch])
			if vals := m.Sequences[seq].Anims[0][i][ch]; vals != nil {
				v[ch] += float64(vals[frame]) * float64(b.Scale[ch])
			}
		}
		local := vmath.BoneFromPosAngles(vmath.Vec3{v[0], v[1], v[2]}, vmath.Vec3{v[3], v[4], v[5]})
		if b.Parent >= 0 {
			world[i] = world[b.Parent].Mul(local)
		} else {
			world[i] = local
		}
	}
	return world
}

func randomRot(r *rand.Rand) vmath.Mat3 {
	q := vmath.Quat{r.NormFloat64(), r.NormFloat64(), r.NormFloat64(), r.NormFloat64()}.Normalize()
	return vmath.QuatMat3(q)
}

// TestAnimationSurvivesEncoding: bone transforms played back from the written file match the sampled clip.
func TestAnimationSurvivesEncoding(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	s := &Scene{
		Bones: []SBone{
			{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()},
			{Name: "hips", Parent: 0, Rest: vmath.Bone{R: randomRot(r), T: vmath.Vec3{0, 0, 40}}},
			{Name: "arm", Parent: 1, Rest: vmath.Bone{R: randomRot(r), T: vmath.Vec3{10, 5, 55}}},
		},
		Materials: []Material{{Name: "skin", Image: checker(color.NRGBA{200, 50, 50, 255}), Factor: [4]float64{1, 1, 1, 1}}},
	}
	s.Tris = append(box(vmath.Vec3{-5, -5, 35}, vmath.Vec3{5, 5, 45}, 1, 0), box(vmath.Vec3{8, 3, 50}, vmath.Vec3{12, 7, 60}, 2, 0)...)
	clip := Clip{Name: "wave", FPS: 30}
	for f := 0; f < 20; f++ {
		fr := []vmath.Bone{vmath.BoneIdentity()}
		hips := vmath.Bone{R: s.Bones[1].Rest.R.Mul(vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{0, 0, float64(f) * 0.3}))), T: vmath.Vec3{float64(f), 0, 40}}
		armLocal := s.Bones[1].Rest.Inverse().Mul(s.Bones[2].Rest)
		armLocal.R = armLocal.R.Mul(vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{float64(f) * 0.2, -float64(f) * 0.1, 0})))
		fr = append(fr, hips, hips.Mul(armLocal))
		clip.Frames = append(clip.Frames, fr)
	}
	s.Clips = []Clip{clip}

	m, err := BuildProp(s, BuildOptions{Name: "anim.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	data, err := m.Encode()
	if err != nil {
		t.Fatal(err)
	}
	back, err := mdl.Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	for f, want := range clip.Frames {
		got := enginePose(back, 0, f)
		for b := range want {
			if d := got[b].T.Sub(want[b].T).Len(); d > 0.01 {
				t.Fatalf("frame %d bone %d: position off by %.4f", f, b, d)
			}
			for i := 0; i < 3; i++ {
				for j := 0; j < 3; j++ {
					if math.Abs(got[b].R[i][j]-want[b].R[i][j]) > 1e-3 {
						t.Fatalf("frame %d bone %d: rotation differs\n got %v\nwant %v", f, b, got[b].R, want[b].R)
					}
				}
			}
		}
	}
}

// TestGeometryRoundTrip: every triangle comes back from the file at the same place, with the same winding (after the
// clockwise conversion) and texture coordinates.
func TestGeometryRoundTrip(t *testing.T) {
	s := &Scene{
		Bones:     []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}},
		Materials: []Material{{Name: "crate", Image: checker(color.NRGBA{40, 160, 220, 255}), Factor: [4]float64{1, 1, 1, 1}}},
		Tris:      box(vmath.Vec3{-8, -8, 0}, vmath.Vec3{8, 8, 16}, 0, 0),
	}
	m, err := BuildProp(s, BuildOptions{Name: "crate.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	data, err := m.Encode()
	if err != nil {
		t.Fatal(err)
	}
	back, err := mdl.Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := DonorTris(back, DonorBoneWorld(back))
	if len(got) != len(s.Tris) {
		t.Fatalf("got %d triangles, want %d", len(got), len(s.Tris))
	}
	key := func(tr Tri) [3]vmath.Vec3 { return [3]vmath.Vec3{tr.C[0].Pos, tr.C[1].Pos, tr.C[2].Pos} }
	want := map[[3]vmath.Vec3]bool{}
	for _, tr := range s.Tris {
		// any rotation of the same corner order is the same triangle
		for r := 0; r < 3; r++ {
			want[[3]vmath.Vec3{tr.C[r].Pos, tr.C[(r+1)%3].Pos, tr.C[(r+2)%3].Pos}] = true
		}
	}
	tw := float64(back.Textures[0].Width)
	for _, tr := range got {
		if !want[key(tr)] {
			t.Fatalf("triangle %v is not in the source (wrong winding or position)", key(tr))
		}
		for _, c := range tr.C {
			if c.UV[0] < 0 || c.UV[0] > 1 || c.UV[1] < 0 || c.UV[1] > 1 {
				t.Fatalf("texture coordinate out of range: %v (width %v)", c.UV, tw)
			}
		}
		// Outward normals: the face normal from the corners agrees with the stored normal.
		fn := tr.C[1].Pos.Sub(tr.C[0].Pos).Cross(tr.C[2].Pos.Sub(tr.C[0].Pos))
		if fn.Dot(tr.C[0].Normal) <= 0 {
			t.Fatalf("triangle faces inward")
		}
	}
}

// donorView builds a small v_-like model: arm bones with a "hand" texture, a weapon bone with a gun texture, and two
// sequences.
func donorView(t *testing.T) *mdl.Model {
	s := &Scene{
		Bones: []SBone{
			{Name: "Bip01", Parent: -1, Rest: vmath.BoneIdentity()},
			{Name: "Bip01 R Hand", Parent: 0, Rest: vmath.Bone{R: vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{0.2, 0.1, 0.3})), T: vmath.Vec3{5, -6, -4}}},
			{Name: "ak47", Parent: 0, Rest: vmath.Bone{R: vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{0, 0.05, 0})), T: vmath.Vec3{12, -3, -6}}},
		},
		Materials: []Material{
			{Name: "view_glove", Image: checker(color.NRGBA{90, 70, 50, 255}), Factor: [4]float64{1, 1, 1, 1}},
			{Name: "ak47_body", Image: checker(color.NRGBA{60, 60, 60, 255}), Factor: [4]float64{1, 1, 1, 1}},
		},
	}
	s.Tris = append(box(vmath.Vec3{2, -9, -6}, vmath.Vec3{8, -3, -2}, 1, 0), box(vmath.Vec3{0, -4, -8}, vmath.Vec3{30, -2, -4}, 2, 1)...)
	clipA := Clip{Name: "idle", FPS: 30, Frames: [][]vmath.Bone{{s.Bones[0].Rest, s.Bones[1].Rest, s.Bones[2].Rest}}}
	moved := s.Bones[2].Rest
	moved.T = moved.T.Add(vmath.Vec3{-2, 0, 0.5})
	clipB := Clip{Name: "shoot", FPS: 30, Frames: [][]vmath.Bone{{s.Bones[0].Rest, s.Bones[1].Rest, s.Bones[2].Rest}, {s.Bones[0].Rest, s.Bones[1].Rest, moved}}}
	s.Clips = []Clip{clipA, clipB}
	m, err := BuildProp(s, BuildOptions{Name: "v_ak47.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	m.Attachments = []mdl.Attachment{{Name: "muzzle", Bone: 2, Org: mdl.Vec{30, 0, 0}}}
	data, err := m.Encode()
	if err != nil {
		t.Fatal(err)
	}
	back, err := mdl.Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	return back
}

func TestDonorViewKeepsHandsAndAnimations(t *testing.T) {
	donor := donorView(t)
	// The new gun: a long box along Y (wrong orientation), twice as large.
	gun := &Scene{
		Bones:     []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}},
		Materials: []Material{{Name: "new_gun", Image: checker(color.NRGBA{200, 180, 40, 255}), Factor: [4]float64{1, 1, 1, 1}}},
	}
	gun.Tris = append(box(vmath.Vec3{-2, -30, 0}, vmath.Vec3{2, 30, 4}, 0, 0), box(vmath.Vec3{-1, -5, -10}, vmath.Vec3{1, 0, 0}, 0, 0)...)
	out, notes, err := BuildWithDonor(gun, donor, DonorOptions{Mode: DonorView, Name: "v_ak47.mdl", AutoRotate: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Log(notes)
	data, err := out.Encode()
	if err != nil {
		t.Fatal(err)
	}
	back, err := mdl.Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Sequences) != 2 || back.Sequences[1].Label != "shoot" || len(back.Attachments) != 1 {
		t.Fatalf("donor sequences/attachments not kept: %d seqs, %d attachments", len(back.Sequences), len(back.Attachments))
	}
	if len(back.Textures) != 2 || back.Textures[0].Name != "new_gun.bmp" || back.Textures[1].Name != "view_glove.bmp" {
		var names []string
		for _, tx := range back.Textures {
			names = append(names, tx.Name)
		}
		t.Fatalf("textures = %v", names)
	}
	tris := DonorTris(back, DonorBoneWorld(back))
	hands, newGun := 0, 0
	var mn, mx vmath.Vec3
	mn = vmath.Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx = mn.Scale(-1)
	for _, tr := range tris {
		switch tr.Mat {
		case 1:
			hands++
			if tr.C[0].Bone != 1 {
				t.Fatalf("hand triangle moved to bone %d", tr.C[0].Bone)
			}
		case 0:
			newGun++
			for _, c := range tr.C {
				if c.Bone != 2 {
					t.Fatalf("new gun bound to bone %d, want the weapon bone", c.Bone)
				}
				mn, mx = mn.Min(c.Pos), mx.Max(c.Pos)
			}
		}
	}
	if hands != 12 || newGun != 24 {
		t.Fatalf("hands=%d gun=%d", hands, newGun)
	}
	// The new gun now lies along X like the old one and has its length (30 units).
	if l := mx[0] - mn[0]; math.Abs(l-30) > 1 {
		t.Fatalf("new gun length along X = %.2f, want 30 (bounds %v %v)", l, mn, mx)
	}
}

func TestDonorPlayerBindsToNearestBone(t *testing.T) {
	// Donor: legs bone low, head bone high.
	ds := &Scene{
		Bones: []SBone{
			{Name: "Bip01", Parent: -1, Rest: vmath.BoneIdentity()},
			{Name: "Bip01 Pelvis", Parent: 0, Rest: vmath.Bone{R: vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{0, 0, 0})), T: vmath.Vec3{0, 0, -10}}},
			{Name: "Bip01 Head", Parent: 1, Rest: vmath.Bone{R: vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{0.3, 0, 0})), T: vmath.Vec3{0, 0, 26}}},
		},
		Materials: []Material{{Name: "body", Factor: [4]float64{0.5, 0.5, 0.5, 1}}},
	}
	ds.Tris = append(box(vmath.Vec3{-6, -6, -36}, vmath.Vec3{6, 6, 10}, 1, 0), box(vmath.Vec3{-5, -5, 22}, vmath.Vec3{5, 5, 36}, 2, 0)...)
	dm, err := BuildProp(ds, BuildOptions{Name: "gign.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	// New body: 1.8 m tall, in meters-scale units, feet at 0.
	body := &Scene{
		Bones:     []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}},
		Materials: []Material{{Name: "suit", Factor: [4]float64{0.2, 0.2, 0.8, 1}}},
		Tris:      append(box(vmath.Vec3{-0.3, -0.3, 0}, vmath.Vec3{0.3, 0.3, 1.1}, 0, 0), box(vmath.Vec3{-0.2, -0.2, 1.5}, vmath.Vec3{0.2, 0.2, 1.8}, 0, 0)...),
	}
	out, _, err := BuildWithDonor(body, dm, DonorOptions{Mode: DonorPlayer, Name: "gign.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	tris := DonorTris(out, DonorBoneWorld(out))
	for _, tr := range tris {
		for _, c := range tr.C {
			want := 1
			if c.Pos[2] > 20 {
				want = 2
			}
			if c.Bone != want {
				t.Fatalf("vertex at z=%.1f bound to bone %d, want %d", c.Pos[2], c.Bone, want)
			}
		}
	}
	mn, mx := boundsOf(tris)
	if math.Abs(mn[2]+36) > 0.01 || math.Abs(mx[2]-36) > 0.01 {
		t.Fatalf("body not fitted to donor height: z %.2f..%.2f", mn[2], mx[2])
	}
	if len(out.Hitboxes) != len(dm.Hitboxes) || len(out.Sequences) != len(dm.Sequences) {
		t.Fatalf("donor hitboxes/sequences not kept")
	}
}

func TestSimplifyKeepsShape(t *testing.T) {
	// A finely tessellated sheet folds into far fewer triangles but keeps its outline.
	s := &Scene{Bones: []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}}, Materials: []Material{{Name: "m"}}}
	const n = 40
	pt := func(i, j int) vmath.Vec3 { return vmath.Vec3{float64(i), float64(j), 0} }
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			c := func(a, b int) Corner {
				return Corner{Pos: pt(a, b), Normal: vmath.Vec3{0, 0, 1}, UV: [2]float64{float64(a) / n, float64(b) / n}}
			}
			s.Tris = append(s.Tris, Tri{C: [3]Corner{c(i, j), c(i+1, j), c(i+1, j+1)}}, Tri{C: [3]Corner{c(i, j), c(i+1, j+1), c(i, j+1)}})
		}
	}
	s.Simplify(400)
	if len(s.Tris) > 400 {
		t.Fatalf("still %d triangles", len(s.Tris))
	}
	mn, mx := s.Bounds()
	if mn != (vmath.Vec3{0, 0, 0}) || mx != (vmath.Vec3{n, n, 0}) {
		t.Fatalf("outline changed: %v %v", mn, mx)
	}
	var area float64
	for _, tr := range s.Tris {
		area += tr.C[1].Pos.Sub(tr.C[0].Pos).Cross(tr.C[2].Pos.Sub(tr.C[0].Pos))[2] / 2
	}
	if math.Abs(area-n*n) > 1e-6 {
		t.Fatalf("area %.3f, want %d (holes or folds)", area, n*n)
	}
}
