package convert

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"blingmodels/internal/gltf"
	"blingmodels/internal/mdl"
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
