package convert

import (
	"os"
	"testing"
)

func TestAutoRigDebug(t *testing.T) {
	p := os.Getenv("BLINGMODELS_RIG")
	if p == "" {
		t.Skip()
	}
	s := loadSample(t, p, false)
	note, err := s.AutoRig()
	t.Log(note, err)
	mn, mx := s.Bounds()
	h := mx[2] - mn[2]
	t.Logf("bounds %v %v", mn, mx)
	for _, b := range s.Bones {
		q := b.Rest.T
		t.Logf("%-22s x=%.2f y=%.2f z=%.2f", b.Name, (q[0]-mn[0])/h, (q[1]-(mn[1]+mx[1])/2)/h, (q[2]-mn[2])/h)
	}
}
