// Package preview draws a finished .mdl (as the engine would place it, reference pose) from three sides into a PNG,
// so the result can be checked without opening the game.
package preview

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"

	"blingmodels/internal/convert"
	"blingmodels/internal/mdl"
	"blingmodels/internal/vmath"
)

const panel = 420

// Render writes front, side and three-quarter views of the model to path.
func Render(m *mdl.Model, path string) error {
	img := Image(m)
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

// Image renders the three views side by side, in the reference pose.
func Image(m *mdl.Model) *image.NRGBA { return draw(m, convert.DonorBoneWorld(m)) }

// ImageAt renders the model posed at a frame of a sequence, the way the engine computes it.
func ImageAt(m *mdl.Model, seq, frame int) *image.NRGBA { return draw(m, Pose(m, seq, frame)) }

// Pose returns bone transforms at a frame: value + raw * scale, Euler angles to a rotation, parent chain.
func Pose(m *mdl.Model, seq, frame int) []vmath.Bone {
	world := make([]vmath.Bone, len(m.Bones))
	for i, b := range m.Bones {
		var v [6]float64
		for ch := 0; ch < 6; ch++ {
			v[ch] = float64(b.Value[ch])
			if seq < len(m.Sequences) && len(m.Sequences[seq].Anims) > 0 && i < len(m.Sequences[seq].Anims[0]) {
				if vals := m.Sequences[seq].Anims[0][i][ch]; frame < len(vals) {
					v[ch] += float64(vals[frame]) * float64(b.Scale[ch])
				}
			}
		}
		local := vmath.BoneFromPosAngles(vmath.Vec3{v[0], v[1], v[2]}, vmath.Vec3{v[3], v[4], v[5]})
		if b.Parent >= 0 && int(b.Parent) < i {
			world[i] = world[b.Parent].Mul(local)
		} else {
			world[i] = local
		}
	}
	return world
}

func draw(m *mdl.Model, bones []vmath.Bone) *image.NRGBA {
	tris := convert.DonorTris(m, bones)
	img := image.NewNRGBA(image.Rect(0, 0, panel*3, panel))
	for y := 0; y < panel; y++ {
		for x := 0; x < panel*3; x++ {
			g := uint8(24 + 10*y/panel)
			img.SetNRGBA(x, y, color.NRGBA{g, g, g + 8, 255})
		}
	}
	if len(tris) == 0 {
		return img
	}
	views := []vmath.Vec3{{1, 0, 0.15}, {0, -1, 0.15}, {1, -1, 0.6}} // eye directions: front, side, 3/4
	mn := vmath.Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	mx := mn.Scale(-1)
	for _, t := range tris {
		for _, c := range t.C {
			mn, mx = mn.Min(c.Pos), mx.Max(c.Pos)
		}
	}
	center := mn.Add(mx).Scale(0.5)
	radius := mx.Sub(mn).Len() / 2
	if radius <= 0 {
		radius = 1
	}
	light := vmath.Vec3{0.6, -0.4, 0.7}.Norm()
	for vi, eye := range views {
		e := eye.Norm()
		f := e.Scale(-1)
		right := f.Cross(vmath.Vec3{0, 0, 1}).Norm()
		up := right.Cross(f)
		scale := float64(panel) * 0.45 / radius
		ox := float64(vi*panel) + panel/2
		oy := float64(panel) / 2
		zbuf := make([]float64, panel*panel)
		for i := range zbuf {
			zbuf[i] = math.Inf(-1)
		}
		for _, t := range tris {
			var sx, sy, sz [3]float64
			for k, c := range t.C {
				d := c.Pos.Sub(center)
				sx[k] = ox + d.Dot(right)*scale
				sy[k] = oy - d.Dot(up)*scale
				sz[k] = d.Dot(e)
			}
			tx := m.Textures[t.Mat]
			minX := int(math.Max(float64(vi*panel), math.Floor(math.Min(sx[0], math.Min(sx[1], sx[2])))))
			maxX := int(math.Min(float64(vi*panel+panel-1), math.Ceil(math.Max(sx[0], math.Max(sx[1], sx[2])))))
			minY := int(math.Max(0, math.Floor(math.Min(sy[0], math.Min(sy[1], sy[2])))))
			maxY := int(math.Min(panel-1, math.Ceil(math.Max(sy[0], math.Max(sy[1], sy[2])))))
			area := (sx[1]-sx[0])*(sy[2]-sy[0]) - (sx[2]-sx[0])*(sy[1]-sy[0])
			// The engine draws front faces only (counter-clockwise here, with y pointing down: negative area).
			if area > -1e-9 {
				continue
			}
			for py := minY; py <= maxY; py++ {
				for px := minX; px <= maxX; px++ {
					x, y := float64(px)+0.5, float64(py)+0.5
					w0 := ((sx[1]-x)*(sy[2]-y) - (sx[2]-x)*(sy[1]-y)) / area
					w1 := ((sx[2]-x)*(sy[0]-y) - (sx[0]-x)*(sy[2]-y)) / area
					w2 := 1 - w0 - w1
					if w0 < 0 || w1 < 0 || w2 < 0 {
						continue
					}
					z := w0*sz[0] + w1*sz[1] + w2*sz[2]
					zi := py*panel + px - vi*panel
					if z <= zbuf[zi] {
						continue
					}
					s := w0*float64(t.ST[0][0]) + w1*float64(t.ST[1][0]) + w2*float64(t.ST[2][0])
					tt := w0*float64(t.ST[0][1]) + w1*float64(t.ST[1][1]) + w2*float64(t.ST[2][1])
					ix := clamp(int(s), tx.Width-1)
					iy := clamp(int(tt), tx.Height-1)
					idx := tx.Pixels[iy*tx.Width+ix]
					if tx.Flags&mdl.TexMasked != 0 && idx == 255 {
						continue
					}
					zbuf[zi] = z
					n := t.C[0].Normal.Scale(w0).Add(t.C[1].Normal.Scale(w1)).Add(t.C[2].Normal.Scale(w2)).Norm()
					shade := 0.45 + 0.55*math.Abs(n.Dot(light))
					p := tx.Palette[int(idx)*3:]
					img.SetNRGBA(px, py, color.NRGBA{sh(p[0], shade), sh(p[1], shade), sh(p[2], shade), 255})
				}
			}
		}
	}
	return img
}

func clamp(v, hi int) int {
	if v < 0 {
		return 0
	}
	if v > hi {
		return hi
	}
	return v
}

func sh(c byte, s float64) uint8 { return uint8(math.Min(255, float64(c)*s)) }
