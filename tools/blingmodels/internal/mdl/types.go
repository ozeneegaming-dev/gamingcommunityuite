// Package mdl reads and writes GoldSrc studio models (MDL version 10), the format Half-Life and Counter-Strike 1.6
// load. Layouts follow the Half-Life SDK's studio.h (studiohdr_t and friends); every structure size is checked in the
// tests against the SDK values (header 244, bone 112, sequence 176 bytes…).
package mdl

// Engine and studiomdl limits (Half-Life SDK studio.h).
const (
	MaxBones       = 128
	MaxVerts       = 2048 // per model (submodel)
	MaxNorms       = 2048
	MaxTextures    = 100
	MaxSkinFams    = 100
	MaxBodyParts   = 32
	MaxModels      = 32 // per body part
	MaxSequences   = 2048
	MaxTextureSide = 512 // what the CS 1.6 renderer handles safely
)

// Texture flags (studio.h).
const (
	TexFlatShade  = 0x0001
	TexChrome     = 0x0002
	TexFullBright = 0x0004
	TexNoMips     = 0x0008
	TexAlpha      = 0x0010
	TexAdditive   = 0x0020
	TexMasked     = 0x0040 // palette index 255 is transparent
)

// Sequence flags and common activities.
const (
	SeqLooping = 0x0001
	ActIdle    = 1
)

type Vec [3]float32

type Model struct {
	Name        string
	EyePosition Vec
	Min, Max    Vec // hull (cbox)
	BBMin       Vec // clipping box
	BBMax       Vec
	Flags       int32

	Bones           []Bone
	BoneControllers []BoneController
	Hitboxes        []Hitbox
	Sequences       []Sequence
	SeqGroups       []SeqGroup
	Textures        []Texture
	// SkinFamilies[family][ref] = texture index.
	SkinFamilies [][]int16
	BodyParts    []BodyPart
	Attachments  []Attachment
	// Transitions is a square table (NumNodes x NumNodes), may be empty.
	Transitions []byte
	NumNodes    int
}

type Bone struct {
	Name       string
	Parent     int32
	Flags      int32
	Controller [6]int32 // -1 = none
	Value      [6]float32
	Scale      [6]float32
}

type BoneController struct {
	Bone       int32
	Type       int32
	Start, End float32
	Rest       int32
	Index      int32
}

type Hitbox struct {
	Bone         int32
	Group        int32
	BBMin, BBMax Vec
}

type Event struct {
	Frame   int32
	Event   int32
	Type    int32
	Options string
}

type Pivot struct {
	Org        Vec
	Start, End int32
}

type Sequence struct {
	Label          string
	FPS            float32
	Flags          int32
	Activity       int32
	ActWeight      int32
	Events         []Event
	NumFrames      int32
	Pivots         []Pivot
	MotionType     int32
	MotionBone     int32
	LinearMovement Vec
	AutomovePos    int32
	AutomoveAngle  int32
	BBMin, BBMax   Vec
	BlendType      [2]int32
	BlendStart     [2]float32
	BlendEnd       [2]float32
	BlendParent    int32
	SeqGroup       int32
	EntryNode      int32
	ExitNode       int32
	NodeFlags      int32
	NextSeq        int32
	// Anims[blend][bone][channel] holds one raw value per frame (the engine adds Value + raw*Scale); a nil channel is
	// constant zero (offset 0 in the file).
	Anims [][][6][]int16
}

type SeqGroup struct {
	Label string
	Name  string
}

type Texture struct {
	Name          string
	Flags         int32
	Width, Height int
	Pixels        []byte // Width*Height palette indices
	Palette       [768]byte
}

type BodyPart struct {
	Name   string
	Base   int32
	Models []SubModel
}

type SubModel struct {
	Name           string
	Type           int32
	BoundingRadius float32
	// Verts are in the space of their bone (VertBones); Norms likewise (NormBones).
	Verts     []Vec
	VertBones []byte
	Norms     []Vec
	NormBones []byte
	Meshes    []Mesh
}

// Mesh: triangles of one skin reference. Normals of a model are grouped by mesh in order: mesh i owns NumNorms
// consecutive normals (the engine lights them mesh by mesh).
type Mesh struct {
	SkinRef  int32
	NumNorms int32
	NumTris  int32
	// TriCmds are triangle strips (positive count) and fans (negative count).
	TriCmds []TriCmd
}

type TriCmd struct {
	Fan   bool
	Verts []TriVert
}

type TriVert struct {
	Vert, Norm int16
	S, T       int16
}

type Attachment struct {
	Name    string
	Type    int32
	Bone    int32
	Org     Vec
	Vectors [3]Vec
}
