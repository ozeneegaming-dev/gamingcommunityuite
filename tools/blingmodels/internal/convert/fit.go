package convert

import (
	"math"

	"blingmodels/internal/vmath"
)

// RotateDegrees turns the scene about X, Y and Z (GoldSrc axes, degrees) around the origin.
func (s *Scene) RotateDegrees(deg vmath.Vec3) {
	if deg == (vmath.Vec3{}) {
		return
	}
	r := vmath.QuatMat3(vmath.AngleQuaternion(deg.Scale(math.Pi / 180)))
	s.Transform(r, 1, vmath.Vec3{})
}

// LayFlat turns the scene by right angles so its longest side runs along X and its thinnest along Z (a weapon lying
// on the ground, like CS w_ models).
func (s *Scene) LayFlat() {
	mn, mx := s.Bounds()
	ext := mx.Sub(mn)
	axes := []int{0, 1, 2}
	// sort axes by extent, longest first
	for i := 0; i < 3; i++ {
		for j := i + 1; j < 3; j++ {
			if ext[axes[j]] > ext[axes[i]] {
				axes[i], axes[j] = axes[j], axes[i]
			}
		}
	}
	var r vmath.Mat3
	for row, a := range axes {
		r[row][a] = 1
	}
	// keep it a rotation (det +1)
	det := r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1]) - r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0]) + r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0])
	if det < 0 {
		r[1] = [3]float64{-r[1][0], -r[1][1], -r[1][2]}
	}
	s.Transform(r, 1, vmath.Vec3{})
}

// PlaceOrigin moves the model: "floor" = centered on X/Y, standing on Z=0; "center" = centered; "keep" = unchanged.
func (s *Scene) PlaceOrigin(mode string) {
	mn, mx := s.Bounds()
	c := mn.Add(mx).Scale(0.5)
	switch mode {
	case "floor":
		s.Transform(identity3(), 1, vmath.Vec3{-c[0], -c[1], -mn[2]})
	case "center":
		s.Transform(identity3(), 1, c.Scale(-1))
	}
}

// ScaleToHeight scales the model so its Z size equals h game units.
func (s *Scene) ScaleToHeight(h float64) {
	mn, mx := s.Bounds()
	if dz := mx[2] - mn[2]; dz > 1e-9 && h > 0 {
		s.Transform(identity3(), h/dz, vmath.Vec3{})
	}
}

func identity3() vmath.Mat3 { return vmath.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}} }

// frame is a point cloud's principal frame: center, axes (columns, longest first) and extents along them.
type frame struct {
	center vmath.Vec3
	axes   vmath.Mat3
	extent vmath.Vec3
}

// principalFrame finds the main axes of weighted points (PCA), with signs chosen by where the bulk lies (skewness), so
// two similar shapes (an AK-47 and another rifle) get matching frames.
func principalFrame(pts []vmath.Vec3, w []float64) frame {
	var sum float64
	var mean vmath.Vec3
	for i, p := range pts {
		mean = mean.Add(p.Scale(w[i]))
		sum += w[i]
	}
	if sum <= 0 {
		return frame{axes: identity3()}
	}
	mean = mean.Scale(1 / sum)
	var cov [3][3]float64
	for i, p := range pts {
		d := p.Sub(mean)
		for a := 0; a < 3; a++ {
			for b := 0; b < 3; b++ {
				cov[a][b] += w[i] * d[a] * d[b]
			}
		}
	}
	vals, vecs := jacobiEigen(cov)
	order := []int{0, 1, 2}
	for i := 0; i < 3; i++ {
		for j := i + 1; j < 3; j++ {
			if vals[order[j]] > vals[order[i]] {
				order[i], order[j] = order[j], order[i]
			}
		}
	}
	var axes vmath.Mat3
	for col, k := range order {
		for row := 0; row < 3; row++ {
			axes[row][col] = vecs[row][k]
		}
	}
	// Extents and skewness along each axis.
	var f frame
	for col := 0; col < 3; col++ {
		ax := vmath.Vec3{axes[0][col], axes[1][col], axes[2][col]}
		lo, hi := math.Inf(1), math.Inf(-1)
		var skew float64
		for i, p := range pts {
			t := p.Sub(mean).Dot(ax)
			lo, hi = math.Min(lo, t), math.Max(hi, t)
			skew += w[i] * t * t * t
		}
		if skew < 0 {
			for row := 0; row < 3; row++ {
				axes[row][col] = -axes[row][col]
			}
			lo, hi = -hi, -lo
		}
		f.extent[col] = hi - lo
		mid := (hi + lo) / 2
		mean = mean.Add(ax.Scale(sign(skew) * mid))
	}
	// Right-handed: flip the least important axis if needed.
	if det3(axes) < 0 {
		for row := 0; row < 3; row++ {
			axes[row][2] = -axes[row][2]
		}
	}
	f.center, f.axes = mean, axes
	return f
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

func det3(m vmath.Mat3) float64 {
	return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
}

// jacobiEigen diagonalizes a symmetric 3x3 matrix; eigenvectors are the columns of vecs.
func jacobiEigen(a [3][3]float64) ([3]float64, [3][3]float64) {
	v := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	for sweep := 0; sweep < 50; sweep++ {
		off := a[0][1]*a[0][1] + a[0][2]*a[0][2] + a[1][2]*a[1][2]
		if off < 1e-22 {
			break
		}
		for p := 0; p < 2; p++ {
			for q := p + 1; q < 3; q++ {
				if math.Abs(a[p][q]) < 1e-30 {
					continue
				}
				theta := (a[q][q] - a[p][p]) / (2 * a[p][q])
				t := sign(theta) / (math.Abs(theta) + math.Sqrt(theta*theta+1))
				c := 1 / math.Sqrt(t*t+1)
				s := t * c
				for k := 0; k < 3; k++ {
					akp, akq := a[k][p], a[k][q]
					a[k][p], a[k][q] = c*akp-s*akq, s*akp+c*akq
				}
				for k := 0; k < 3; k++ {
					apk, aqk := a[p][k], a[q][k]
					a[p][k], a[q][k] = c*apk-s*aqk, s*apk+c*aqk
				}
				for k := 0; k < 3; k++ {
					vkp, vkq := v[k][p], v[k][q]
					v[k][p], v[k][q] = c*vkp-s*vkq, s*vkp+c*vkq
				}
			}
		}
	}
	return [3]float64{a[0][0], a[1][1], a[2][2]}, v
}

// triCloud returns area-weighted triangle centers (a fair sample of a surface).
func triCloud(tris []Tri) ([]vmath.Vec3, []float64) {
	pts := make([]vmath.Vec3, 0, len(tris))
	w := make([]float64, 0, len(tris))
	for _, t := range tris {
		a, b, c := t.C[0].Pos, t.C[1].Pos, t.C[2].Pos
		area := b.Sub(a).Cross(c.Sub(a)).Len() / 2
		if area <= 0 {
			continue
		}
		pts = append(pts, a.Add(b).Add(c).Scale(1.0/3))
		w = append(w, area)
	}
	return pts, w
}

// FitTo moves, turns and scales the scene onto a target shape (the weapon it replaces): principal axes aligned,
// longest side matched. A principal frame leaves each axis' direction open, so the four ways of laying the new
// weapon along the old one's axes are compared and the one that covers the old weapon best wins (magazine down,
// barrel forward). With autoRotate off, only the size and center are matched.
func (s *Scene) FitTo(target []Tri, autoRotate bool) {
	sp, sw := triCloud(s.Tris)
	tp, tw := triCloud(target)
	if len(sp) == 0 || len(tp) == 0 {
		return
	}
	src := principalFrame(sp, sw)
	dst := principalFrame(tp, tw)
	scale := 1.0
	if src.extent[0] > 1e-9 {
		scale = dst.extent[0] / src.extent[0]
	}
	r := identity3()
	if autoRotate {
		base := dst.axes.Mul(src.axes.Transpose())
		// 180° turns about the target's principal axes keep the axes aligned.
		flips := []vmath.Mat3{identity3(), {{1, 0, 0}, {0, -1, 0}, {0, 0, -1}}, {{-1, 0, 0}, {0, 1, 0}, {0, 0, -1}}, {{-1, 0, 0}, {0, -1, 0}, {0, 0, 1}}}
		ss := samplePoints(sp, sw, 1200)
		ts := samplePoints(tp, tw, 1200)
		best := math.Inf(1)
		for _, f := range flips {
			cand := dst.axes.Mul(f).Mul(dst.axes.Transpose()).Mul(base)
			moved := make([]vmath.Vec3, len(ss))
			for i, p := range ss {
				moved[i] = cand.MulVec(p.Sub(src.center)).Scale(scale).Add(dst.center)
			}
			if d := chamfer(moved, ts); d < best {
				best, r = d, cand
			}
		}
	} else {
		smn, smx := s.Bounds()
		tmn, tmx := boundsOf(target)
		sExt, tExt := smx.Sub(smn), tmx.Sub(tmn)
		if l := math.Max(sExt[0], math.Max(sExt[1], sExt[2])); l > 1e-9 {
			scale = math.Max(tExt[0], math.Max(tExt[1], tExt[2])) / l
		}
		src.center = smn.Add(smx).Scale(0.5)
		dst.center = tmn.Add(tmx).Scale(0.5)
	}
	// Move the source center onto the origin, turn and scale, then onto the target center.
	s.Transform(identity3(), 1, src.center.Scale(-1))
	s.Transform(r, scale, dst.center)
}

// samplePoints picks up to n points, favoring large triangles (deterministic).
func samplePoints(pts []vmath.Vec3, w []float64, n int) []vmath.Vec3 {
	if len(pts) <= n {
		return pts
	}
	var total float64
	for _, x := range w {
		total += x
	}
	out := make([]vmath.Vec3, 0, n)
	step := total / float64(n)
	acc, next := 0.0, step/2
	for i, p := range pts {
		acc += w[i]
		for acc >= next && len(out) < n {
			out = append(out, p)
			next += step
		}
	}
	return out
}

// chamfer is the mean distance from each point to the other set, both ways.
func chamfer(a, b []vmath.Vec3) float64 {
	near := func(from, to []vmath.Vec3) float64 {
		var sum float64
		for _, p := range from {
			best := math.Inf(1)
			for _, q := range to {
				d := p.Sub(q)
				if dd := d.Dot(d); dd < best {
					best = dd
				}
			}
			sum += math.Sqrt(best)
		}
		return sum / float64(len(from))
	}
	return near(a, b) + near(b, a)
}

// FlipWeapon turns the scene 180° around its center: "updown" (about the barrel axis X) or "frontback" (about the
// vertical axis Z).
func (s *Scene) FlipWeapon(kind string) {
	var r vmath.Mat3
	switch kind {
	case "updown":
		r = vmath.Mat3{{1, 0, 0}, {0, -1, 0}, {0, 0, -1}}
	case "frontback":
		r = vmath.Mat3{{-1, 0, 0}, {0, -1, 0}, {0, 0, 1}}
	default:
		return
	}
	mn, mx := s.Bounds()
	c := mn.Add(mx).Scale(0.5)
	s.Transform(identity3(), 1, c.Scale(-1))
	s.Transform(r, 1, c)
}

func boundsOf(tris []Tri) (vmath.Vec3, vmath.Vec3) {
	mn := vmath.Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx := mn.Scale(-1)
	for _, t := range tris {
		for _, c := range t.C {
			mn, mx = mn.Min(c.Pos), mx.Max(c.Pos)
		}
	}
	return mn, mx
}
