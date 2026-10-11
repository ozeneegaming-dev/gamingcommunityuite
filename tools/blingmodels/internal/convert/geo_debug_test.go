package convert

import (
	"fmt"
	"os"
	"testing"
)

func TestGeoDebug(t *testing.T) {
	p := os.Getenv("BLINGMODELS_GEO")
	if p == "" {
		t.Skip()
	}
	s := loadSample(t, p, false)
	mn, mx := s.Bounds()
	t.Logf("bounds %v %v", mn, mx)
	for i, b := range s.Bones {
		t.Logf("%2d %-10s parent %2d pos %v", i, b.Name, b.Parent, fmt.Sprintf("%.1f %.1f %.1f", b.Rest.T[0], b.Rest.T[1], b.Rest.T[2]))
	}
	t.Logf("keys %v", s.geoClassify())
}
