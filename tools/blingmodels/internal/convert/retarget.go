package convert

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"blingmodels/internal/vmath"
)

// boneKey is a skeleton-independent name for a bone: "pelvis", "spine", "L upperarm", "R finger1"…, with an index
// along chains (spine 0..n, finger segments).
type boneKey struct {
	part  string
	side  string // "L", "R" or ""
	index int    // finger number (0 = thumb) for fingers; -1 otherwise
	seg   int    // segment along a finger / order along the spine
}

var (
	reNonAlnum  = regexp.MustCompile(`[^a-z0-9]+`)
	reDigits    = regexp.MustCompile(`\d+$`)
	reAllDigits = regexp.MustCompile(`\d+`)
)

// classifyBone guesses what a bone is from its name (Mixamo, Biped/CS, Blender Rigify/metarig, Unity, Unreal…).
func classifyBone(name string) (boneKey, bool) {
	n := strings.ToLower(name)
	for _, p := range []string{"mixamorig:", "mixamorig_", "mixamorig", "armature|", "valvebiped.", "def-", "def_", "org-", "mch-", "j_bip_", "j_"} {
		n = strings.ReplaceAll(n, p, "")
	}
	n = strings.ReplaceAll(n, "bip001", "bip01")
	n = strings.ReplaceAll(n, "bip01", " ")
	side := ""
	// Side markers: "L Thigh", "LeftUpLeg", "upperarm.l", "thigh_r", "l_hand".
	raw := n
	switch {
	case regexp.MustCompile(`(^|[^a-z])(l|left)([^a-z]|$)`).MatchString(raw), strings.HasPrefix(raw, "left"), regexp.MustCompile(`[._ ]l$`).MatchString(raw):
		side = "L"
	case regexp.MustCompile(`(^|[^a-z])(r|right)([^a-z]|$)`).MatchString(raw), strings.HasPrefix(raw, "right"), regexp.MustCompile(`[._ ]r$`).MatchString(raw):
		side = "R"
	}
	if side == "" {
		if strings.Contains(raw, "left") {
			side = "L"
		} else if strings.Contains(raw, "right") {
			side = "R"
		}
	}
	flat := reNonAlnum.ReplaceAllString(n, "")
	flat = strings.TrimPrefix(strings.TrimPrefix(flat, "left"), "right")
	if regexp.MustCompile(`[._ ][lr]$`).MatchString(raw) {
		flat = flat[:len(flat)-1]
	}
	num := -1
	if m := reDigits.FindString(flat); m != "" {
		num, _ = strconv.Atoi(m)
	}
	has := func(s ...string) bool {
		for _, x := range s {
			if strings.Contains(flat, x) {
				return true
			}
		}
		return false
	}
	k := boneKey{side: side, index: -1, seg: 0}
	fingerIdx := func() int {
		switch {
		case has("thumb"):
			return 0
		case has("index", "pointer"):
			return 1
		case has("middle"):
			return 2
		case has("ring"):
			return 3
		case has("pinky", "little"):
			return 4
		}
		return -1
	}
	switch {
	case has("thumb", "index", "middle", "ring", "pinky", "little", "finger"):
		k.part = "finger"
		digits := reAllDigits.FindAllString(flat, -1)
		last := ""
		if len(digits) > 0 {
			last = digits[len(digits)-1]
		}
		if k.index = fingerIdx(); k.index >= 0 {
			// Mixamo "LeftHandIndex2", Rigify "f_index.02.L": segments counted from 1.
			if v, err := strconv.Atoi(last); err == nil && v >= 1 {
				k.seg = v - 1
			}
		} else if last != "" {
			// Biped/CS "Finger0", "Finger01", "Finger12": finger number, then segment.
			k.index = int(last[0] - '0')
			if len(last) > 1 {
				k.seg = int(last[1] - '0')
			}
		}
		return k, side != ""
	case has("toe", "ball"):
		k.part = "toe"
	case has("foot", "ankle"):
		k.part = "foot"
	case has("calf", "shin", "knee", "lowerleg", "leg") && !has("upleg", "upperleg", "thigh"):
		k.part = "calf"
	case has("thigh", "upleg", "upperleg"):
		k.part = "thigh"
	case has("hand", "wrist", "palm"):
		k.part = "hand"
	case has("forearm", "lowerarm", "elbow"):
		k.part = "forearm"
	case has("upperarm", "arm") && side != "":
		k.part = "upperarm"
	case has("clavicle", "shoulder", "collar"):
		k.part = "clavicle"
	case has("head") && !has("headtop", "headend", "head_end", "end"):
		k.part, k.side = "head", ""
	case has("neck"):
		k.part, k.side = "neck", ""
	case has("spine", "chest", "torso", "abdomen", "belly"):
		k.part, k.side = "spine", ""
		if num >= 0 {
			k.seg = num
		}
		if has("upperchest") {
			k.seg = 9
		} else if has("chest") && num < 0 {
			k.seg = 8
		}
	case has("pelvis", "hips", "hip") && side == "":
		k.part = "pelvis"
	default:
		return k, false
	}
	if (k.part == "upperarm" || k.part == "forearm" || k.part == "hand" || k.part == "clavicle" || k.part == "thigh" || k.part == "calf" || k.part == "foot" || k.part == "toe") && side == "" {
		return k, false
	}
	return k, true
}

// MapBones matches source bones to donor bones by name (see mapKeys).
func MapBones(src, dst []string, srcParent, dstParent []int) map[int]int {
	return mapKeys(classifyAll(src), classifyAll(dst), srcParent, dstParent)
}

func classifyAll(names []string) map[int]boneKey {
	out := map[int]boneKey{}
	for i, n := range names {
		if k, ok := classifyBone(n); ok {
			out[i] = k
		}
	}
	return out
}

// mapKeys matches classified source bones to classified donor bones. Spines are matched by order; fingers by finger
// and segment (falling back to the hand when the donor has fewer fingers). Returns source index → donor index.
func mapKeys(sk, dk map[int]boneKey, srcParent, dstParent []int) map[int]int {
	type item struct {
		i     int
		k     boneKey
		depth int
	}
	depthOf := func(parents []int, i int) int {
		d := 0
		for p := parents[i]; p >= 0 && d < 256; p = parents[p] {
			d++
		}
		return d
	}
	collect := func(keys map[int]boneKey, parents []int) []item {
		var out []item
		for i, k := range keys {
			out = append(out, item{i, k, depthOf(parents, i)})
		}
		sort.Slice(out, func(a, b int) bool { return out[a].i < out[b].i })
		return out
	}
	si, di := collect(sk, srcParent), collect(dk, dstParent)
	byKey := func(items []item, part, side string) []item {
		var out []item
		for _, it := range items {
			if it.k.part == part && it.k.side == side {
				out = append(out, it)
			}
		}
		sort.SliceStable(out, func(a, b int) bool { return out[a].depth < out[b].depth })
		return out
	}
	m := map[int]int{}
	// One-to-one parts: the shallowest of each kind.
	for _, part := range []string{"pelvis", "neck", "head", "clavicle", "upperarm", "forearm", "hand", "thigh", "calf", "foot", "toe"} {
		for _, side := range []string{"", "L", "R"} {
			s, d := byKey(si, part, side), byKey(di, part, side)
			if len(s) == 0 || len(d) == 0 {
				continue
			}
			for k, it := range s {
				m[it.i] = d[min(k, len(d)-1)].i
			}
		}
	}
	// Spine: spread the source chain over the donor chain.
	ss, ds := byKey(si, "spine", ""), byKey(di, "spine", "")
	for k, it := range ss {
		if len(ds) > 0 {
			m[it.i] = ds[k*len(ds)/len(ss)].i
		}
	}
	// Fingers.
	for _, side := range []string{"L", "R"} {
		var dhand = -1
		if h := byKey(di, "hand", side); len(h) > 0 {
			dhand = h[0].i
		}
		df := byKey(di, "finger", side)
		for _, it := range byKey(si, "finger", side) {
			best, bestScore := -1, 1<<30
			for _, d := range df {
				score := 100*absInt(d.k.index-it.k.index) + absInt(d.k.seg-it.k.seg)
				if d.k.index < 0 || it.k.index < 0 {
					score = 1000 + absInt(d.k.seg-it.k.seg)
				}
				if score < bestScore {
					best, bestScore = d.i, score
				}
			}
			switch {
			case best >= 0 && bestScore < 300:
				m[it.i] = best
			case dhand >= 0:
				m[it.i] = dhand
			}
		}
	}
	return m
}

// geoClassify recognizes a humanoid skeleton from where its bones are, whatever their names: the pelvis is where two
// chains go down (legs) and one goes up (spine); the spine ends where the neck/head chain and the arm chains branch;
// along each chain the bones are, in order, thigh/calf/foot/toe and clavicle/upperarm/forearm/hand. The model must
// stand upright facing +X (left side = +Y), as the scene is after loading.
func (s *Scene) geoClassify() map[int]boneKey {
	n := len(s.Bones)
	if n < 8 {
		return nil
	}
	children := make([][]int, n)
	for i, b := range s.Bones {
		if b.Parent >= 0 {
			children[b.Parent] = append(children[b.Parent], i)
		}
	}
	pos := func(i int) vmath.Vec3 { return s.Bones[i].Rest.T }
	// Subtree extents.
	minZ, maxZ, maxAbsY := make([]float64, n), make([]float64, n), make([]float64, n)
	var ext func(i int)
	ext = func(i int) {
		p := pos(i)
		minZ[i], maxZ[i], maxAbsY[i] = p[2], p[2], math.Abs(p[1])
		for _, c := range children[i] {
			ext(c)
			minZ[i] = math.Min(minZ[i], minZ[c])
			maxZ[i] = math.Max(maxZ[i], maxZ[c])
			maxAbsY[i] = math.Max(maxAbsY[i], maxAbsY[c])
		}
	}
	for i, b := range s.Bones {
		if b.Parent < 0 {
			ext(i)
		}
	}
	mn, mx := s.Bounds()
	h := mx[2] - mn[2]
	if h <= 0 {
		return nil
	}
	cy := (mn[1] + mx[1]) / 2
	// Pelvis: two children reaching far down, one reaching far up.
	pelvis := -1
	var legs []int
	spineStart := -1
	for i := 1; i < n; i++ {
		var down []int
		up := -1
		for _, c := range children[i] {
			switch {
			case minZ[c] < pos(i)[2]-0.25*h:
				down = append(down, c)
			case maxZ[c] > pos(i)[2]+0.2*h && (up < 0 || maxZ[c] > maxZ[up]):
				up = c
			}
		}
		if len(down) >= 2 && up >= 0 && (pelvis < 0 || s.depth(i) < s.depth(pelvis)) {
			pelvis, legs, spineStart = i, down, up
		}
	}
	if pelvis < 0 {
		return nil
	}
	keys := map[int]boneKey{pelvis: {part: "pelvis", index: -1}}
	side := func(i int) string {
		if pos(i)[1]+0.0 > cy {
			return "L"
		}
		return "R"
	}
	// follow walks a chain from b, at each step choosing the child that best continues it.
	follow := func(b int, better func(a, c int) bool) []int {
		chain := []int{b}
		for len(children[b]) > 0 {
			best := children[b][0]
			for _, c := range children[b][1:] {
				if better(c, best) {
					best = c
				}
			}
			b = best
			chain = append(chain, b)
		}
		return chain
	}
	// significant drops bones that sit (almost) on top of the previous one (twist/helper bones).
	significant := func(chain []int) []int {
		var out []int
		for _, b := range chain {
			if len(out) > 0 && pos(b).Sub(pos(out[len(out)-1])).Len() < 0.02*h {
				continue
			}
			out = append(out, b)
		}
		return out
	}
	// Legs: lowest-reaching child each step.
	for _, l := range legs[:2] {
		chain := significant(follow(l, func(a, c int) bool { return minZ[a] < minZ[c] }))
		sd := side(chain[len(chain)-1])
		parts := []string{"thigh", "calf", "foot", "toe"}
		for k, b := range chain {
			keys[b] = boneKey{part: parts[min(k, 3)], side: sd, index: -1}
		}
	}
	// Spine up to the branching bone, then neck/head.
	upChain := follow(spineStart, func(a, c int) bool { return maxZ[a] > maxZ[c] })
	chest := -1
	for _, b := range upChain {
		armish := 0
		for _, c := range children[b] {
			if maxAbsY[c]-math.Abs(pos(b)[1]) > 0.15*h && maxZ[c] < maxZ[b] {
				armish++
			}
		}
		if armish >= 2 {
			chest = b
			break
		}
	}
	if chest < 0 {
		return nil
	}
	seg := 0
	afterChest := false
	var neckHead []int
	for _, b := range upChain {
		if afterChest {
			neckHead = append(neckHead, b)
			continue
		}
		keys[b] = boneKey{part: "spine", index: -1, seg: seg}
		seg++
		if b == chest {
			afterChest = true
		}
	}
	neckHead = significant(neckHead)
	if len(neckHead) >= 3 && len(children[neckHead[len(neckHead)-1]]) == 0 {
		neckHead = neckHead[:len(neckHead)-1] // a head-top end bone
	}
	for k, b := range neckHead {
		if k == len(neckHead)-1 {
			keys[b] = boneKey{part: "head", index: -1}
		} else {
			keys[b] = boneKey{part: "neck", index: -1}
		}
	}
	// Arms: the sideways children of the chest (or of any spine bone).
	for _, b := range upChain {
		for _, c := range children[b] {
			if maxAbsY[c]-math.Abs(pos(b)[1]) <= 0.15*h || maxZ[c] >= maxZ[b] && c != spineStart {
				continue
			}
			if _, done := keys[c]; done {
				continue
			}
			chain := significant(follow(c, func(a, d int) bool { return maxAbsY[a] > maxAbsY[d] }))
			// The hand is where the chain branches into fingers (or its last bone).
			handAt := len(chain) - 1
			for k, x := range chain {
				if k >= 2 && len(children[x]) >= 3 {
					handAt = k
					break
				}
			}
			if handAt > 4 {
				handAt = 4
			}
			sd := side(chain[handAt])
			names := []string{"hand", "forearm", "upperarm", "clavicle"}
			for k := handAt; k >= 0 && handAt-k < 4; k-- {
				keys[chain[k]] = boneKey{part: names[handAt-k], side: sd, index: -1}
			}
			// Everything past the hand (fingers) follows the hand.
			var fingers func(x int)
			fingers = func(x int) {
				for _, f := range children[x] {
					if _, ok := keys[f]; !ok {
						keys[f] = boneKey{part: "finger", side: sd, index: -1}
					}
					fingers(f)
				}
			}
			fingers(chain[handAt])
		}
	}
	return keys
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// coreMappedKeys is CoreMapped for bones classified by geoClassify.
func coreMappedKeys(m map[int]int, keys map[int]boneKey) bool {
	if keys == nil {
		return false
	}
	need := map[string]bool{"pelvis": false, "head": false, "L upperarm": false, "R upperarm": false, "L forearm": false, "R forearm": false, "L thigh": false, "R thigh": false, "L calf": false, "R calf": false}
	for b := range m {
		k, ok := keys[b]
		if !ok {
			continue
		}
		key := k.part
		if k.side != "" {
			key = k.side + " " + k.part
		}
		if _, want := need[key]; want {
			need[key] = true
		}
	}
	for _, ok := range need {
		if !ok {
			return false
		}
	}
	return true
}

// CoreMapped reports whether a mapping covers the bones a CS player animation needs.
func CoreMapped(m map[int]int, src []string) bool {
	need := map[string]bool{"pelvis": false, "head": false, "L upperarm": false, "R upperarm": false, "L forearm": false, "R forearm": false, "L thigh": false, "R thigh": false, "L calf": false, "R calf": false}
	for s := range m {
		if k, ok := classifyBone(src[s]); ok {
			key := k.part
			if k.side != "" {
				key = k.side + " " + k.part
			}
			if _, want := need[key]; want {
				need[key] = true
			}
		}
	}
	for _, ok := range need {
		if !ok {
			return false
		}
	}
	return true
}

// retargetPlayer poses a rigged body into the donor's reference pose and binds it to the donor bones: every source
// bone follows its mapped donor bone (unmapped bones follow their nearest mapped ancestor); each part is turned so
// its bone points where the donor's bone points and stretched along it to the donor's bone length.
func (s *Scene) retargetPlayer(donorWorld []vmath.Bone, donorParent []int, mapping map[int]int) {
	n := len(s.Bones)
	// Donor bone for every source bone (inherited from the nearest mapped ancestor).
	target := make([]int, n)
	owner := make([]int, n) // the mapped source bone whose deformation applies
	for i := range s.Bones {
		target[i], owner[i] = -1, -1
		for b := i; b >= 0; b = s.Bones[b].Parent {
			if d, ok := mapping[b]; ok {
				target[i], owner[i] = d, b
				break
			}
		}
	}
	// Children in the source among mapped bones: the next mapped bone down each chain.
	childOf := func(b int) []int {
		var out []int
		var walk func(p int)
		walk = func(p int) {
			for c := range s.Bones {
				if s.Bones[c].Parent != p {
					continue
				}
				if _, ok := mapping[c]; ok {
					out = append(out, c)
				} else {
					walk(c)
				}
			}
		}
		walk(b)
		return out
	}
	type deform struct {
		srcHead, dstHead vmath.Vec3
		r                vmath.Mat3
		axis             vmath.Vec3 // source bone direction (unit), for stretching
		k                float64    // length ratio
	}
	defs := map[int]deform{}
	var order []int
	for b := range mapping {
		order = append(order, b)
	}
	// Parents first, so a bone without children can reuse its parent's turn.
	sort.Slice(order, func(a, c int) bool { return s.depth(order[a]) < s.depth(order[c]) })
	for _, b := range order {
		d := mapping[b]
		df := deform{srcHead: s.Bones[b].Rest.T, dstHead: donorWorld[d].T, r: identity3(), k: 1}
		// Pick the child chain that continues along the donor's chain (e.g. upperarm → forearm, not → twist).
		var srcDir, dstDir vmath.Vec3
		bestLen := -1.0
		for _, c := range childOf(b) {
			dc := mapping[c]
			if dc == d {
				continue
			}
			sd := s.Bones[c].Rest.T.Sub(df.srcHead)
			dd := donorWorld[dc].T.Sub(df.dstHead)
			if sd.Len() < 1e-6 || dd.Len() < 1e-6 {
				continue
			}
			// Prefer the child whose donor counterpart descends from d (same chain).
			onChain := false
			for p := dc; p >= 0; p = donorParent[p] {
				if p == d {
					onChain = true
					break
				}
			}
			score := sd.Len()
			if onChain {
				score += 1e6
			}
			if score > bestLen {
				bestLen, srcDir, dstDir = score, sd, dd
			}
		}
		if bestLen >= 0 {
			df.r = rotationBetween(srcDir.Norm(), dstDir.Norm())
			df.axis = srcDir.Norm()
			df.k = math.Max(0.6, math.Min(1.6, dstDir.Len()/srcDir.Len()))
		} else if p := s.Bones[b].Parent; p >= 0 && owner[p] >= 0 {
			if pd, ok := defs[owner[p]]; ok {
				df.r = pd.r // end bones (hands, head, feet ends) keep the parent's turn
			}
		}
		defs[b] = df
	}
	apply := func(c *Corner) {
		b := c.Bone
		if b < 0 || b >= n || owner[b] < 0 {
			return
		}
		df := defs[owner[b]]
		v := c.Pos.Sub(df.srcHead)
		if df.axis != (vmath.Vec3{}) {
			along := df.axis.Scale(v.Dot(df.axis))
			v = v.Sub(along).Add(along.Scale(df.k))
		}
		c.Pos = df.dstHead.Add(df.r.MulVec(v))
		c.Normal = df.r.MulVec(c.Normal)
		c.Bone = target[b]
	}
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			if s.Tris[i].C[k].Bone < 0 || s.Tris[i].C[k].Bone >= n || owner[s.Tris[i].C[k].Bone] < 0 {
				s.Tris[i].C[k].Bone = -1 // fixed below by the nearest-vertex binding
				continue
			}
			apply(&s.Tris[i].C[k])
		}
	}
}

func (s *Scene) depth(i int) int {
	d := 0
	for p := s.Bones[i].Parent; p >= 0 && d < 256; p = s.Bones[p].Parent {
		d++
	}
	return d
}

// rotationBetween returns the smallest rotation turning unit vector a onto unit vector b.
func rotationBetween(a, b vmath.Vec3) vmath.Mat3 {
	v := a.Cross(b)
	c := a.Dot(b)
	if c < -0.9999 {
		// Opposite: turn 180° about any axis perpendicular to a.
		axis := a.Cross(vmath.Vec3{1, 0, 0})
		if axis.Len() < 1e-3 {
			axis = a.Cross(vmath.Vec3{0, 1, 0})
		}
		axis = axis.Norm()
		return vmath.Mat3{
			{2*axis[0]*axis[0] - 1, 2 * axis[0] * axis[1], 2 * axis[0] * axis[2]},
			{2 * axis[1] * axis[0], 2*axis[1]*axis[1] - 1, 2 * axis[1] * axis[2]},
			{2 * axis[2] * axis[0], 2 * axis[2] * axis[1], 2*axis[2]*axis[2] - 1},
		}
	}
	k := 1 / (1 + c)
	return vmath.Mat3{
		{v[0]*v[0]*k + c, v[0]*v[1]*k - v[2], v[0]*v[2]*k + v[1]},
		{v[1]*v[0]*k + v[2], v[1]*v[1]*k + c, v[1]*v[2]*k - v[0]},
		{v[2]*v[0]*k - v[1], v[2]*v[1]*k + v[0], v[2]*v[2]*k + c},
	}
}
