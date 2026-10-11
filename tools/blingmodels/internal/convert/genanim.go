package convert

import (
	"math"

	"blingmodels/internal/vmath"
)

// GenAnimKinds are the animations blingmodels can make for a model that has none.
var GenAnimKinds = map[string]string{
	"spin":    "rotire continuă (obiecte de ridicat, trofee)",
	"bob":     "plutire sus-jos",
	"spinbob": "rotire + plutire",
	"sway":    "legănare (steaguri, plante, lampă)",
	"pulse":   "respirație/puls (se ridică ușor)",
}

// GenerateAnim adds a looping animation to a static model: a new bone carries the whole model and moves.
func (s *Scene) GenerateAnim(kind string) bool {
	if _, ok := GenAnimKinds[kind]; !ok || len(s.Clips) > 0 {
		return false
	}
	mn, mx := s.Bounds()
	size := mx.Sub(mn)
	h := math.Max(size[2], 1)
	pivot := vmath.Vec3{(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]}
	// New bone "anim" under the root; everything that hung on the root now hangs on it.
	animBone := len(s.Bones)
	s.Bones = append(s.Bones, SBone{Name: "anim", Parent: 0, Rest: vmath.Bone{R: identity3(), T: pivot}})
	for i := 1; i < animBone; i++ {
		if s.Bones[i].Parent == 0 {
			s.Bones[i].Parent = animBone
		}
	}
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			if s.Tris[i].C[k].Bone == 0 {
				s.Tris[i].C[k].Bone = animBone
			}
		}
	}
	// Bones must stay ordered parents-first: move the new bone right after the root.
	s.moveBone(animBone, 1)
	animBone = 1
	const fps, frames = 30.0, 61 // a 2 s loop
	clip := Clip{Name: kind, FPS: fps}
	for f := 0; f < frames; f++ {
		t := float64(f) / float64(frames-1) // 0..1
		var ang vmath.Vec3
		off := vmath.Vec3{}
		switch kind {
		case "spin":
			ang[2] = 2 * math.Pi * t
		case "bob":
			off[2] = math.Sin(2*math.Pi*t) * h * 0.06
		case "spinbob":
			ang[2] = 2 * math.Pi * t
			off[2] = math.Sin(2*math.Pi*t) * h * 0.06
		case "sway":
			ang[0] = math.Sin(2*math.Pi*t) * 0.08
		case "pulse":
			off[2] = (0.5 - 0.5*math.Cos(2*math.Pi*t)) * h * 0.03
		}
		move := vmath.Bone{R: vmath.QuatMat3(vmath.AngleQuaternion(ang)), T: pivot.Add(off)}
		fr := make([]vmath.Bone, len(s.Bones))
		fr[0] = vmath.BoneIdentity()
		fr[animBone] = move
		// Other bones keep their place relative to the moving bone.
		inv := s.Bones[animBone].Rest.Inverse()
		for b := 2; b < len(s.Bones); b++ {
			fr[b] = move.Mul(inv.Mul(s.Bones[b].Rest))
		}
		clip.Frames = append(clip.Frames, fr)
	}
	s.Clips = []Clip{clip}
	return true
}

// moveBone moves bone from to index to (to < from), fixing parent and corner references.
func (s *Scene) moveBone(from, to int) {
	if from == to {
		return
	}
	perm := make([]int, len(s.Bones)) // old index → new index
	for i := range perm {
		switch {
		case i == from:
			perm[i] = to
		case i >= to && i < from:
			perm[i] = i + 1
		default:
			perm[i] = i
		}
	}
	nb := make([]SBone, len(s.Bones))
	for i, b := range s.Bones {
		if b.Parent >= 0 {
			b.Parent = perm[b.Parent]
		}
		nb[perm[i]] = b
	}
	s.Bones = nb
	for i := range s.Tris {
		for k := range s.Tris[i].C {
			s.Tris[i].C[k].Bone = perm[s.Tris[i].C[k].Bone]
		}
	}
}
