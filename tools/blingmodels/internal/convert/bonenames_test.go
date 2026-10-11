package convert

import (
	"fmt"
	"math"
	"os"
	"strings"
	"testing"

	"blingmodels/internal/gltf"
	"blingmodels/internal/mdl"
	"blingmodels/internal/vmath"
)

func loadSample(t *testing.T, p string, anims bool) *Scene {
	d, err := gltf.Load(p)
	if err != nil {
		t.Fatal(err)
	}
	s, err := LoadScene(d, LoadOptions{Anims: anims})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func bipName(k boneKey) string {
	side := ""
	if k.side != "" {
		side = k.side + " "
	}
	switch k.part {
	case "pelvis":
		return "Bip01 Pelvis"
	case "spine":
		if k.seg == 0 {
			return "Bip01 Spine"
		}
		return fmt.Sprintf("Bip01 Spine%d", k.seg)
	case "neck":
		return "Bip01 Neck"
	case "head":
		return "Bip01 Head"
	case "upperarm":
		return "Bip01 " + side + "UpperArm"
	case "forearm":
		return "Bip01 " + side + "Forearm"
	case "finger":
		return "Bip01 " + side + "Finger0"
	}
	return "Bip01 " + side + strings.Title(k.part)
}

// TestRetargetSamples: BLINGMODELS_SAMPLES=dir with CesiumMan.glb and RiggedFigure.glb. CesiumMan becomes a CS-like
// donor (Bip01 names, walk animation); RiggedFigure is retargeted onto it.
func TestRetargetSamples(t *testing.T) {
	dir := os.Getenv("BLINGMODELS_SAMPLES")
	if dir == "" {
		t.Skip("set BLINGMODELS_SAMPLES")
	}
	ds := loadSample(t, dir+"/CesiumMan.glb", true)
	keys := ds.geoClassify()
	if keys == nil {
		t.Fatal("CesiumMan skeleton not recognized")
	}
	used := map[string]bool{}
	for i := range ds.Bones {
		if k, ok := keys[i]; ok {
			ds.Bones[i].Name = uniqueName(bipName(k), 31, used)
		}
		t.Logf("%-28s %+v", ds.Bones[i].Name, keys[i])
	}
	// CS 1.6 players carry helper bones next to the real ones ("-- L Elbow" beside the forearm, "-- L Knee"…),
	// turned differently: they must not be mistaken for the limbs.
	addHelper := func(name string, nearBone string) {
		var b, parent int = -1, -1
		for i := range ds.Bones {
			if ds.Bones[i].Name == nearBone {
				b, parent = i, ds.Bones[i].Parent
			}
		}
		if b < 0 {
			t.Fatalf("no bone %s", nearBone)
		}
		rest := ds.Bones[b].Rest
		rest.R = rest.R.Mul(vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{1.1, -0.7, 0.4})))
		ds.Bones = append(ds.Bones, SBone{Name: name, Parent: parent, Rest: rest})
		h := len(ds.Bones) - 1
		local := ds.Bones[parent].Rest.Inverse().Mul(rest)
		for c := range ds.Clips {
			for f := range ds.Clips[c].Frames {
				ds.Clips[c].Frames[f] = append(ds.Clips[c].Frames[f], ds.Clips[c].Frames[f][parent].Mul(local))
			}
		}
		_ = h
	}
	addHelper("-- L Elbow", "Bip01 L Forearm")
	addHelper("-- R Elbow", "Bip01 R Forearm")
	addHelper("-- L Knee", "Bip01 L Calf")
	addHelper("-- R Knee", "Bip01 R Calf")
	addHelper("-- L wrist", "Bip01 L Hand")
	donor, err := BuildProp(ds, BuildOptions{Name: "donor.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := donor.Encode()
	donor, _ = mdl.Decode(data, nil)
	os.WriteFile(dir+"/../donor_cs.mdl", data, 0o644)

	src := loadSample(t, dir+"/RiggedFigure.glb", false)
	for i, k := range src.geoClassify() {
		t.Logf("src %-24s %+v", src.Bones[i].Name, k)
	}
	out, notes, err := BuildWithDonor(src, donor, DonorOptions{Mode: DonorPlayer, Name: "fig.mdl"})
	if err != nil {
		t.Fatal(err)
	}
	t.Log(notes)
	data, _ = out.Encode()
	os.WriteFile(dir+"/../retarget_fig.mdl", data, 0o644)
}

// TestPosedRestStaysWhole: a skinned body whose rest pose differs from its bind pose (bent joints, as in models
// taken from games) must not tear: triangles keep about their size.
func TestPosedRestStaysWhole(t *testing.T) {
	dir := os.Getenv("BLINGMODELS_SAMPLES")
	if dir == "" {
		t.Skip("set BLINGMODELS_SAMPLES")
	}
	d, err := gltf.Load(dir + "/CesiumMan.glb")
	if err != nil {
		t.Fatal(err)
	}
	bind, _ := LoadScene(d, LoadOptions{})
	// Bend every joint by 35° about its local X.
	for i := range d.Nodes {
		n := &d.Nodes[i]
		if len(n.Matrix) == 0 && n.Mesh == nil && i != 0 {
			q := vmath.Quat{0.3007, 0, 0, 0.9537}
			if len(n.Rotation) == 4 {
				q = vmath.Quat{n.Rotation[0], n.Rotation[1], n.Rotation[2], n.Rotation[3]}.Mul(q)
			}
			n.Rotation = []float64{q[0], q[1], q[2], q[3]}
		}
	}
	posed, err := LoadScene(d, LoadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(bind.Tris) != len(posed.Tris) {
		t.Fatal("triangle count changed")
	}
	longest := func(tr Tri) float64 {
		return math.Max(tr.C[0].Pos.Sub(tr.C[1].Pos).Len(), math.Max(tr.C[1].Pos.Sub(tr.C[2].Pos).Len(), tr.C[2].Pos.Sub(tr.C[0].Pos).Len()))
	}
	bad := 0
	for i := range bind.Tris {
		if longest(posed.Tris[i]) > 2*longest(bind.Tris[i])+0.3 {
			bad++
		}
	}
	t.Logf("%d of %d triangles stretched", bad, len(bind.Tris))
	if float64(bad) > 0.01*float64(len(bind.Tris)) {
		t.Fatalf("posed rest tears the mesh: %d stretched triangles", bad)
	}
}
