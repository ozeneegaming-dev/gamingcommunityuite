// Package gltf loads glTF 2.0 files (.glb binary and .gltf text with external or embedded buffers): nodes, meshes,
// skins, materials, images and animations, with accessor decoding (normalized integers, strides, sparse accessors).
package gltf

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // decoders for embedded textures
	_ "image/png"
	"math"
	"os"
	"path/filepath"
	"strings"

	"blingmodels/internal/vmath"
)

type Doc struct {
	Asset              struct{ Version string } `json:"asset"`
	Scene              *int                     `json:"scene"`
	Scenes             []Scene                  `json:"scenes"`
	Nodes              []Node                   `json:"nodes"`
	Meshes             []Mesh                   `json:"meshes"`
	Skins              []Skin                   `json:"skins"`
	Materials          []Material               `json:"materials"`
	Textures           []Texture                `json:"textures"`
	Images             []Image                  `json:"images"`
	Accessors          []Accessor               `json:"accessors"`
	BufferViews        []BufferView             `json:"bufferViews"`
	Buffers            []Buffer                 `json:"buffers"`
	Animations         []Animation              `json:"animations"`
	ExtensionsRequired []string                 `json:"extensionsRequired"`

	bin  [][]byte
	dir  string
	imgs map[int]image.Image
}

type Scene struct {
	Name  string `json:"name"`
	Nodes []int  `json:"nodes"`
}

type Node struct {
	Name        string    `json:"name"`
	Children    []int     `json:"children"`
	Mesh        *int      `json:"mesh"`
	Skin        *int      `json:"skin"`
	Matrix      []float64 `json:"matrix"`
	Translation []float64 `json:"translation"`
	Rotation    []float64 `json:"rotation"`
	Scale       []float64 `json:"scale"`
}

type Mesh struct {
	Name       string      `json:"name"`
	Primitives []Primitive `json:"primitives"`
}

type Primitive struct {
	Attributes map[string]int `json:"attributes"`
	Indices    *int           `json:"indices"`
	Material   *int           `json:"material"`
	Mode       *int           `json:"mode"`
}

type Skin struct {
	Name                string `json:"name"`
	InverseBindMatrices *int   `json:"inverseBindMatrices"`
	Joints              []int  `json:"joints"`
	Skeleton            *int   `json:"skeleton"`
}

type TextureInfo struct {
	Index    int `json:"index"`
	TexCoord int `json:"texCoord"`
}

type Material struct {
	Name string `json:"name"`
	PBR  struct {
		BaseColorFactor  []float64    `json:"baseColorFactor"`
		BaseColorTexture *TextureInfo `json:"baseColorTexture"`
	} `json:"pbrMetallicRoughness"`
	EmissiveTexture *TextureInfo `json:"emissiveTexture"`
	AlphaMode       string       `json:"alphaMode"`
	AlphaCutoff     *float64     `json:"alphaCutoff"`
	DoubleSided     bool         `json:"doubleSided"`
	Extensions      struct {
		SpecGloss *struct {
			DiffuseFactor  []float64    `json:"diffuseFactor"`
			DiffuseTexture *TextureInfo `json:"diffuseTexture"`
		} `json:"KHR_materials_pbrSpecularGlossiness"`
	} `json:"extensions"`
}

type Texture struct {
	Source     *int `json:"source"`
	Extensions struct {
		WebP  *struct{ Source int } `json:"EXT_texture_webp"`
		Basis *struct{ Source int } `json:"KHR_texture_basisu"`
	} `json:"extensions"`
}

type Image struct {
	Name       string `json:"name"`
	URI        string `json:"uri"`
	BufferView *int   `json:"bufferView"`
	MimeType   string `json:"mimeType"`
}

type Accessor struct {
	BufferView    *int    `json:"bufferView"`
	ByteOffset    int     `json:"byteOffset"`
	ComponentType int     `json:"componentType"`
	Normalized    bool    `json:"normalized"`
	Count         int     `json:"count"`
	Type          string  `json:"type"`
	Sparse        *Sparse `json:"sparse"`
}

type Sparse struct {
	Count   int `json:"count"`
	Indices struct {
		BufferView    int `json:"bufferView"`
		ByteOffset    int `json:"byteOffset"`
		ComponentType int `json:"componentType"`
	} `json:"indices"`
	Values struct {
		BufferView int `json:"bufferView"`
		ByteOffset int `json:"byteOffset"`
	} `json:"values"`
}

type BufferView struct {
	Buffer     int `json:"buffer"`
	ByteOffset int `json:"byteOffset"`
	ByteLength int `json:"byteLength"`
	ByteStride int `json:"byteStride"`
}

type Buffer struct {
	URI        string `json:"uri"`
	ByteLength int    `json:"byteLength"`
}

type Animation struct {
	Name     string             `json:"name"`
	Channels []AnimationChannel `json:"channels"`
	Samplers []AnimationSampler `json:"samplers"`
}

type AnimationChannel struct {
	Sampler int `json:"sampler"`
	Target  struct {
		Node *int   `json:"node"`
		Path string `json:"path"`
	} `json:"target"`
}

type AnimationSampler struct {
	Input         int    `json:"input"`
	Output        int    `json:"output"`
	Interpolation string `json:"interpolation"`
}

// Load reads a .glb or .gltf file.
func Load(path string) (*Doc, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(data, filepath.Dir(path))
}

// Parse reads glTF bytes; dir resolves external buffers and images of a .gltf.
func Parse(data []byte, dir string) (*Doc, error) {
	var jsonPart []byte
	var glbBin []byte
	if len(data) >= 12 && string(data[:4]) == "glTF" {
		if v := binary.LittleEndian.Uint32(data[4:]); v != 2 {
			return nil, fmt.Errorf("versiune GLB nesuportată: %d (doar glTF 2.0)", v)
		}
		total := int(binary.LittleEndian.Uint32(data[8:]))
		if total > len(data) {
			return nil, fmt.Errorf("fișierul GLB e incomplet (descărcare întreruptă?)")
		}
		for p := 12; p+8 <= total; {
			n := int(binary.LittleEndian.Uint32(data[p:]))
			kind := string(data[p+4 : p+8])
			if p+8+n > total {
				return nil, fmt.Errorf("fișierul GLB e stricat")
			}
			chunk := data[p+8 : p+8+n]
			switch kind {
			case "JSON":
				jsonPart = chunk
			case "BIN\x00":
				if glbBin == nil {
					glbBin = chunk
				}
			}
			p += 8 + (n+3)&^3
		}
		if jsonPart == nil {
			return nil, fmt.Errorf("fișierul GLB nu are partea JSON")
		}
	} else {
		jsonPart = data
	}
	d := &Doc{dir: dir, imgs: map[int]image.Image{}}
	if err := json.Unmarshal(jsonPart, d); err != nil {
		return nil, fmt.Errorf("fișier glTF invalid: %v", err)
	}
	if !strings.HasPrefix(d.Asset.Version, "2") {
		return nil, fmt.Errorf("doar glTF 2.0 e suportat (fișierul e %q)", d.Asset.Version)
	}
	for _, ext := range d.ExtensionsRequired {
		switch ext {
		case "KHR_draco_mesh_compression", "EXT_meshopt_compression":
			return nil, fmt.Errorf("modelul e comprimat cu %s; exportă-l din nou fără compresie (sau deschide-l în Blender și exportă GLB simplu)", ext)
		case "KHR_texture_basisu":
			return nil, fmt.Errorf("texturile sunt în formatul KTX2/Basis; exportă modelul cu texturi PNG sau JPEG")
		}
	}
	for i, b := range d.Buffers {
		switch {
		case b.URI == "":
			if i != 0 || glbBin == nil {
				return nil, fmt.Errorf("buffer-ul %d nu are date", i)
			}
			d.bin = append(d.bin, glbBin)
		case strings.HasPrefix(b.URI, "data:"):
			raw, err := decodeDataURI(b.URI)
			if err != nil {
				return nil, err
			}
			d.bin = append(d.bin, raw)
		default:
			raw, err := os.ReadFile(filepath.Join(dir, uriPath(b.URI)))
			if err != nil {
				return nil, fmt.Errorf("lipsește fișierul %s de lângă .gltf (%v)", b.URI, err)
			}
			d.bin = append(d.bin, raw)
		}
		if len(d.bin[i]) < b.ByteLength {
			return nil, fmt.Errorf("buffer-ul %d e mai scurt decât spune fișierul", i)
		}
	}
	return d, nil
}

func uriPath(uri string) string {
	p := strings.ReplaceAll(uri, "%20", " ")
	return filepath.FromSlash(p)
}

func decodeDataURI(uri string) ([]byte, error) {
	comma := strings.IndexByte(uri, ',')
	if comma < 0 || !strings.Contains(uri[:comma], ";base64") {
		return nil, fmt.Errorf("data URI nesuportat")
	}
	return base64.StdEncoding.DecodeString(uri[comma+1:])
}

func (d *Doc) view(i int) (BufferView, []byte, error) {
	if i < 0 || i >= len(d.BufferViews) {
		return BufferView{}, nil, fmt.Errorf("bufferView %d inexistent", i)
	}
	bv := d.BufferViews[i]
	if bv.Buffer < 0 || bv.Buffer >= len(d.bin) || bv.ByteOffset+bv.ByteLength > len(d.bin[bv.Buffer]) {
		return bv, nil, fmt.Errorf("bufferView %d în afara datelor", i)
	}
	return bv, d.bin[bv.Buffer][bv.ByteOffset : bv.ByteOffset+bv.ByteLength], nil
}

var typeSize = map[string]int{"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}

func compSize(ct int) int {
	switch ct {
	case 5120, 5121:
		return 1
	case 5122, 5123:
		return 2
	case 5125, 5126:
		return 4
	}
	return 0
}

func readComp(b []byte, ct int, normalized bool) float64 {
	switch ct {
	case 5120:
		v := float64(int8(b[0]))
		if normalized {
			return math.Max(v/127, -1)
		}
		return v
	case 5121:
		if normalized {
			return float64(b[0]) / 255
		}
		return float64(b[0])
	case 5122:
		v := float64(int16(binary.LittleEndian.Uint16(b)))
		if normalized {
			return math.Max(v/32767, -1)
		}
		return v
	case 5123:
		v := float64(binary.LittleEndian.Uint16(b))
		if normalized {
			return v / 65535
		}
		return v
	case 5125:
		return float64(binary.LittleEndian.Uint32(b))
	case 5126:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(b)))
	}
	return 0
}

// Floats decodes an accessor to count x components values.
func (d *Doc) Floats(index int) ([][]float64, error) {
	if index < 0 || index >= len(d.Accessors) {
		return nil, fmt.Errorf("accessor %d inexistent", index)
	}
	a := d.Accessors[index]
	nc, cs := typeSize[a.Type], compSize(a.ComponentType)
	if nc == 0 || cs == 0 {
		return nil, fmt.Errorf("accessor %d are un tip nesuportat", index)
	}
	out := make([][]float64, a.Count)
	flat := make([]float64, a.Count*nc)
	for i := range out {
		out[i] = flat[i*nc : (i+1)*nc]
	}
	if a.BufferView != nil {
		bv, data, err := d.view(*a.BufferView)
		if err != nil {
			return nil, err
		}
		stride := bv.ByteStride
		if stride == 0 {
			stride = nc * cs
		}
		for i := 0; i < a.Count; i++ {
			base := a.ByteOffset + i*stride
			if base+nc*cs > len(data) {
				return nil, fmt.Errorf("accessor %d iese din date", index)
			}
			for c := 0; c < nc; c++ {
				out[i][c] = readComp(data[base+c*cs:], a.ComponentType, a.Normalized)
			}
		}
	}
	if a.Sparse != nil && a.Sparse.Count > 0 {
		_, idata, err := d.view(a.Sparse.Indices.BufferView)
		if err != nil {
			return nil, err
		}
		_, vdata, err := d.view(a.Sparse.Values.BufferView)
		if err != nil {
			return nil, err
		}
		ics := compSize(a.Sparse.Indices.ComponentType)
		for k := 0; k < a.Sparse.Count; k++ {
			io := a.Sparse.Indices.ByteOffset + k*ics
			vo := a.Sparse.Values.ByteOffset + k*nc*cs
			if io+ics > len(idata) || vo+nc*cs > len(vdata) {
				return nil, fmt.Errorf("accessor rar %d stricat", index)
			}
			target := int(readComp(idata[io:], a.Sparse.Indices.ComponentType, false))
			if target < 0 || target >= a.Count {
				continue
			}
			for c := 0; c < nc; c++ {
				out[target][c] = readComp(vdata[vo+c*cs:], a.ComponentType, a.Normalized)
			}
		}
	}
	return out, nil
}

// Ints decodes an integer accessor (indices, joints).
func (d *Doc) Ints(index int) ([][]int, error) {
	f, err := d.Floats(index)
	if err != nil {
		return nil, err
	}
	out := make([][]int, len(f))
	for i, row := range f {
		out[i] = make([]int, len(row))
		for c, v := range row {
			out[i][c] = int(v)
		}
	}
	return out, nil
}

// LocalMatrix is a node's transform relative to its parent.
func (n *Node) LocalMatrix() vmath.Mat4 {
	if len(n.Matrix) == 16 {
		var m vmath.Mat4
		copy(m[:], n.Matrix)
		return m
	}
	t, r, s := n.TRS()
	return vmath.TRS(t, r, s)
}

// TRS returns the node's rest translation, rotation and scale (from the matrix when the node uses one).
func (n *Node) TRS() (vmath.Vec3, vmath.Quat, vmath.Vec3) {
	t := vmath.Vec3{}
	r := vmath.QuatIdentity()
	s := vmath.Vec3{1, 1, 1}
	if len(n.Matrix) == 16 {
		var m vmath.Mat4
		copy(m[:], n.Matrix)
		t = m.Translation()
		rot := m.Rot3()
		s = vmath.Vec3{
			vmath.Vec3{rot[0][0], rot[1][0], rot[2][0]}.Len(),
			vmath.Vec3{rot[0][1], rot[1][1], rot[2][1]}.Len(),
			vmath.Vec3{rot[0][2], rot[1][2], rot[2][2]}.Len(),
		}
		r = vmath.Mat3Quat(vmath.Orthonormalize(rot))
		return t, r, s
	}
	if len(n.Translation) == 3 {
		t = vmath.Vec3{n.Translation[0], n.Translation[1], n.Translation[2]}
	}
	if len(n.Rotation) == 4 {
		r = vmath.Quat{n.Rotation[0], n.Rotation[1], n.Rotation[2], n.Rotation[3]}
	}
	if len(n.Scale) == 3 {
		s = vmath.Vec3{n.Scale[0], n.Scale[1], n.Scale[2]}
	}
	return t, r, s
}

// SceneRoots are the root nodes of the default scene (all parentless nodes if the file has no scene).
func (d *Doc) SceneRoots() []int {
	if len(d.Scenes) > 0 {
		s := 0
		if d.Scene != nil && *d.Scene >= 0 && *d.Scene < len(d.Scenes) {
			s = *d.Scene
		}
		return d.Scenes[s].Nodes
	}
	hasParent := make([]bool, len(d.Nodes))
	for _, n := range d.Nodes {
		for _, c := range n.Children {
			if c >= 0 && c < len(hasParent) {
				hasParent[c] = true
			}
		}
	}
	var roots []int
	for i, p := range hasParent {
		if !p {
			roots = append(roots, i)
		}
	}
	return roots
}

// Parents maps each node to its parent (-1 for roots).
func (d *Doc) Parents() []int {
	p := make([]int, len(d.Nodes))
	for i := range p {
		p[i] = -1
	}
	for i, n := range d.Nodes {
		for _, c := range n.Children {
			if c >= 0 && c < len(p) {
				p[c] = i
			}
		}
	}
	return p
}

// Image decodes an image (PNG or JPEG), cached.
func (d *Doc) Image(index int) (image.Image, error) {
	if img, ok := d.imgs[index]; ok {
		return img, nil
	}
	if index < 0 || index >= len(d.Images) {
		return nil, fmt.Errorf("imaginea %d nu există", index)
	}
	im := d.Images[index]
	var raw []byte
	var err error
	switch {
	case im.BufferView != nil:
		_, raw, err = d.view(*im.BufferView)
	case strings.HasPrefix(im.URI, "data:"):
		raw, err = decodeDataURI(im.URI)
	case im.URI != "":
		raw, err = os.ReadFile(filepath.Join(d.dir, uriPath(im.URI)))
	default:
		err = fmt.Errorf("imaginea %d nu are date", index)
	}
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		mime := im.MimeType
		if mime == "" && len(raw) > 12 && string(raw[8:12]) == "WEBP" {
			mime = "image/webp"
		}
		if mime == "image/webp" {
			return nil, fmt.Errorf("textura %q e WebP; exportă modelul cu texturi PNG sau JPEG", im.Name)
		}
		return nil, fmt.Errorf("nu pot citi textura %q: %v", im.Name, err)
	}
	d.imgs[index] = img
	return img, nil
}

// TextureImage resolves a texture index to its decoded image.
func (d *Doc) TextureImage(texIndex int) (image.Image, error) {
	if texIndex < 0 || texIndex >= len(d.Textures) {
		return nil, fmt.Errorf("textura %d nu există", texIndex)
	}
	t := d.Textures[texIndex]
	switch {
	case t.Source != nil:
		return d.Image(*t.Source)
	case t.Extensions.WebP != nil:
		return nil, fmt.Errorf("texturile sunt WebP; exportă modelul cu texturi PNG sau JPEG")
	}
	return nil, fmt.Errorf("textura %d nu are imagine", texIndex)
}
