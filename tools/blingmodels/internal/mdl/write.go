package mdl

import (
	"encoding/binary"
	"fmt"
	"math"
)

type writer struct{ b []byte }

func (w *writer) pos() int            { return len(w.b) }
func (w *writer) u8(v byte)           { w.b = append(w.b, v) }
func (w *writer) u16(v uint16)        { w.b = binary.LittleEndian.AppendUint16(w.b, v) }
func (w *writer) i16(v int16)         { w.u16(uint16(v)) }
func (w *writer) i32(v int32)         { w.b = binary.LittleEndian.AppendUint32(w.b, uint32(v)) }
func (w *writer) f32(v float32)       { w.b = binary.LittleEndian.AppendUint32(w.b, math.Float32bits(v)) }
func (w *writer) vec(v Vec)           { w.f32(v[0]); w.f32(v[1]); w.f32(v[2]) }
func (w *writer) patch(at int, v int) { binary.LittleEndian.PutUint32(w.b[at:], uint32(int32(v))) }
func (w *writer) align() {
	for len(w.b)%4 != 0 {
		w.b = append(w.b, 0)
	}
}

// str writes a fixed-size, zero-padded C string (always zero-terminated).
func (w *writer) str(s string, n int) {
	b := []byte(s)
	if len(b) > n-1 {
		b = b[:n-1]
	}
	w.b = append(w.b, b...)
	for i := len(b); i < n; i++ {
		w.b = append(w.b, 0)
	}
}

// Validate checks the engine limits before writing; the converter splits and trims to stay inside them.
func (m *Model) Validate() error {
	switch {
	case len(m.Bones) == 0:
		return fmt.Errorf("modelul nu are niciun os")
	case len(m.Bones) > MaxBones:
		return fmt.Errorf("prea multe oase: %d (maxim %d)", len(m.Bones), MaxBones)
	case len(m.Sequences) == 0:
		return fmt.Errorf("modelul nu are nicio secvență")
	case len(m.Sequences) > MaxSequences:
		return fmt.Errorf("prea multe secvențe: %d", len(m.Sequences))
	case len(m.Textures) > MaxTextures:
		return fmt.Errorf("prea multe texturi: %d (maxim %d)", len(m.Textures), MaxTextures)
	case len(m.BodyParts) > MaxBodyParts:
		return fmt.Errorf("prea multe părți ale corpului: %d (maxim %d)", len(m.BodyParts), MaxBodyParts)
	case len(m.SkinFamilies) > MaxSkinFams:
		return fmt.Errorf("prea multe familii de skin-uri: %d", len(m.SkinFamilies))
	}
	for i, b := range m.Bones {
		if b.Parent >= int32(i) || b.Parent < -1 {
			return fmt.Errorf("osul %q are un părinte invalid (%d)", b.Name, b.Parent)
		}
	}
	for _, t := range m.Textures {
		if t.Width < 1 || t.Height < 1 || t.Width > MaxTextureSide || t.Height > MaxTextureSide || len(t.Pixels) != t.Width*t.Height {
			return fmt.Errorf("textura %q are dimensiuni invalide (%dx%d)", t.Name, t.Width, t.Height)
		}
	}
	for _, fam := range m.SkinFamilies {
		if len(m.SkinFamilies) > 0 && len(fam) != len(m.SkinFamilies[0]) {
			return fmt.Errorf("familiile de skin-uri au lungimi diferite")
		}
		for _, r := range fam {
			if int(r) < 0 || int(r) >= len(m.Textures) {
				return fmt.Errorf("skin-ul trimite la o textură care nu există (%d)", r)
			}
		}
	}
	for _, bp := range m.BodyParts {
		if len(bp.Models) == 0 || len(bp.Models) > MaxModels {
			return fmt.Errorf("partea %q are %d submodele (1–%d)", bp.Name, len(bp.Models), MaxModels)
		}
		for _, sm := range bp.Models {
			if len(sm.Verts) > MaxVerts || len(sm.Norms) > MaxNorms {
				return fmt.Errorf("submodelul %q are %d vârfuri / %d normale (maxim %d)", sm.Name, len(sm.Verts), len(sm.Norms), MaxVerts)
			}
			if len(sm.VertBones) != len(sm.Verts) || len(sm.NormBones) != len(sm.Norms) {
				return fmt.Errorf("submodelul %q: oasele vârfurilor nu corespund", sm.Name)
			}
			total := 0
			for _, me := range sm.Meshes {
				total += int(me.NumNorms)
				if len(m.SkinFamilies) > 0 && (me.SkinRef < 0 || int(me.SkinRef) >= len(m.SkinFamilies[0])) {
					return fmt.Errorf("submodelul %q folosește un skin inexistent", sm.Name)
				}
				for _, c := range me.TriCmds {
					if len(c.Verts) < 3 {
						return fmt.Errorf("submodelul %q are o bandă de triunghiuri prea scurtă", sm.Name)
					}
					for _, v := range c.Verts {
						if int(v.Vert) >= len(sm.Verts) || int(v.Norm) >= len(sm.Norms) || v.Vert < 0 || v.Norm < 0 {
							return fmt.Errorf("submodelul %q trimite la un vârf inexistent", sm.Name)
						}
					}
				}
			}
			if total != len(sm.Norms) {
				return fmt.Errorf("submodelul %q: normalele plaselor (%d) nu dau totalul (%d)", sm.Name, total, len(sm.Norms))
			}
			for _, vb := range sm.VertBones {
				if int(vb) >= len(m.Bones) {
					return fmt.Errorf("submodelul %q: vârf legat de un os inexistent", sm.Name)
				}
			}
			for _, nb := range sm.NormBones {
				if int(nb) >= len(m.Bones) {
					return fmt.Errorf("submodelul %q: normală legată de un os inexistent", sm.Name)
				}
			}
		}
	}
	for _, s := range m.Sequences {
		if s.NumFrames < 1 {
			return fmt.Errorf("secvența %q nu are cadre", s.Label)
		}
		if len(s.Anims) < 1 {
			return fmt.Errorf("secvența %q nu are animații", s.Label)
		}
		for _, blend := range s.Anims {
			if len(blend) != len(m.Bones) {
				return fmt.Errorf("secvența %q: animația nu are toate oasele", s.Label)
			}
			for _, ch := range blend {
				for _, vals := range ch {
					if vals != nil && len(vals) != int(s.NumFrames) {
						return fmt.Errorf("secvența %q: cadre lipsă într-un canal", s.Label)
					}
				}
			}
		}
		if s.SeqGroup != 0 {
			return fmt.Errorf("secvența %q e într-un grup extern (neacceptat)", s.Label)
		}
	}
	if m.NumNodes > 0 && len(m.Transitions) != m.NumNodes*m.NumNodes {
		return fmt.Errorf("tabelul de tranziții are o mărime greșită")
	}
	return nil
}

// Encode writes the model as an MDL v10 file with the textures embedded (texture data last, like studiomdl).
func (m *Model) Encode() ([]byte, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	w := &writer{b: make([]byte, 0, 1<<20)}
	h := header{}
	w.b = append(w.b, make([]byte, headerSize)...)

	// Bones, controllers, attachments, hitboxes.
	w.align()
	h.boneIndex = w.pos()
	for _, b := range m.Bones {
		w.str(b.Name, 32)
		w.i32(b.Parent)
		w.i32(b.Flags)
		for _, c := range b.Controller {
			w.i32(c)
		}
		for _, v := range b.Value {
			w.f32(v)
		}
		for _, v := range b.Scale {
			w.f32(v)
		}
	}
	h.ctrlIndex = w.pos()
	for _, c := range m.BoneControllers {
		w.i32(c.Bone)
		w.i32(c.Type)
		w.f32(c.Start)
		w.f32(c.End)
		w.i32(c.Rest)
		w.i32(c.Index)
	}
	h.attIndex = w.pos()
	for _, a := range m.Attachments {
		w.str(a.Name, 32)
		w.i32(a.Type)
		w.i32(a.Bone)
		w.vec(a.Org)
		for _, v := range a.Vectors {
			w.vec(v)
		}
	}
	h.hitIndex = w.pos()
	for _, hb := range m.Hitboxes {
		w.i32(hb.Bone)
		w.i32(hb.Group)
		w.vec(hb.BBMin)
		w.vec(hb.BBMax)
	}

	// Sequence descriptions (offsets patched below), their events and pivots.
	w.align()
	h.seqIndex = w.pos()
	type seqPatch struct{ events, pivots, anim int }
	patches := make([]seqPatch, len(m.Sequences))
	for i, s := range m.Sequences {
		w.str(s.Label, 32)
		w.f32(s.FPS)
		w.i32(s.Flags)
		w.i32(s.Activity)
		w.i32(s.ActWeight)
		w.i32(int32(len(s.Events)))
		patches[i].events = w.pos()
		w.i32(0)
		w.i32(s.NumFrames)
		w.i32(int32(len(s.Pivots)))
		patches[i].pivots = w.pos()
		w.i32(0)
		w.i32(s.MotionType)
		w.i32(s.MotionBone)
		w.vec(s.LinearMovement)
		w.i32(s.AutomovePos)
		w.i32(s.AutomoveAngle)
		w.vec(s.BBMin)
		w.vec(s.BBMax)
		w.i32(int32(len(s.Anims)))
		patches[i].anim = w.pos()
		w.i32(0)
		w.i32(s.BlendType[0])
		w.i32(s.BlendType[1])
		w.f32(s.BlendStart[0])
		w.f32(s.BlendStart[1])
		w.f32(s.BlendEnd[0])
		w.f32(s.BlendEnd[1])
		w.i32(s.BlendParent)
		w.i32(s.SeqGroup)
		w.i32(s.EntryNode)
		w.i32(s.ExitNode)
		w.i32(s.NodeFlags)
		w.i32(s.NextSeq)
	}
	for i, s := range m.Sequences {
		if len(s.Events) > 0 {
			w.patch(patches[i].events, w.pos())
			for _, e := range s.Events {
				w.i32(e.Frame)
				w.i32(e.Event)
				w.i32(e.Type)
				w.str(e.Options, 64)
			}
		}
		if len(s.Pivots) > 0 {
			w.patch(patches[i].pivots, w.pos())
			for _, p := range s.Pivots {
				w.vec(p.Org)
				w.i32(p.Start)
				w.i32(p.End)
			}
		}
	}

	// Sequence groups (group 0 = this file).
	w.align()
	groups := m.SeqGroups
	if len(groups) == 0 {
		groups = []SeqGroup{{Label: "default"}}
	}
	h.groupIndex = w.pos()
	for _, g := range groups {
		w.str(g.Label, 32)
		w.str(g.Name, 64)
		w.i32(0)
		w.i32(0)
	}

	// Transition table.
	h.transIndex = w.pos()
	w.b = append(w.b, m.Transitions...)

	// Animations: per sequence, [blend][bone] mstudioanim_t (six u16 offsets), then the value streams.
	for i, s := range m.Sequences {
		w.align()
		start := w.pos()
		w.patch(patches[i].anim, start)
		nb := len(m.Bones)
		w.b = append(w.b, make([]byte, len(s.Anims)*nb*12)...)
		for bl, blend := range s.Anims {
			for bone := 0; bone < nb; bone++ {
				animAt := start + (bl*nb+bone)*12
				for c := 0; c < 6; c++ {
					stream := EncodeAnimValues(blend[bone][c])
					if stream == nil {
						continue
					}
					off := w.pos() - animAt
					if off > 0xffff {
						return nil, fmt.Errorf("secvența %q are prea multe date de animație (%d cadre); scurteaz-o", s.Label, s.NumFrames)
					}
					binary.LittleEndian.PutUint16(w.b[animAt+c*2:], uint16(off))
					for _, word := range stream {
						w.u16(word)
					}
				}
			}
		}
	}

	// Body parts, models, vertices, normals, meshes and triangle commands.
	w.align()
	h.bodyIndex = w.pos()
	bodyModelPatch := make([]int, len(m.BodyParts))
	for i, bp := range m.BodyParts {
		w.str(bp.Name, 64)
		w.i32(int32(len(bp.Models)))
		w.i32(bp.Base)
		bodyModelPatch[i] = w.pos()
		w.i32(0)
	}
	type modelPatch struct{ mesh, vinfo, verts, ninfo, norms int }
	var mpatches [][]modelPatch
	for i, bp := range m.BodyParts {
		w.align()
		w.patch(bodyModelPatch[i], w.pos())
		mp := make([]modelPatch, len(bp.Models))
		for j, sm := range bp.Models {
			w.str(sm.Name, 64)
			w.i32(sm.Type)
			w.f32(sm.BoundingRadius)
			w.i32(int32(len(sm.Meshes)))
			mp[j].mesh = w.pos()
			w.i32(0)
			w.i32(int32(len(sm.Verts)))
			mp[j].vinfo = w.pos()
			w.i32(0)
			mp[j].verts = w.pos()
			w.i32(0)
			w.i32(int32(len(sm.Norms)))
			mp[j].ninfo = w.pos()
			w.i32(0)
			mp[j].norms = w.pos()
			w.i32(0)
			w.i32(0) // numgroups
			w.i32(0) // groupindex
		}
		mpatches = append(mpatches, mp)
	}
	for i, bp := range m.BodyParts {
		for j, sm := range bp.Models {
			p := mpatches[i][j]
			w.patch(p.vinfo, w.pos())
			w.b = append(w.b, sm.VertBones...)
			w.patch(p.ninfo, w.pos())
			w.b = append(w.b, sm.NormBones...)
			w.align()
			w.patch(p.verts, w.pos())
			for _, v := range sm.Verts {
				w.vec(v)
			}
			w.patch(p.norms, w.pos())
			for _, n := range sm.Norms {
				w.vec(n)
			}
			w.align()
			w.patch(p.mesh, w.pos())
			triPatch := make([]int, len(sm.Meshes))
			for k, me := range sm.Meshes {
				w.i32(me.NumTris)
				triPatch[k] = w.pos()
				w.i32(0)
				w.i32(me.SkinRef)
				w.i32(me.NumNorms)
				w.i32(0) // normindex (unused by the engine)
			}
			for k, me := range sm.Meshes {
				w.align()
				w.patch(triPatch[k], w.pos())
				for _, c := range me.TriCmds {
					n := int16(len(c.Verts))
					if c.Fan {
						n = -n
					}
					w.i16(n)
					for _, v := range c.Verts {
						w.i16(v.Vert)
						w.i16(v.Norm)
						w.i16(v.S)
						w.i16(v.T)
					}
				}
				w.i16(0)
			}
		}
	}

	// Textures: headers, skin table, then the pixel data (last in the file).
	w.align()
	h.texIndex = w.pos()
	texPatch := make([]int, len(m.Textures))
	for i, t := range m.Textures {
		w.str(t.Name, 64)
		w.i32(t.Flags)
		w.i32(int32(t.Width))
		w.i32(int32(t.Height))
		texPatch[i] = w.pos()
		w.i32(0)
	}
	w.align()
	h.skinIndex = w.pos()
	for _, fam := range m.SkinFamilies {
		for _, r := range fam {
			w.i16(r)
		}
	}
	w.align()
	h.texDataIndex = w.pos()
	for i, t := range m.Textures {
		w.patch(texPatch[i], w.pos())
		w.b = append(w.b, t.Pixels...)
		w.b = append(w.b, t.Palette[:]...)
	}
	w.align()

	// Header.
	hw := &writer{b: make([]byte, 0, headerSize)}
	hw.b = append(hw.b, 'I', 'D', 'S', 'T')
	hw.i32(10)
	hw.str(m.Name, 64)
	hw.i32(int32(len(w.b)))
	hw.vec(m.EyePosition)
	hw.vec(m.Min)
	hw.vec(m.Max)
	hw.vec(m.BBMin)
	hw.vec(m.BBMax)
	hw.i32(m.Flags)
	pair := func(n, off int) {
		hw.i32(int32(n))
		hw.i32(int32(off))
	}
	pair(len(m.Bones), h.boneIndex)
	pair(len(m.BoneControllers), h.ctrlIndex)
	pair(len(m.Hitboxes), h.hitIndex)
	pair(len(m.Sequences), h.seqIndex)
	pair(len(groups), h.groupIndex)
	pair(len(m.Textures), h.texIndex)
	hw.i32(int32(h.texDataIndex))
	refs := 0
	if len(m.SkinFamilies) > 0 {
		refs = len(m.SkinFamilies[0])
	}
	hw.i32(int32(refs))
	hw.i32(int32(len(m.SkinFamilies)))
	hw.i32(int32(h.skinIndex))
	pair(len(m.BodyParts), h.bodyIndex)
	pair(len(m.Attachments), h.attIndex)
	pair(0, 0) // sound table (unused)
	pair(0, 0) // sound groups (unused)
	pair(m.NumNodes, h.transIndex)
	if len(hw.b) != headerSize {
		return nil, fmt.Errorf("internal: header size %d", len(hw.b))
	}
	copy(w.b, hw.b)
	return w.b, nil
}

const headerSize = 244

type header struct {
	boneIndex, ctrlIndex, attIndex, hitIndex, seqIndex, groupIndex, transIndex int
	bodyIndex, texIndex, skinIndex, texDataIndex                               int
}
