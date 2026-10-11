// Package simplify reduces triangle counts with quadric error metrics (Garland–Heckbert edge collapse). Vertices on
// texture seams, material borders, bone borders and open edges are kept in place as long as possible, so textures
// stay aligned and animated parts do not tear.
package simplify

import (
	"container/heap"
	"math"

	"blingmodels/internal/vmath"
)

// Corner attributes travel with the triangle corners; the simplifier only moves positions.
type Corner struct {
	UV     [2]float64
	Normal vmath.Vec3
	Bone   int
}

type Tri struct {
	V      [3]int // vertex indices
	C      [3]Corner
	Mat    int
	Double bool
}

type quadric [10]float64

func planeQuadric(n vmath.Vec3, d, w float64) quadric {
	a, b, c := n[0], n[1], n[2]
	return quadric{a * a * w, a * b * w, a * c * w, a * d * w, b * b * w, b * c * w, b * d * w, c * c * w, c * d * w, d * d * w}
}

func (q *quadric) add(o quadric) {
	for i := range q {
		q[i] += o[i]
	}
}

func (q quadric) eval(p vmath.Vec3) float64 {
	x, y, z := p[0], p[1], p[2]
	return q[0]*x*x + 2*q[1]*x*y + 2*q[2]*x*z + 2*q[3]*x + q[4]*y*y + 2*q[5]*y*z + 2*q[6]*y + q[7]*z*z + 2*q[8]*z + q[9]
}

type collapse struct {
	cost     float64
	from, to int
	stamp    int
}

type pq []collapse

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].cost < p[j].cost }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(collapse)) }
func (p *pq) Pop() interface{} {
	old := *p
	n := len(old)
	x := old[n-1]
	*p = old[:n-1]
	return x
}

// Reduce simplifies the mesh to about target triangles. pos are welded positions referenced by Tri.V.
func Reduce(pos []vmath.Vec3, tris []Tri, target int) ([]vmath.Vec3, []Tri) {
	if target <= 0 || len(tris) <= target {
		return pos, tris
	}
	nv := len(pos)
	p := append([]vmath.Vec3(nil), pos...)
	t := append([]Tri(nil), tris...)
	alive := make([]bool, len(t))
	for i := range alive {
		alive[i] = true
	}
	vtris := make([][]int, nv)
	for i, tr := range t {
		for k := 0; k < 3; k++ {
			vtris[tr.V[k]] = append(vtris[tr.V[k]], i)
		}
	}

	// Scale-independent penalty for seams and borders.
	mn := vmath.Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx := mn.Scale(-1)
	for _, v := range p {
		mn, mx = mn.Min(v), mx.Max(v)
	}
	diag := mx.Sub(mn).Len()
	if diag <= 0 {
		return pos, tris
	}

	q := make([]quadric, nv)
	for _, tr := range t {
		a, b, c := p[tr.V[0]], p[tr.V[1]], p[tr.V[2]]
		n := b.Sub(a).Cross(c.Sub(a))
		area := n.Len()
		if area < 1e-20 {
			continue
		}
		n = n.Scale(1 / area)
		pq := planeQuadric(n, -n.Dot(a), area)
		for k := 0; k < 3; k++ {
			q[tr.V[k]].add(pq)
		}
	}
	// Edge use counts: open borders get a perpendicular plane so their outline is kept.
	type ekey struct{ a, b int }
	edgeTris := map[ekey][]int{}
	for i, tr := range t {
		for k := 0; k < 3; k++ {
			a, b := tr.V[k], tr.V[(k+1)%3]
			if a > b {
				a, b = b, a
			}
			edgeTris[ekey{a, b}] = append(edgeTris[ekey{a, b}], i)
		}
	}
	locked := make([]bool, nv) // seam/border vertices: collapsed only with a large penalty
	for e, ts := range edgeTris {
		if len(ts) == 1 {
			tr := t[ts[0]]
			a, b := p[e.a], p[e.b]
			c := p[tr.V[0]].Add(p[tr.V[1]]).Add(p[tr.V[2]]).Scale(1.0 / 3)
			edge := b.Sub(a)
			fn := edge.Cross(c.Sub(a)).Cross(edge).Norm()
			bq := planeQuadric(fn, -fn.Dot(a), edge.Dot(edge)*10)
			q[e.a].add(bq)
			q[e.b].add(bq)
			locked[e.a], locked[e.b] = true, true
		}
	}
	for v := 0; v < nv; v++ {
		var first *Corner
		for _, ti := range vtris[v] {
			tr := &t[ti]
			for k := 0; k < 3; k++ {
				if tr.V[k] != v {
					continue
				}
				c := tr.C[k]
				if first == nil {
					first = &tr.C[k]
					continue
				}
				if math.Abs(c.UV[0]-first.UV[0]) > 1e-6 || math.Abs(c.UV[1]-first.UV[1]) > 1e-6 || c.Bone != first.Bone || tr.Mat != t[vtris[v][0]].Mat {
					locked[v] = true
				}
			}
		}
	}
	penalty := diag * diag * 1e-3

	stamp := make([]int, nv)
	h := &pq{}
	cost := func(from, to int) float64 {
		c := q[from].eval(p[to]) + q[to].eval(p[to])
		if locked[from] {
			c += penalty
		}
		return c
	}
	pushEdges := func(v int) {
		for _, ti := range vtris[v] {
			if !alive[ti] {
				continue
			}
			for k := 0; k < 3; k++ {
				u := t[ti].V[k]
				if u == v {
					continue
				}
				heap.Push(h, collapse{cost(v, u), v, u, stamp[v]})
				heap.Push(h, collapse{cost(u, v), u, v, stamp[u]})
			}
		}
	}
	for v := 0; v < nv; v++ {
		pushEdges(v)
	}
	liveCount := len(t)
	normalOf := func(tr *Tri, override, with int) vmath.Vec3 {
		var pts [3]vmath.Vec3
		for k := 0; k < 3; k++ {
			if tr.V[k] == override {
				pts[k] = p[with]
			} else {
				pts[k] = p[tr.V[k]]
			}
		}
		return pts[1].Sub(pts[0]).Cross(pts[2].Sub(pts[0]))
	}
	for liveCount > target && h.Len() > 0 {
		c := heap.Pop(h).(collapse)
		if c.stamp != stamp[c.from] || c.from == c.to {
			continue
		}
		from, to := c.from, c.to
		// Still an edge?
		shared := false
		for _, ti := range vtris[from] {
			if alive[ti] && (t[ti].V[0] == to || t[ti].V[1] == to || t[ti].V[2] == to) {
				shared = true
				break
			}
		}
		if !shared {
			continue
		}
		// Reject collapses that flip a surviving triangle.
		flips := false
		for _, ti := range vtris[from] {
			tr := &t[ti]
			if !alive[ti] || tr.V[0] == to || tr.V[1] == to || tr.V[2] == to {
				continue
			}
			before := normalOf(tr, -1, -1)
			after := normalOf(tr, from, to)
			if before.Dot(after) <= 0 || after.Len() < before.Len()*1e-3 {
				flips = true
				break
			}
		}
		if flips {
			continue
		}
		// Corner attributes of `to` taken from a triangle that disappears (keeps UVs continuous across the edge).
		var toCorner *Corner
		for _, ti := range vtris[from] {
			tr := &t[ti]
			if !alive[ti] {
				continue
			}
			for k := 0; k < 3; k++ {
				if tr.V[k] == to {
					toCorner = &tr.C[k]
				}
			}
			if toCorner != nil {
				break
			}
		}
		for _, ti := range vtris[from] {
			if !alive[ti] {
				continue
			}
			tr := &t[ti]
			if tr.V[0] == to || tr.V[1] == to || tr.V[2] == to {
				alive[ti] = false
				liveCount--
				continue
			}
			for k := 0; k < 3; k++ {
				if tr.V[k] == from {
					tr.V[k] = to
					if toCorner != nil && !locked[from] {
						tr.C[k] = *toCorner
					}
				}
			}
			vtris[to] = append(vtris[to], ti)
		}
		vtris[from] = nil
		q[to].add(q[from])
		locked[to] = locked[to] || locked[from]
		stamp[from]++
		stamp[to]++
		pushEdges(to)
	}
	var out []Tri
	for i, tr := range t {
		if alive[i] {
			out = append(out, tr)
		}
	}
	return p, out
}
