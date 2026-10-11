package convert

import (
	"fmt"
	"math"
	"os"
	"sort"

	"blingmodels/internal/vmath"
)

// AutoRig gives a static humanoid mesh (a character exported without bones, often a pose taken from a game) a
// Biped skeleton: joints are found from the shape (legs split at the crotch, arms stick out of the torso, spine and
// head along the middle), and every vertex gets smooth skin weights to its nearest bone and that bone's neighbours.
// The mesh must stand upright (+Z); it may face +X or -X. Returns a note for the log, or an error when the shape
// does not read as a body.
func (s *Scene) AutoRig() (string, error) {
	note, err := s.autoRigOnce()
	if err != nil {
		return "", err
	}
	// The toes point forward: a body facing -X is turned around and rigged again.
	if s.toesBackward() {
		s.Bones = []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}}
		for i := range s.Tris {
			for k := range s.Tris[i].C {
				s.Tris[i].C[k].Bone, s.Tris[i].C[k].W = 0, [4]Weight{}
			}
		}
		s.Transform(vmath.Mat3{{-1, 0, 0}, {0, -1, 0}, {0, 0, 1}}, 1, vmath.Vec3{})
		if note, err = s.autoRigOnce(); err != nil {
			return "", err
		}
		note += " (corpul era întors cu spatele; l-am întors)"
	}
	return note, nil
}

type rigJoint struct {
	name   string
	parent string
	pos    vmath.Vec3
	tip    vmath.Vec3 // end of the bone segment (child joint or end point)
}

func (s *Scene) autoRigOnce() (string, error) {
	mn, mx := s.Bounds()
	h := mx[2] - mn[2]
	if h <= 0 {
		return "", fmt.Errorf("modelul nu are înălțime")
	}
	// Unique points (enough for statistics).
	seen := map[[3]float32]bool{}
	var pts []vmath.Vec3
	for _, t := range s.Tris {
		for _, c := range t.C {
			k := [3]float32{float32(c.Pos[0]), float32(c.Pos[1]), float32(c.Pos[2])}
			if !seen[k] {
				seen[k] = true
				pts = append(pts, c.Pos)
			}
		}
	}
	if len(pts) < 50 {
		return "", fmt.Errorf("prea puține puncte")
	}
	z := func(f float64) float64 { return mn[2] + f*h }
	band := func(zc, half float64, keep func(vmath.Vec3) bool) []vmath.Vec3 {
		var out []vmath.Vec3
		for _, p := range pts {
			if math.Abs(p[2]-zc) <= half && (keep == nil || keep(p)) {
				out = append(out, p)
			}
		}
		return out
	}
	median := func(v []float64) float64 {
		if len(v) == 0 {
			return 0
		}
		c := append([]float64(nil), v...)
		sort.Float64s(c)
		return c[len(c)/2]
	}
	centerOf := func(ps []vmath.Vec3) vmath.Vec3 {
		var xs, ys, zs []float64
		for _, p := range ps {
			xs, ys, zs = append(xs, p[0]), append(ys, p[1]), append(zs, p[2])
		}
		return vmath.Vec3{median(xs), median(ys), median(zs)}
	}
	// Body middle (left/right) and front/back from the chest.
	chest := band(z(0.72), 0.02*h, nil)
	if len(chest) < 10 {
		return "", fmt.Errorf("nu găsesc pieptul")
	}
	cc := centerOf(chest)
	cy, cx := cc[1], cc[0]
	// Left/right middle from the waist (arms hang clear of it) and the bounds (bodies are near symmetric).
	if w := band(z(0.6), 0.02*h, func(p vmath.Vec3) bool { return math.Abs(p[1]-(mn[1]+mx[1])/2) < 0.12*h }); len(w) > 10 {
		var ys []float64
		for _, p := range w {
			ys = append(ys, p[1])
		}
		sort.Float64s(ys)
		cy = (ys[len(ys)/20] + ys[len(ys)-1-len(ys)/20]) / 2 // middle of the waist's extent
	}
	// Torso half width at the chest: the central cluster (arms may stick out at that height).
	halfWidth := func(zc float64) float64 {
		var ys []float64
		for _, p := range band(zc, 0.015*h, nil) {
			ys = append(ys, p[1]-cy)
		}
		sort.Float64s(ys)
		// Walk out from the middle until a gap (arm) appears.
		w := 0.0
		for _, side := range []float64{1, -1} {
			last := 0.0
			var vals []float64
			for _, y := range ys {
				if y*side >= 0 {
					vals = append(vals, math.Abs(y))
				}
			}
			sort.Float64s(vals)
			for _, v := range vals {
				if v-last > 0.025*h {
					break
				}
				last = v
			}
			w = math.Max(w, last)
		}
		return w
	}
	// Torso width per height. Where arms touch the body (armpits, an A-pose at the chest) the slice reads too
	// wide, so every height is capped by the waist, where arms hang clear of the body.
	waist := math.Inf(1)
	for f := 0.55; f <= 0.68; f += 0.01 {
		if w := halfWidth(z(f)); w > 0.02*h {
			waist = math.Min(waist, w)
		}
	}
	if math.IsInf(waist, 1) {
		waist = 0.08 * h
	}
	widthAt := map[int]float64{}
	torsoAt := func(zz float64) float64 {
		bin := int(math.Round((zz - mn[2]) / h * 100))
		if w, ok := widthAt[bin]; ok {
			return w
		}
		w := math.Min(halfWidth(mn[2]+float64(bin)/100*h), waist*1.35)
		if w < waist*0.8 {
			w = waist * 0.8
		}
		widthAt[bin] = w
		return w
	}
	torsoHalf := math.Min(halfWidth(z(0.70)), waist*1.35)
	if os.Getenv("BLINGMODELS_RIGDEBUG") != "" {
		fmt.Println("torsoHalf/h", torsoHalf/h, "waist/h", waist/h, "cx", cx, "cy", cy)
	}

	// Crotch: highest height where the middle splits in two (the legs), looking near the middle only (hands of an
	// A-pose hang beside the hips).
	crotch := -1.0
	var legY [2]float64 // L (+Y), R
	for f := 0.56; f >= 0.25; f -= 0.005 {
		ps := band(z(f), 0.008*h, func(p vmath.Vec3) bool { return math.Abs(p[1]-cy) < waist*1.4 })
		var ys []float64
		for _, p := range ps {
			ys = append(ys, p[1]-cy)
		}
		if len(ys) < 6 {
			continue
		}
		sort.Float64s(ys)
		// Largest gap that straddles the middle.
		bestGap, gapAt := 0.0, 0.0
		for i := 1; i < len(ys); i++ {
			if g := ys[i] - ys[i-1]; g > bestGap && math.Abs((ys[i]+ys[i-1])/2) < 0.025*h {
				bestGap, gapAt = g, (ys[i]+ys[i-1])/2
			}
		}
		if bestGap > 0.008*h {
			var l, r []float64
			for _, y := range ys {
				if y > gapAt {
					l = append(l, y)
				} else {
					r = append(r, y)
				}
			}
			// Two legs: both sides populated alike, at similar distances from the middle.
			if len(l) == 0 || len(r) == 0 {
				continue
			}
			nl, nr := float64(len(l)), float64(len(r))
			dl, dr := median(l), -median(r)
			if nl/nr < 0.4 || nr/nl < 0.4 || dl <= 0 || dr <= 0 || dl/dr > 2 || dr/dl > 2 {
				continue
			}
			crotch = z(f)
			legY = [2]float64{cy + dl, cy - dr}
			break
		}
	}
	if crotch < 0 || legY[0] <= legY[1] {
		return "", fmt.Errorf("nu găsesc picioarele (modelul nu pare un om în picioare)")
	}
	hipZ := crotch + 0.035*h
	if hipZ > z(0.6) {
		hipZ = z(0.6)
	}

	joints := map[string]*rigJoint{}
	add := func(name, parent string, p vmath.Vec3) *rigJoint {
		j := &rigJoint{name: name, parent: parent, pos: p}
		joints[name] = j
		return j
	}
	slice := func(zc float64, keep func(vmath.Vec3) bool) (vmath.Vec3, bool) {
		ps := band(zc, 0.012*h, keep)
		if len(ps) < 3 {
			return vmath.Vec3{}, false
		}
		return centerOf(ps), true
	}
	mid := func(p vmath.Vec3) bool { return math.Abs(p[1]-cy) < torsoHalf*1.1 }
	pelvisC, _ := slice(hipZ, mid)
	add("Bip01 Pelvis", "", vmath.Vec3{pelvisC[0], cy, hipZ})
	// Spine, neck, head along the middle.
	spine := []struct {
		name string
		f    float64
	}{{"Bip01 Spine", 0.60}, {"Bip01 Spine1", 0.67}, {"Bip01 Spine2", 0.74}, {"Bip01 Neck", 0.845}, {"Bip01 Head", 0.885}}
	parent := "Bip01 Pelvis"
	for _, sp := range spine {
		zc := z(sp.f)
		if zc <= hipZ {
			zc = hipZ + 0.02*h
		}
		c, ok := slice(zc, func(p vmath.Vec3) bool { return math.Abs(p[1]-cy) < torsoHalf*0.9 })
		if !ok {
			c = vmath.Vec3{cx, cy, zc}
		}
		add(sp.name, parent, vmath.Vec3{c[0], cy, zc})
		parent = sp.name
	}
	joints["Bip01 Head"].tip = vmath.Vec3{joints["Bip01 Head"].pos[0], cy, mx[2]}

	// Legs.
	for i, side := range []string{"L", "R"} {
		ly := legY[i]
		onLeg := func(p vmath.Vec3) bool {
			return (p[1]-cy)*(ly-cy) > 0 && math.Abs(p[1]-ly) < 0.12*h
		}
		hip := vmath.Vec3{pelvisC[0], ly, hipZ}
		ankleZ := z(0.05)
		kneeZ := (hipZ + ankleZ) / 2
		knee, ok := slice(kneeZ, onLeg)
		if !ok {
			knee = vmath.Vec3{hip[0], ly, kneeZ}
		}
		ankle, ok := slice(ankleZ, onLeg)
		if !ok {
			ankle = vmath.Vec3{hip[0], ly, ankleZ}
		}
		// Toe: the front-most part of the foot (+X).
		var foot []vmath.Vec3
		for _, p := range pts {
			if p[2] < z(0.045) && onLeg(p) {
				foot = append(foot, p)
			}
		}
		toe := vmath.Vec3{ankle[0] + 0.06*h, ankle[1], z(0.015)}
		if len(foot) > 3 {
			sort.Slice(foot, func(a, b int) bool { return foot[a][0] > foot[b][0] })
			front := foot[:max(1, len(foot)/6)]
			c := centerOf(front)
			toe = vmath.Vec3{c[0], c[1], z(0.015)}
		}
		ballAt := ankle.Add(toe.Sub(ankle).Scale(0.6))
		ballAt[2] = z(0.015)
		add("Bip01 "+side+" Thigh", "Bip01 Pelvis", hip)
		add("Bip01 "+side+" Calf", "Bip01 "+side+" Thigh", knee)
		add("Bip01 "+side+" Foot", "Bip01 "+side+" Calf", ankle)
		t := add("Bip01 "+side+" Toe0", "Bip01 "+side+" Foot", ballAt)
		t.tip = toe.Add(toe.Sub(ballAt).Scale(0.3))
	}

	// Arms: the points beside the torso above the hips, split by side; the hand is the point farthest from the
	// shoulder, the elbow and wrist are found along the arm.
	shoulderZ := z(0.815)
	armFound := 0
	armSet := map[[3]float32]string{} // points that belong to an arm: "L" / "R"
	keyOf := func(p vmath.Vec3) [3]float32 { return [3]float32{float32(p[0]), float32(p[1]), float32(p[2])} }
	for _, sd := range []struct {
		name string
		sign float64
	}{{"L", 1}, {"R", -1}} {
		shoulder := vmath.Vec3{cx, cy + sd.sign*torsoHalf*0.85, shoulderZ}
		var arm []vmath.Vec3
		for _, p := range pts {
			off := (p[1] - cy) * sd.sign
			// Arms hang beside the body, not behind it (wings, capes and backpacks stick out backwards).
			if math.Abs(p[0]-cx) > 0.09*h {
				continue
			}
			if off > torsoAt(p[2])*1.12+0.01*h && p[2] > hipZ-0.12*h && p[2] < z(0.9) {
				// Thighs are not arms: below the hips, only points far out to the side.
				if p[2] < hipZ && off < waist*1.9 {
					continue
				}
				arm = append(arm, p)
			}
		}
		if len(arm) < 10 {
			continue
		}
		armFound++
		// Hand tip: the far end (average of the farthest 2%).
		sort.Slice(arm, func(a, b int) bool {
			return arm[a].Sub(shoulder).Len() > arm[b].Sub(shoulder).Len()
		})
		tip := centerOf(arm[:max(1, len(arm)/50)])
		dir := tip.Sub(shoulder)
		L := dir.Len()
		dir = dir.Scale(1 / L)
		along := func(t0, t1 float64) vmath.Vec3 {
			var ps []vmath.Vec3
			for _, p := range arm {
				t := p.Sub(shoulder).Dot(dir) / L
				if t >= t0 && t <= t1 {
					ps = append(ps, p)
				}
			}
			if len(ps) < 3 {
				return shoulder.Add(dir.Scale((t0 + t1) / 2 * L))
			}
			return centerOf(ps)
		}
		elbow := along(0.40, 0.47)
		wrist := along(0.74, 0.80)
		// The arm proper: points close to the shoulder-elbow-wrist-tip line (sleeve thickness), from just outside the
		// torso.
		armLine := []vmath.Vec3{shoulder, elbow, wrist, tip}
		for _, p := range pts {
			if (p[1]-cy)*sd.sign < torsoAt(p[2])*0.85 || math.Abs(p[0]-cx) > 0.12*h {
				continue
			}
			d := math.Inf(1)
			for i := 0; i+1 < len(armLine); i++ {
				ab := armLine[i+1].Sub(armLine[i])
				t := math.Max(0, math.Min(1, p.Sub(armLine[i]).Dot(ab)/math.Max(ab.Dot(ab), 1e-12)))
				d = math.Min(d, p.Sub(armLine[i].Add(ab.Scale(t))).Len())
			}
			if d < 0.075*h {
				armSet[keyOf(p)] = sd.name
			}
		}
		clav := vmath.Vec3{cx, cy + sd.sign*0.025*h, shoulderZ - 0.01*h}
		add("Bip01 "+sd.name+" Clavicle", "Bip01 Spine2", clav)
		add("Bip01 "+sd.name+" UpperArm", "Bip01 "+sd.name+" Clavicle", shoulder)
		add("Bip01 "+sd.name+" Forearm", "Bip01 "+sd.name+" UpperArm", elbow)
		hand := add("Bip01 "+sd.name+" Hand", "Bip01 "+sd.name+" Forearm", wrist)
		hand.tip = tip
	}
	if armFound < 2 {
		return "", fmt.Errorf("nu găsesc brațele (stau lipite de corp?)")
	}

	// Skeleton in parent-first order; segments end at the first child (or the tip).
	order := []string{"Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1", "Bip01 Spine2", "Bip01 Neck", "Bip01 Head"}
	for _, side := range []string{"L", "R"} {
		order = append(order, "Bip01 "+side+" Clavicle", "Bip01 "+side+" UpperArm", "Bip01 "+side+" Forearm", "Bip01 "+side+" Hand")
	}
	for _, side := range []string{"L", "R"} {
		order = append(order, "Bip01 "+side+" Thigh", "Bip01 "+side+" Calf", "Bip01 "+side+" Foot", "Bip01 "+side+" Toe0")
	}
	index := map[string]int{}
	s.Bones = []SBone{{Name: "root", Parent: -1, Rest: vmath.BoneIdentity()}}
	for _, n := range order {
		j := joints[n]
		p := 0
		if j.parent != "" {
			p = index[j.parent]
		}
		index[n] = len(s.Bones)
		s.Bones = append(s.Bones, SBone{Name: n, Parent: p, Rest: vmath.Bone{R: identity3(), T: j.pos}})
	}
	firstChild := map[string]string{"Bip01 Pelvis": "Bip01 Spine", "Bip01 Spine": "Bip01 Spine1", "Bip01 Spine1": "Bip01 Spine2", "Bip01 Spine2": "Bip01 Neck", "Bip01 Neck": "Bip01 Head"}
	for _, side := range []string{"L", "R"} {
		b := "Bip01 " + side + " "
		firstChild[b+"Clavicle"], firstChild[b+"UpperArm"], firstChild[b+"Forearm"] = b+"UpperArm", b+"Forearm", b+"Hand"
		firstChild[b+"Thigh"], firstChild[b+"Calf"], firstChild[b+"Foot"] = b+"Calf", b+"Foot", b+"Toe0"
	}
	type seg struct{ a, b vmath.Vec3 }
	segs := make([]seg, len(s.Bones))
	for _, n := range order {
		j := joints[n]
		end := j.tip
		if c, ok := firstChild[n]; ok {
			end = joints[c].pos
		}
		if end == (vmath.Vec3{}) {
			end = j.pos
		}
		segs[index[n]] = seg{j.pos, end}
	}
	// Neighbours a vertex may blend with: the nearest bone, its parent and its children.
	neighbours := make([][]int, len(s.Bones))
	for i, b := range s.Bones {
		if i == 0 {
			continue
		}
		neighbours[i] = append(neighbours[i], i)
		if b.Parent > 0 {
			neighbours[i] = append(neighbours[i], b.Parent)
			neighbours[b.Parent] = append(neighbours[b.Parent], i)
		}
	}
	distSeg := func(p vmath.Vec3, sg seg) float64 {
		ab := sg.b.Sub(sg.a)
		l2 := ab.Dot(ab)
		t := 0.0
		if l2 > 1e-12 {
			t = math.Max(0, math.Min(1, p.Sub(sg.a).Dot(ab)/l2))
		}
		return p.Sub(sg.a.Add(ab.Scale(t))).Len()
	}
	cache := map[[3]float32][4]Weight{}
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			c := &s.Tris[i].C[k]
			key := [3]float32{float32(c.Pos[0]), float32(c.Pos[1]), float32(c.Pos[2])}
			w, ok := cache[key]
			if !ok {
				armSide := armSet[key]
				best, bestD := 1, math.Inf(1)
				for b := 1; b < len(s.Bones); b++ {
					name := s.Bones[b].Name
					isArm := isArmBone(name)
					// Arm bones only take arm points, and an arm point only takes its own arm (plus the clavicle).
					if isArm != (armSide != "") && !(armSide != "" && isClavicle(name)) {
						continue
					}
					if armSide != "" && name[6:7] != armSide {
						continue
					}
					// Keep sides apart: a left-side bone never takes a point clearly on the right.
					if d := distSeg(c.Pos, segs[b]); d < bestD && sideOK(name, c.Pos[1]-cy, h) {
						best, bestD = b, d
					}
				}
				type cand struct {
					b int
					w float64
				}
				var cs []cand
				for _, b := range neighbours[best] {
					if isArmBone(s.Bones[b].Name) && armSide == "" {
						continue // the torso does not stretch toward the arms
					}
					d := distSeg(c.Pos, segs[b])
					cs = append(cs, cand{b, 1 / math.Pow(d+0.01*h, 4)})
				}
				sort.Slice(cs, func(a, b int) bool { return cs[a].w > cs[b].w })
				var total float64
				for n := 0; n < len(cs) && n < 3; n++ {
					total += cs[n].w
				}
				for n := 0; n < len(cs) && n < 3; n++ {
					w[n] = Weight{Bone: cs[n].b, W: cs[n].w / total}
				}
				w = shoulderBlend(w, c.Pos, armSide, cy, h, index, joints)
				cache[key] = w
			}
			c.W = w
			c.Bone = w[0].Bone
		}
	}
	// (surface smoothing of weights was tried: it drags rib-cage skin along with a raised arm)
	return fmt.Sprintf("modelul nu avea schelet: i-am construit unul (%d oase: picioare, coloană, cap, brațe) și am legat pielea", len(s.Bones)-1), nil
}

// sideOK: bones of one side do not take points well over on the other side.
func sideOK(name string, y, h float64) bool {
	switch {
	case len(name) > 7 && name[6] == 'L':
		return y > -0.02*h
	case len(name) > 7 && name[6] == 'R':
		return y < 0.02*h
	}
	return true
}

// toesBackward reports whether the rigged feet point to -X (the body faces backwards).
func (s *Scene) toesBackward() bool {
	var d float64
	for i, b := range s.Bones {
		if len(b.Name) > 4 && b.Name[len(b.Name)-4:] == "Toe0" && b.Parent >= 0 {
			d += s.Bones[i].Rest.T[0] - s.Bones[b.Parent].Rest.T[0]
		}
	}
	return d < 0
}

func isArmBone(name string) bool {
	return len(name) > 8 && (hasSuffix(name, "UpperArm") || hasSuffix(name, "Forearm") || hasSuffix(name, "Hand"))
}

func isClavicle(name string) bool { return hasSuffix(name, "Clavicle") }

func hasSuffix(s, suf string) bool { return len(s) >= len(suf) && s[len(s)-len(suf):] == suf }

// shoulderBlend softens the seam between arm and torso: points near a shoulder follow both the upper arm and the
// chest, more of the one they belong to (a hand-made rig blends there too).
func shoulderBlend(w [4]Weight, p vmath.Vec3, armSide string, cy, h float64, index map[string]int, joints map[string]*rigJoint) [4]Weight {
	side := "L"
	if p[1] < cy {
		side = "R"
	}
	sh, ok := joints["Bip01 "+side+" UpperArm"]
	if !ok {
		return w
	}
	r := 0.08 * h
	d := p.Sub(sh.pos).Len()
	if d >= r {
		return w
	}
	f := 1 - d/r
	other := index["Bip01 "+side+" UpperArm"]
	amount := 0.5 * f * f // torso point: up to half follows the arm
	if armSide != "" {
		other = index["Bip01 Spine2"]
		amount = 0.45 * f * f // arm point near the shoulder: part follows the chest
	}
	var out [4]Weight
	n := 0
	placed := false
	for _, x := range w {
		if x.W <= 0 {
			continue
		}
		if x.Bone == other {
			x.W = x.W*(1-amount) + amount
			placed = true
		} else {
			x.W *= 1 - amount
		}
		if n < 4 {
			out[n] = x
			n++
		}
	}
	if !placed {
		if n < 4 {
			out[n] = Weight{Bone: other, W: amount}
		} else {
			out[3] = Weight{Bone: other, W: amount + out[3].W}
		}
	}
	// largest first, so Bone (the engine's single bone) is the strongest
	sort.Slice(out[:], func(a, b int) bool { return out[a].W > out[b].W })
	return out
}

// smoothWeights spreads skin weights over the surface (each pass mixes every vertex with its neighbours), so the
// change from one bone to the next is gradual: joints bend like a hand-made rig instead of tearing at a seam.
// Only connected surface is mixed, so a hand resting on a hip does not stick to it.
func (s *Scene) smoothWeights(passes int) {
	type key [3]float32
	keyOf := func(p vmath.Vec3) key { return key{float32(p[0]), float32(p[1]), float32(p[2])} }
	idx := map[key]int{}
	var weights []map[int]float64
	for _, t := range s.Tris {
		for _, c := range t.C {
			k := keyOf(c.Pos)
			if _, ok := idx[k]; ok {
				continue
			}
			m := map[int]float64{}
			for _, w := range c.W {
				if w.W > 0 {
					m[w.Bone] += w.W
				}
			}
			idx[k] = len(weights)
			weights = append(weights, m)
		}
	}
	nbr := make([]map[int]bool, len(weights))
	for i := range nbr {
		nbr[i] = map[int]bool{}
	}
	for _, t := range s.Tris {
		var v [3]int
		for k, c := range t.C {
			v[k] = idx[keyOf(c.Pos)]
		}
		for a := 0; a < 3; a++ {
			for b := 0; b < 3; b++ {
				if a != b {
					nbr[v[a]][v[b]] = true
				}
			}
		}
	}
	for pass := 0; pass < passes; pass++ {
		next := make([]map[int]float64, len(weights))
		for i, m := range weights {
			out := map[int]float64{}
			for b, w := range m {
				out[b] += 0.5 * w
			}
			if n := len(nbr[i]); n > 0 {
				for j := range nbr[i] {
					for b, w := range weights[j] {
						out[b] += 0.5 * w / float64(n)
					}
				}
			} else {
				for b, w := range m {
					out[b] += 0.5 * w
				}
			}
			next[i] = out
		}
		weights = next
	}
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			c := &s.Tris[i].C[k]
			m := weights[idx[keyOf(c.Pos)]]
			type bw struct {
				b int
				w float64
			}
			var list []bw
			for b, w := range m {
				list = append(list, bw{b, w})
			}
			sort.Slice(list, func(a, b int) bool {
				if list[a].w != list[b].w {
					return list[a].w > list[b].w
				}
				return list[a].b < list[b].b
			})
			var total float64
			for n := 0; n < len(list) && n < 4; n++ {
				total += list[n].w
			}
			var w [4]Weight
			for n := 0; n < len(list) && n < 4 && total > 0; n++ {
				w[n] = Weight{Bone: list[n].b, W: list[n].w / total}
			}
			if total > 0 {
				c.W, c.Bone = w, w[0].Bone
			}
		}
	}
}
