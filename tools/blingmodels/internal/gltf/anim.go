package gltf

import (
	"fmt"
	"math"
	"sort"

	"blingmodels/internal/vmath"
)

// Track is one animated property of one node.
type Track struct {
	Times  []float64
	Values [][]float64 // per key: 3 (translation/scale) or 4 (rotation); for CUBICSPLINE: in-tangent, value, out-tangent
	Interp string
}

// Clip groups the tracks of one glTF animation by node.
type Clip struct {
	Name        string
	Duration    float64
	Translation map[int]*Track
	Rotation    map[int]*Track
	Scale       map[int]*Track
}

// Clips decodes every animation (morph target weights are ignored: GoldSrc has no morphs).
func (d *Doc) Clips() ([]Clip, error) {
	var out []Clip
	for ai, a := range d.Animations {
		c := Clip{Name: a.Name, Translation: map[int]*Track{}, Rotation: map[int]*Track{}, Scale: map[int]*Track{}}
		if c.Name == "" {
			c.Name = fmt.Sprintf("anim%d", ai+1)
		}
		for _, ch := range a.Channels {
			if ch.Target.Node == nil || ch.Sampler < 0 || ch.Sampler >= len(a.Samplers) {
				continue
			}
			s := a.Samplers[ch.Sampler]
			times, err := d.Floats(s.Input)
			if err != nil {
				return nil, err
			}
			vals, err := d.Floats(s.Output)
			if err != nil {
				return nil, err
			}
			tr := &Track{Interp: s.Interpolation, Values: vals}
			if tr.Interp == "" {
				tr.Interp = "LINEAR"
			}
			for _, t := range times {
				tr.Times = append(tr.Times, t[0])
			}
			if len(tr.Times) == 0 {
				continue
			}
			want := len(tr.Times)
			if tr.Interp == "CUBICSPLINE" {
				want *= 3
			}
			if len(vals) < want {
				continue
			}
			if last := tr.Times[len(tr.Times)-1]; last > c.Duration {
				c.Duration = last
			}
			switch ch.Target.Path {
			case "translation":
				c.Translation[*ch.Target.Node] = tr
			case "rotation":
				c.Rotation[*ch.Target.Node] = tr
			case "scale":
				c.Scale[*ch.Target.Node] = tr
			}
		}
		if len(c.Translation)+len(c.Rotation)+len(c.Scale) > 0 {
			out = append(out, c)
		}
	}
	return out, nil
}

// key returns the segment index i and factor u so that t lies between Times[i] and Times[i+1].
func (tr *Track) key(t float64) (int, float64) {
	n := len(tr.Times)
	if t <= tr.Times[0] || n == 1 {
		return 0, 0
	}
	if t >= tr.Times[n-1] {
		return n - 1, 0
	}
	i := sort.SearchFloat64s(tr.Times, t) - 1
	if i < 0 {
		i = 0
	}
	dt := tr.Times[i+1] - tr.Times[i]
	if dt <= 0 {
		return i, 0
	}
	return i, (t - tr.Times[i]) / dt
}

func (tr *Track) value(k int) []float64 {
	if tr.Interp == "CUBICSPLINE" {
		return tr.Values[k*3+1]
	}
	return tr.Values[k]
}

// SampleVec evaluates a translation/scale track at time t.
func (tr *Track) SampleVec(t float64) vmath.Vec3 {
	i, u := tr.key(t)
	a := tr.value(i)
	if u == 0 || i+1 >= len(tr.Times) || tr.Interp == "STEP" {
		return vmath.Vec3{a[0], a[1], a[2]}
	}
	b := tr.value(i + 1)
	if tr.Interp == "CUBICSPLINE" {
		dt := tr.Times[i+1] - tr.Times[i]
		out := tr.Values[i*3+2]
		in := tr.Values[(i+1)*3]
		var r vmath.Vec3
		for c := 0; c < 3; c++ {
			r[c] = hermite(a[c], out[c]*dt, b[c], in[c]*dt, u)
		}
		return r
	}
	return vmath.Vec3{a[0] + (b[0]-a[0])*u, a[1] + (b[1]-a[1])*u, a[2] + (b[2]-a[2])*u}
}

// SampleQuat evaluates a rotation track at time t.
func (tr *Track) SampleQuat(t float64) vmath.Quat {
	i, u := tr.key(t)
	a := tr.value(i)
	qa := vmath.Quat{a[0], a[1], a[2], a[3]}.Normalize()
	if u == 0 || i+1 >= len(tr.Times) || tr.Interp == "STEP" {
		return qa
	}
	b := tr.value(i + 1)
	qb := vmath.Quat{b[0], b[1], b[2], b[3]}.Normalize()
	if tr.Interp == "CUBICSPLINE" {
		dt := tr.Times[i+1] - tr.Times[i]
		out := tr.Values[i*3+2]
		in := tr.Values[(i+1)*3]
		var q vmath.Quat
		for c := 0; c < 4; c++ {
			q[c] = hermite(a[c], out[c]*dt, b[c], in[c]*dt, u)
		}
		return q.Normalize()
	}
	return vmath.Slerp(qa, qb, u)
}

func hermite(p0, m0, p1, m1, t float64) float64 {
	t2, t3 := t*t, t*t*t
	return (2*t3-3*t2+1)*p0 + (t3-2*t2+t)*m0 + (-2*t3+3*t2)*p1 + (t3-t2)*m1
}

// NodeTRSAt is the node's local transform at time t in a clip (rest values for properties the clip does not animate).
func (d *Doc) NodeTRSAt(c *Clip, node int, t float64) (vmath.Vec3, vmath.Quat, vmath.Vec3) {
	n := &d.Nodes[node]
	tt, rr, ss := n.TRS()
	if c != nil {
		if tr, ok := c.Translation[node]; ok {
			tt = tr.SampleVec(t)
		}
		if tr, ok := c.Rotation[node]; ok {
			rr = tr.SampleQuat(t)
		}
		if tr, ok := c.Scale[node]; ok {
			ss = tr.SampleVec(t)
		}
	}
	return tt, rr, ss
}

// WorldMatrices computes every node's world matrix at time t of a clip (nil clip = rest pose).
func (d *Doc) WorldMatrices(c *Clip, t float64) []vmath.Mat4 {
	parents := d.Parents()
	world := make([]vmath.Mat4, len(d.Nodes))
	done := make([]bool, len(d.Nodes))
	var visit func(i int, depth int)
	visit = func(i int, depth int) {
		if done[i] {
			return
		}
		var local vmath.Mat4
		if c == nil || (c.Translation[i] == nil && c.Rotation[i] == nil && c.Scale[i] == nil) {
			local = d.Nodes[i].LocalMatrix()
		} else {
			tt, rr, ss := d.NodeTRSAt(c, i, t)
			local = vmath.TRS(tt, rr, ss)
		}
		p := parents[i]
		if p >= 0 && depth < 512 {
			visit(p, depth+1)
			world[i] = world[p].Mul(local)
		} else {
			world[i] = local
		}
		done[i] = true
	}
	for i := range d.Nodes {
		visit(i, 0)
	}
	return world
}

// IsFinite reports whether every value of a matrix is a real number (corrupt files can hold NaN).
func IsFinite(m vmath.Mat4) bool {
	for _, v := range m {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}
