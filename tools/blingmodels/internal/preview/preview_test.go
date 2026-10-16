package preview

import (
	"fmt"
	"image/png"
	"os"
	"testing"

	"blingmodels/internal/mdl"
)

// TestPoseFrames renders frames of a model given in BLINGMODELS_POSE (manual check of animations).
func TestPoseFrames(t *testing.T) {
	path := os.Getenv("BLINGMODELS_POSE")
	if path == "" {
		t.Skip("set BLINGMODELS_POSE=model.mdl")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	m, err := mdl.Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	n := int(m.Sequences[0].NumFrames)
	for _, f := range []int{0, n / 3, 2 * n / 3} {
		out, _ := os.Create(fmt.Sprintf("%s_f%03d.png", path, f))
		png.Encode(out, ImageAt(m, 0, f))
		out.Close()
	}
}
