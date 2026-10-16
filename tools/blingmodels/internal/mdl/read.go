package mdl

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
)

type reader struct {
	b   []byte
	err error
}

func (r *reader) check(off, n int, what string) bool {
	if r.err != nil {
		return false
	}
	if off < 0 || n < 0 || off+n > len(r.b) {
		r.err = fmt.Errorf("fișier .mdl stricat: %s în afara fișierului (offset %d)", what, off)
		return false
	}
	return true
}
func (r *reader) i32(off int) int32 {
	if !r.check(off, 4, "valoare") {
		return 0
	}
	return int32(binary.LittleEndian.Uint32(r.b[off:]))
}
func (r *reader) u16(off int) uint16 {
	if !r.check(off, 2, "valoare") {
		return 0
	}
	return binary.LittleEndian.Uint16(r.b[off:])
}
func (r *reader) f32(off int) float32 { return math.Float32frombits(uint32(r.i32(off))) }
func (r *reader) vec(off int) Vec     { return Vec{r.f32(off), r.f32(off + 4), r.f32(off + 8)} }
func (r *reader) str(off, n int) string {
	if !r.check(off, n, "text") {
		return ""
	}
	s := r.b[off : off+n]
	if i := bytes.IndexByte(s, 0); i >= 0 {
		s = s[:i]
	}
	return string(s)
}

// Decode reads an MDL v10 file. Textures may be in a separate "<name>T.mdl" (numtextures 0): pass it as texFile
// (or nil) to merge them.
func Decode(data []byte, texFile []byte) (*Model, error) {
	r := &reader{b: data}
	if len(data) < headerSize || string(data[:4]) != "IDST" {
		if len(data) >= 4 && string(data[:4]) == "IDSQ" {
			return nil, fmt.Errorf("acesta e un fișier de secvențe (model01.mdl), nu un model")
		}
		return nil, fmt.Errorf("nu e un model GoldSrc (.mdl IDST)")
	}
	if v := r.i32(4); v != 10 {
		return nil, fmt.Errorf("versiune .mdl nesuportată: %d (GoldSrc folosește 10)", v)
	}
	m := &Model{Name: r.str(8, 64)}
	m.EyePosition = r.vec(76)
	m.Min, m.Max = r.vec(88), r.vec(100)
	m.BBMin, m.BBMax = r.vec(112), r.vec(124)
	m.Flags = r.i32(136)
	at := func(i int) (int, int) { return int(r.i32(140 + i*8)), int(r.i32(144 + i*8)) }
	numBones, boneIndex := at(0)
	numCtrl, ctrlIndex := at(1)
	numHit, hitIndex := at(2)
	numSeq, seqIndex := at(3)
	numGroups, groupIndex := at(4)
	numTex, texIndex := at(5)
	texDataIndex := int(r.i32(188))
	numSkinRef := int(r.i32(192))
	numSkinFam := int(r.i32(196))
	skinIndex := int(r.i32(200))
	numBody, bodyIndex := int(r.i32(204)), int(r.i32(208))
	numAtt, attIndex := int(r.i32(212)), int(r.i32(216))
	numTrans, transIndex := int(r.i32(236)), int(r.i32(240))
	_ = texDataIndex
	if numBones < 0 || numBones > MaxBones || numSeq < 0 || numSeq > MaxSequences || numBody < 0 || numBody > MaxBodyParts {
		return nil, fmt.Errorf("fișier .mdl stricat (numere imposibile în antet)")
	}

	for i := 0; i < numBones; i++ {
		o := boneIndex + i*112
		b := Bone{Name: r.str(o, 32), Parent: r.i32(o + 32), Flags: r.i32(o + 36)}
		for c := 0; c < 6; c++ {
			b.Controller[c] = r.i32(o + 40 + c*4)
			b.Value[c] = r.f32(o + 64 + c*4)
			b.Scale[c] = r.f32(o + 88 + c*4)
		}
		m.Bones = append(m.Bones, b)
	}
	for i := 0; i < numCtrl; i++ {
		o := ctrlIndex + i*24
		m.BoneControllers = append(m.BoneControllers, BoneController{Bone: r.i32(o), Type: r.i32(o + 4), Start: r.f32(o + 8), End: r.f32(o + 12), Rest: r.i32(o + 16), Index: r.i32(o + 20)})
	}
	for i := 0; i < numHit; i++ {
		o := hitIndex + i*32
		m.Hitboxes = append(m.Hitboxes, Hitbox{Bone: r.i32(o), Group: r.i32(o + 4), BBMin: r.vec(o + 8), BBMax: r.vec(o + 20)})
	}
	for i := 0; i < numAtt; i++ {
		o := attIndex + i*88
		a := Attachment{Name: r.str(o, 32), Type: r.i32(o + 32), Bone: r.i32(o + 36), Org: r.vec(o + 40)}
		for k := 0; k < 3; k++ {
			a.Vectors[k] = r.vec(o + 52 + k*12)
		}
		m.Attachments = append(m.Attachments, a)
	}
	for i := 0; i < numGroups; i++ {
		o := groupIndex + i*104
		m.SeqGroups = append(m.SeqGroups, SeqGroup{Label: r.str(o, 32), Name: r.str(o+32, 64)})
	}
	if numTrans > 0 && numTrans < 256 && r.check(transIndex, numTrans*numTrans, "tranziții") {
		m.NumNodes = numTrans
		m.Transitions = append([]byte(nil), data[transIndex:transIndex+numTrans*numTrans]...)
	}

	for i := 0; i < numSeq; i++ {
		o := seqIndex + i*176
		s := Sequence{
			Label: r.str(o, 32), FPS: r.f32(o + 32), Flags: r.i32(o + 36), Activity: r.i32(o + 40), ActWeight: r.i32(o + 44),
			NumFrames: r.i32(o + 56), MotionType: r.i32(o + 68), MotionBone: r.i32(o + 72), LinearMovement: r.vec(o + 76),
			AutomovePos: r.i32(o + 88), AutomoveAngle: r.i32(o + 92), BBMin: r.vec(o + 96), BBMax: r.vec(o + 108),
			BlendType:   [2]int32{r.i32(o + 128), r.i32(o + 132)},
			BlendStart:  [2]float32{r.f32(o + 136), r.f32(o + 140)},
			BlendEnd:    [2]float32{r.f32(o + 144), r.f32(o + 148)},
			BlendParent: r.i32(o + 152), SeqGroup: r.i32(o + 156), EntryNode: r.i32(o + 160), ExitNode: r.i32(o + 164),
			NodeFlags: r.i32(o + 168), NextSeq: r.i32(o + 172),
		}
		numEvents, eventIndex := int(r.i32(o+48)), int(r.i32(o+52))
		for e := 0; e < numEvents && e < 1024; e++ {
			eo := eventIndex + e*76
			s.Events = append(s.Events, Event{Frame: r.i32(eo), Event: r.i32(eo + 4), Type: r.i32(eo + 8), Options: r.str(eo+12, 64)})
		}
		numPivots, pivotIndex := int(r.i32(o+60)), int(r.i32(o+64))
		for p := 0; p < numPivots && p < 256; p++ {
			po := pivotIndex + p*20
			s.Pivots = append(s.Pivots, Pivot{Org: r.vec(po), Start: r.i32(po + 12), End: r.i32(po + 16)})
		}
		numBlends, animIndex := int(r.i32(o+120)), int(r.i32(o+124))
		if s.NumFrames < 1 || s.NumFrames > 100000 || numBlends < 1 || numBlends > 16 {
			return nil, fmt.Errorf("secvența %q are date imposibile", s.Label)
		}
		if s.SeqGroup == 0 {
			for bl := 0; bl < numBlends; bl++ {
				blend := make([][6][]int16, numBones)
				for bone := 0; bone < numBones; bone++ {
					ao := animIndex + (bl*numBones+bone)*12
					for c := 0; c < 6; c++ {
						off := int(r.u16(ao + c*2))
						if off == 0 {
							continue
						}
						so := ao + off
						if !r.check(so, 2, "animație") {
							break
						}
						// A stream is at most one header plus one value per frame (and a header per 255-frame run).
						n := (len(data) - so) / 2
						if limit := 2*int(s.NumFrames) + 2; n > limit {
							n = limit
						}
						words := make([]uint16, n)
						for k := range words {
							words[k] = binary.LittleEndian.Uint16(data[so+k*2:])
						}
						vals, ok := DecodeAnimValues(words, int(s.NumFrames))
						if !ok {
							return nil, fmt.Errorf("secvența %q are o animație stricată", s.Label)
						}
						blend[bone][c] = vals
					}
				}
				s.Anims = append(s.Anims, blend)
			}
		}
		m.Sequences = append(m.Sequences, s)
	}

	// Body parts.
	for i := 0; i < numBody; i++ {
		o := bodyIndex + i*76
		bp := BodyPart{Name: r.str(o, 64), Base: r.i32(o + 68)}
		nm, mi := int(r.i32(o+64)), int(r.i32(o+72))
		if nm < 0 || nm > MaxModels {
			return nil, fmt.Errorf("partea %q are un număr imposibil de submodele", bp.Name)
		}
		for j := 0; j < nm; j++ {
			mo := mi + j*112
			sm := SubModel{Name: r.str(mo, 64), Type: r.i32(mo + 64), BoundingRadius: r.f32(mo + 68)}
			numMesh, meshIndex := int(r.i32(mo+72)), int(r.i32(mo+76))
			numVerts, vinfo, vidx := int(r.i32(mo+80)), int(r.i32(mo+84)), int(r.i32(mo+88))
			numNorms, ninfo, nidx := int(r.i32(mo+92)), int(r.i32(mo+96)), int(r.i32(mo+100))
			if numVerts < 0 || numVerts > 65535 || numNorms < 0 || numNorms > 65535 || numMesh < 0 || numMesh > 4096 {
				return nil, fmt.Errorf("submodelul %q are numere imposibile", sm.Name)
			}
			if r.check(vinfo, numVerts, "oasele vârfurilor") {
				sm.VertBones = append([]byte(nil), data[vinfo:vinfo+numVerts]...)
			}
			if r.check(ninfo, numNorms, "oasele normalelor") {
				sm.NormBones = append([]byte(nil), data[ninfo:ninfo+numNorms]...)
			}
			for k := 0; k < numVerts; k++ {
				sm.Verts = append(sm.Verts, r.vec(vidx+k*12))
			}
			for k := 0; k < numNorms; k++ {
				sm.Norms = append(sm.Norms, r.vec(nidx+k*12))
			}
			for k := 0; k < numMesh; k++ {
				meo := meshIndex + k*20
				me := Mesh{NumTris: r.i32(meo), SkinRef: r.i32(meo + 8), NumNorms: r.i32(meo + 12)}
				p := int(r.i32(meo + 4))
				for guard := 0; guard < 1<<20; guard++ {
					n := int(int16(r.u16(p)))
					p += 2
					if n == 0 || r.err != nil {
						break
					}
					cmd := TriCmd{Fan: n < 0}
					if n < 0 {
						n = -n
					}
					for v := 0; v < n; v++ {
						cmd.Verts = append(cmd.Verts, TriVert{Vert: int16(r.u16(p)), Norm: int16(r.u16(p + 2)), S: int16(r.u16(p + 4)), T: int16(r.u16(p + 6))})
						p += 8
					}
					me.TriCmds = append(me.TriCmds, cmd)
				}
				sm.Meshes = append(sm.Meshes, me)
			}
			bp.Models = append(bp.Models, sm)
		}
		m.BodyParts = append(m.BodyParts, bp)
	}

	// Textures (here or in the T file) and the skin table.
	texSrc := r
	if numTex == 0 && texFile != nil {
		tr := &reader{b: texFile}
		if len(texFile) < headerSize || string(texFile[:4]) != "IDST" {
			return nil, fmt.Errorf("fișierul de texturi (T.mdl) nu e valid")
		}
		texSrc = tr
		numTex, texIndex = int(tr.i32(180)), int(tr.i32(184))
		numSkinRef, numSkinFam, skinIndex = int(tr.i32(192)), int(tr.i32(196)), int(tr.i32(200))
	}
	if numTex < 0 || numTex > MaxTextures {
		return nil, fmt.Errorf("număr imposibil de texturi: %d", numTex)
	}
	for i := 0; i < numTex; i++ {
		o := texIndex + i*80
		t := Texture{Name: texSrc.str(o, 64), Flags: texSrc.i32(o + 64), Width: int(texSrc.i32(o + 68)), Height: int(texSrc.i32(o + 72))}
		po := int(texSrc.i32(o + 76))
		if t.Width <= 0 || t.Height <= 0 || t.Width > 4096 || t.Height > 4096 {
			return nil, fmt.Errorf("textura %q are dimensiuni imposibile", t.Name)
		}
		if texSrc.check(po, t.Width*t.Height+768, "textură") {
			t.Pixels = append([]byte(nil), texSrc.b[po:po+t.Width*t.Height]...)
			copy(t.Palette[:], texSrc.b[po+t.Width*t.Height:])
		}
		m.Textures = append(m.Textures, t)
	}
	if numSkinFam > 0 && numSkinRef > 0 && numSkinFam <= MaxSkinFams && numSkinRef <= 1024 {
		for f := 0; f < numSkinFam; f++ {
			fam := make([]int16, numSkinRef)
			for k := range fam {
				fam[k] = int16(texSrc.u16(skinIndex + (f*numSkinRef+k)*2))
			}
			m.SkinFamilies = append(m.SkinFamilies, fam)
		}
	}
	if r.err != nil {
		return nil, r.err
	}
	if texSrc.err != nil {
		return nil, texSrc.err
	}
	return m, nil
}
