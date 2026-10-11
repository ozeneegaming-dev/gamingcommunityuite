package convert

import (
	"math"

	"blingmodels/internal/simplify"
	"blingmodels/internal/vmath"
)

// Simplify reduces the scene to about target triangles (0 = keep everything).
func (s *Scene) Simplify(target int) {
	if target <= 0 || len(s.Tris) <= target {
		return
	}
	mn, mx := s.Bounds()
	eps := mx.Sub(mn).Len() * 1e-6
	if eps <= 0 {
		return
	}
	type key [3]int64
	index := map[key]int{}
	var pos []vmath.Vec3
	weld := func(p vmath.Vec3) int {
		k := key{int64(math.Round(p[0] / eps)), int64(math.Round(p[1] / eps)), int64(math.Round(p[2] / eps))}
		if i, ok := index[k]; ok {
			return i
		}
		index[k] = len(pos)
		pos = append(pos, p)
		return len(pos) - 1
	}
	tris := make([]simplify.Tri, 0, len(s.Tris))
	for _, t := range s.Tris {
		var st simplify.Tri
		st.Mat = t.Mat
		for k, c := range t.C {
			st.V[k] = weld(c.Pos)
			st.C[k] = simplify.Corner{UV: c.UV, Normal: c.Normal, Bone: c.Bone}
		}
		if st.V[0] == st.V[1] || st.V[1] == st.V[2] || st.V[0] == st.V[2] {
			continue
		}
		tris = append(tris, st)
	}
	pos, tris = simplify.Reduce(pos, tris, target)
	out := make([]Tri, 0, len(tris))
	for _, st := range tris {
		var t Tri
		t.Mat = st.Mat
		for k := 0; k < 3; k++ {
			t.C[k] = Corner{Pos: pos[st.V[k]], Normal: st.C[k].Normal, UV: st.C[k].UV, Bone: st.C[k].Bone}
		}
		if !degenerate(t) {
			out = append(out, t)
		}
	}
	s.Tris = out
}
