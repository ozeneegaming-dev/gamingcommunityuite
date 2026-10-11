// Package tex turns modern textures (any size, true color, alpha) into GoldSrc studio textures: 8-bit palette images
// (256 colors), power-of-two sides up to 512, with "masked" transparency (palette index 255 = see-through) for
// cut-out materials such as foliage, fences and grills.
package tex

import (
	"image"
	"image/color"
	"image/draw"
	"math"
	"sort"
)

type Options struct {
	MaxSide int        // 512 by default (CS 1.6 safe maximum)
	Factor  [4]float64 // base color factor (multiplied in)
	// Mask turns alpha < Cutoff into transparent pixels (masked texture).
	Mask   bool
	Cutoff float64
	// TileU, TileV repeat the image (UVs outside 0..1 cannot wrap in a studio model).
	TileU, TileV int
}

type Result struct {
	Width, Height int
	Pixels        []byte
	Palette       [768]byte
	Masked        bool
}

// Convert prepares one texture.
func Convert(src image.Image, o Options) Result {
	if o.MaxSide <= 0 || o.MaxSide > 512 {
		o.MaxSide = 512
	}
	if o.Cutoff <= 0 {
		o.Cutoff = 0.5
	}
	if o.TileU < 1 {
		o.TileU = 1
	}
	if o.TileV < 1 {
		o.TileV = 1
	}
	if o.Factor == ([4]float64{}) {
		o.Factor = [4]float64{1, 1, 1, 1}
	}
	b := src.Bounds()
	sw, sh := b.Dx()*o.TileU, b.Dy()*o.TileV
	w, h := pow2Side(sw, o.MaxSide), pow2Side(sh, o.MaxSide)
	rgba := resample(src, o.TileU, o.TileV, w, h)
	for i := 0; i < len(rgba); i += 4 {
		for c := 0; c < 4; c++ {
			rgba[i+c] = clamp01(rgba[i+c] * o.Factor[c])
		}
	}
	transparent := make([]bool, w*h)
	masked := false
	if o.Mask {
		for i := range transparent {
			if rgba[i*4+3] < o.Cutoff {
				transparent[i] = true
				masked = true
			}
		}
	}
	colors := 256
	if masked {
		colors = 255
	}
	pal := medianCut(rgba, transparent, colors)
	idx := dither(rgba, transparent, w, h, pal)
	r := Result{Width: w, Height: h, Pixels: idx, Masked: masked}
	for i, c := range pal {
		r.Palette[i*3], r.Palette[i*3+1], r.Palette[i*3+2] = c[0], c[1], c[2]
	}
	if masked {
		// Index 255 is the see-through color (blue by convention, never shown).
		r.Palette[765], r.Palette[766], r.Palette[767] = 0, 0, 255
		for i, t := range transparent {
			if t {
				r.Pixels[i] = 255
			}
		}
	}
	return r
}

// Solid is a small texture of one color (materials without an image).
func Solid(c [4]float64) Result {
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{uint8(clamp01(c[0]) * 255), uint8(clamp01(c[1]) * 255), uint8(clamp01(c[2]) * 255), 255}}, image.Point{}, draw.Src)
	return Convert(img, Options{MaxSide: 8})
}

// pow2Side picks the power of two closest to n (8..max), rounding down when in doubt to save texture memory.
func pow2Side(n, max int) int {
	p := 8
	for p*2 <= max && float64(p*2) <= float64(n)*1.25 {
		p *= 2
	}
	return p
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// resample scales the (tiled) source to w x h with an area filter, linear RGBA floats 0..1.
func resample(src image.Image, tu, tv, w, h int) []float64 {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	// Source pixels once, 4 bytes each (a 4096² texture stays at 64 MB).
	nrgba := image.NewNRGBA(image.Rect(0, 0, sw, sh))
	draw.Draw(nrgba, nrgba.Bounds(), src, b.Min, draw.Src)
	raw := nrgba.Pix
	px := func(i, c int) float64 { return float64(raw[i+c]) / 255 }
	totalW, totalH := float64(sw*tu), float64(sh*tv)
	out := make([]float64, w*h*4)
	fx, fy := totalW/float64(w), totalH/float64(h)
	for y := 0; y < h; y++ {
		y0, y1 := float64(y)*fy, float64(y+1)*fy
		for x := 0; x < w; x++ {
			x0, x1 := float64(x)*fx, float64(x+1)*fx
			var acc [4]float64
			var wsum float64
			if fx <= 1 && fy <= 1 {
				// Upscaling: bilinear sample at the pixel center.
				cx, cy := (x0+x1)/2-0.5, (y0+y1)/2-0.5
				ix, iy := int(math.Floor(cx)), int(math.Floor(cy))
				ax, ay := cx-float64(ix), cy-float64(iy)
				for dy := 0; dy <= 1; dy++ {
					for dx := 0; dx <= 1; dx++ {
						wt := (1 - math.Abs(float64(dx)-ax)) * (1 - math.Abs(float64(dy)-ay))
						sx, sy := wrap(ix+dx, sw), wrap(iy+dy, sh)
						i := (sy*sw + sx) * 4
						for c := 0; c < 4; c++ {
							acc[c] += px(i, c) * wt
						}
						wsum += wt
					}
				}
			} else {
				for sy := int(y0); float64(sy) < y1; sy++ {
					wy := math.Min(float64(sy+1), y1) - math.Max(float64(sy), y0)
					for sx := int(x0); float64(sx) < x1; sx++ {
						wx := math.Min(float64(sx+1), x1) - math.Max(float64(sx), x0)
						wt := wx * wy
						i := (wrap(sy, sh)*sw + wrap(sx, sw)) * 4
						// Premultiplied, so transparent pixels do not bleed their (invisible) color.
						a := px(i, 3)
						acc[0] += px(i, 0) * a * wt
						acc[1] += px(i, 1) * a * wt
						acc[2] += px(i, 2) * a * wt
						acc[3] += a * wt
						wsum += wt
					}
				}
				if acc[3] > 1e-9 {
					acc[0] /= acc[3]
					acc[1] /= acc[3]
					acc[2] /= acc[3]
					acc[3] /= wsum
					wsum = 1
				} else {
					acc = [4]float64{}
					wsum = 1
				}
			}
			o := (y*w + x) * 4
			for c := 0; c < 4; c++ {
				out[o+c] = acc[c] / wsum
			}
		}
	}
	return out
}

func wrap(v, n int) int {
	v %= n
	if v < 0 {
		v += n
	}
	return v
}

type box struct {
	idx      []int32 // indices into colors
	min, max [3]float64
}

// medianCut builds a palette of up to n colors from the opaque pixels.
func medianCut(rgba []float64, transparent []bool, n int) [][3]byte {
	var cols [][3]float64
	step := 1
	if len(transparent) > 300000 {
		step = len(transparent) / 300000
	}
	for i := 0; i < len(transparent); i += step {
		if !transparent[i] {
			cols = append(cols, [3]float64{rgba[i*4], rgba[i*4+1], rgba[i*4+2]})
		}
	}
	if len(cols) == 0 {
		return [][3]byte{{0, 0, 0}}
	}
	all := make([]int32, len(cols))
	for i := range all {
		all[i] = int32(i)
	}
	boxes := []box{mkBox(cols, all)}
	for len(boxes) < n {
		// Split the box with the largest (range x population) along its longest axis.
		best, bestScore := -1, 0.0
		for i, b := range boxes {
			if len(b.idx) < 2 {
				continue
			}
			r := math.Max(b.max[0]-b.min[0], math.Max(b.max[1]-b.min[1], b.max[2]-b.min[2]))
			score := r * math.Sqrt(float64(len(b.idx)))
			if score > bestScore {
				best, bestScore = i, score
			}
		}
		if best < 0 || bestScore <= 1e-6 {
			break
		}
		b := boxes[best]
		axis := 0
		for a := 1; a < 3; a++ {
			if b.max[a]-b.min[a] > b.max[axis]-b.min[axis] {
				axis = a
			}
		}
		sort.Slice(b.idx, func(i, j int) bool { return cols[b.idx[i]][axis] < cols[b.idx[j]][axis] })
		mid := len(b.idx) / 2
		boxes[best] = mkBox(cols, b.idx[:mid])
		boxes = append(boxes, mkBox(cols, b.idx[mid:]))
	}
	pal := make([][3]byte, len(boxes))
	for i, b := range boxes {
		var s [3]float64
		for _, k := range b.idx {
			for c := 0; c < 3; c++ {
				s[c] += cols[k][c]
			}
		}
		for c := 0; c < 3; c++ {
			pal[i][c] = uint8(math.Round(clamp01(s[c]/float64(len(b.idx))) * 255))
		}
	}
	return pal
}

func mkBox(cols [][3]float64, idx []int32) box {
	b := box{idx: idx, min: [3]float64{1, 1, 1}}
	for _, k := range idx {
		for c := 0; c < 3; c++ {
			b.min[c] = math.Min(b.min[c], cols[k][c])
			b.max[c] = math.Max(b.max[c], cols[k][c])
		}
	}
	return b
}

// dither maps pixels to the palette with Floyd–Steinberg error diffusion (transparent pixels take no error).
func dither(rgba []float64, transparent []bool, w, h int, pal [][3]byte) []byte {
	out := make([]byte, w*h)
	errs := make([]float64, w*h*3)
	cache := map[[3]uint8]byte{}
	nearest := func(r, g, b float64) byte {
		k := [3]uint8{uint8(clamp01(r) * 255), uint8(clamp01(g) * 255), uint8(clamp01(b) * 255)}
		if v, ok := cache[k]; ok {
			return v
		}
		best, bd := 0, math.MaxFloat64
		for i, p := range pal {
			dr, dg, db := float64(k[0])-float64(p[0]), float64(k[1])-float64(p[1]), float64(k[2])-float64(p[2])
			d := 0.3*dr*dr + 0.59*dg*dg + 0.11*db*db
			if d < bd {
				best, bd = i, d
			}
		}
		cache[k] = byte(best)
		return byte(best)
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*w + x
			if transparent[i] {
				continue
			}
			r := rgba[i*4] + errs[i*3]
			g := rgba[i*4+1] + errs[i*3+1]
			b := rgba[i*4+2] + errs[i*3+2]
			p := nearest(r, g, b)
			out[i] = p
			c := pal[p]
			er, eg, eb := r-float64(c[0])/255, g-float64(c[1])/255, b-float64(c[2])/255
			spread := func(dx, dy int, f float64) {
				xx, yy := x+dx, y+dy
				if xx < 0 || xx >= w || yy >= h {
					return
				}
				j := yy*w + xx
				if transparent[j] {
					return
				}
				errs[j*3] += er * f
				errs[j*3+1] += eg * f
				errs[j*3+2] += eb * f
			}
			// Softened diffusion (75%) keeps flat areas clean on low-resolution game textures.
			spread(1, 0, 7.0/16*0.75)
			spread(-1, 1, 3.0/16*0.75)
			spread(0, 1, 5.0/16*0.75)
			spread(1, 1, 1.0/16*0.75)
		}
	}
	return out
}
