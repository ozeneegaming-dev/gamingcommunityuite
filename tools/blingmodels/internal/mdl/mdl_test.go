package mdl

import (
	"math/rand"
	"reflect"
	"testing"
)

func TestAnimValuesRoundTrip(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	cases := [][]int16{
		{5},
		{0, 0, 0, 7},
		{1, 1, 1, 1, 1, 1},
		{1, 2, 3, 3, 3, 3, 4, 5, 5, 6},
	}
	long := make([]int16, 700)
	for i := range long {
		long[i] = int16(i / 37)
	}
	cases = append(cases, long)
	noisy := make([]int16, 600)
	for i := range noisy {
		noisy[i] = int16(r.Intn(5) - 2)
	}
	cases = append(cases, noisy)
	for _, c := range cases {
		enc := EncodeAnimValues(c)
		dec, ok := DecodeAnimValues(enc, len(c))
		if !ok || !reflect.DeepEqual(dec, c) {
			t.Fatalf("round trip failed for %v:\n got %v", c[:min(20, len(c))], dec[:min(20, len(dec))])
		}
		if AnimStreamLen(enc, len(c)) != len(enc) {
			t.Fatalf("stream length mismatch")
		}
	}
	if EncodeAnimValues([]int16{0, 0, 0}) != nil {
		t.Fatal("all-zero channel must have no stream")
	}
	// Repeated values compress: 300 equal frames = two runs of one value each.
	same := make([]int16, 300)
	for i := range same {
		same[i] = 9
	}
	if got := len(EncodeAnimValues(same)); got != 4 {
		t.Fatalf("constant channel should take 4 words, took %d", got)
	}
}

func sampleModel() *Model {
	tex := Texture{Name: "skin.bmp", Width: 8, Height: 8, Pixels: make([]byte, 64)}
	for i := range tex.Pixels {
		tex.Pixels[i] = byte(i % 3)
	}
	tex.Palette[3] = 255
	anims := [][][6][]int16{{
		{nil, nil, nil, nil, nil, {0, 100, 200}},
		{{0, 10, 20}, nil, nil, nil, nil, nil},
	}}
	return &Model{
		Name:  "test.mdl",
		BBMin: Vec{-1, -1, 0}, BBMax: Vec{1, 1, 2},
		Bones: []Bone{
			{Name: "root", Parent: -1, Controller: [6]int32{-1, -1, -1, -1, -1, -1}, Scale: [6]float32{1, 1, 1, 0.01, 0.01, 0.01}},
			{Name: "child", Parent: 0, Controller: [6]int32{-1, -1, -1, -1, -1, -1}, Value: [6]float32{0, 0, 10, 0, 0, 0}, Scale: [6]float32{0.1, 1, 1, 1, 1, 1}},
		},
		Hitboxes:    []Hitbox{{Bone: 1, BBMin: Vec{-1, -1, -1}, BBMax: Vec{1, 1, 1}}},
		Attachments: []Attachment{{Name: "muzzle", Bone: 1, Org: Vec{1, 2, 3}}},
		Sequences: []Sequence{{
			Label: "idle", FPS: 30, Flags: SeqLooping, Activity: ActIdle, ActWeight: 1, NumFrames: 3,
			Events: []Event{{Frame: 1, Event: 5004, Options: "common/null.wav"}},
			Anims:  anims,
		}},
		Textures:     []Texture{tex},
		SkinFamilies: [][]int16{{0}},
		BodyParts: []BodyPart{{Name: "studio", Base: 1, Models: []SubModel{{
			Name: "body", BoundingRadius: 3,
			Verts: []Vec{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}}, VertBones: []byte{0, 1, 1},
			Norms: []Vec{{0, 0, 1}}, NormBones: []byte{0},
			Meshes: []Mesh{{SkinRef: 0, NumNorms: 1, NumTris: 1, TriCmds: []TriCmd{{Verts: []TriVert{{0, 0, 0, 0}, {1, 0, 8, 0}, {2, 0, 0, 8}}}}}},
		}}}},
	}
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	m := sampleModel()
	data, err := m.Encode()
	if err != nil {
		t.Fatal(err)
	}
	if string(data[:4]) != "IDST" || len(data)%4 != 0 {
		t.Fatal("bad header or alignment")
	}
	back, err := Decode(data, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Defaults filled by the writer.
	m.SeqGroups = []SeqGroup{{Label: "default"}}
	if !reflect.DeepEqual(m, back) {
		t.Fatalf("round trip differs:\nwant %+v\n got %+v", m, back)
	}
	// The texture data is the last thing in the file (studiomdl layout).
	texData := int(int32(uint32(data[188]) | uint32(data[189])<<8 | uint32(data[190])<<16 | uint32(data[191])<<24))
	if texData+64+768 > len(data) || len(data)-(texData+64+768) > 3 {
		t.Fatalf("texture data not at the end: %d of %d", texData, len(data))
	}
}

func TestValidateLimits(t *testing.T) {
	m := sampleModel()
	m.BodyParts[0].Models[0].Meshes[0].NumNorms = 2
	if _, err := m.Encode(); err == nil {
		t.Fatal("normals per mesh must add up")
	}
	m = sampleModel()
	m.Textures[0].Width = 1024
	if _, err := m.Encode(); err == nil {
		t.Fatal("textures over 512 must be refused")
	}
	m = sampleModel()
	m.Bones[1].Parent = 1
	if _, err := m.Encode(); err == nil {
		t.Fatal("a bone cannot be its own parent")
	}
}
