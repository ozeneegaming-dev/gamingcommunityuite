package preview

import (
	"image/png"
	"math"
	"os"
	"strings"
	"testing"

	"blingmodels/internal/convert"
	"blingmodels/internal/mdl"
	"blingmodels/internal/vmath"
)

// TestArmsUp raises both upper arms 70° (like CS's gun-holding poses) and reports how many triangles stretch.
func TestArmsUp(t *testing.T) {
	p := os.Getenv("BLINGMODELS_ARMSUP")
	if p == "" {
		t.Skip()
	}
	data, _ := os.ReadFile(p)
	m, err := mdl.Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	rest := convert.DonorBoneWorld(m)
	// local transforms
	local := make([]vmath.Bone, len(m.Bones))
	for i, b := range m.Bones {
		if b.Parent >= 0 {
			local[i] = rest[b.Parent].Inverse().Mul(rest[i])
		} else {
			local[i] = rest[i]
		}
	}
	posed := make([]vmath.Bone, len(m.Bones))
	for i, b := range m.Bones {
		l := local[i]
		if strings.Contains(b.Name, "UpperArm") {
			// raise: rotate in world about the forward axis (X), sign by side
			ang := 1.2
			if strings.Contains(b.Name, " R ") {
				ang = -ang
			}
			par := rest[b.Parent]
			worldRot := vmath.QuatMat3(vmath.AngleQuaternion(vmath.Vec3{ang, 0, 0}))
			l.R = par.R.Transpose().Mul(worldRot).Mul(par.R).Mul(l.R)
		}
		if b.Parent >= 0 {
			posed[i] = posed[b.Parent].Mul(l)
		} else {
			posed[i] = l
		}
	}
	a := convert.DonorTris(m, rest)
	b := convert.DonorTris(m, posed)
	longest := func(tr convert.Tri) float64 {
		return math.Max(tr.C[0].Pos.Sub(tr.C[1].Pos).Len(), math.Max(tr.C[1].Pos.Sub(tr.C[2].Pos).Len(), tr.C[2].Pos.Sub(tr.C[0].Pos).Len()))
	}
	bad := 0
	for i := range a {
		if longest(b[i]) > 2*longest(a[i])+0.5 {
			bad++
		}
	}
	t.Logf("stretched: %d of %d (%.2f%%)", bad, len(a), 100*float64(bad)/float64(len(a)))
	f, _ := os.Create(p + "_armsup.png")
	png.Encode(f, draw(m, posed, []vmath.Vec3{{1, 0, 0.15}, {-1, 0, 0.15}, {1, -1, 0.6}}, true))
	f.Close()
}
