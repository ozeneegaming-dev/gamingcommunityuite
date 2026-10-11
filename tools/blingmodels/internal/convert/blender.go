package convert

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// BlenderFormats are opened through Blender (installed separately) and exported to GLB first.
var BlenderFormats = map[string]bool{".blend": true, ".fbx": true, ".obj": true, ".dae": true, ".usdz": true, ".usd": true, ".usdc": true, ".usda": true}

const blenderScript = `
import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
ext = src.lower().rsplit(".", 1)[-1]
if ext == "blend":
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext == "obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=src)
        else:
            bpy.ops.import_scene.obj(filepath=src)
    elif ext == "dae":
        bpy.ops.wm.collada_import(filepath=src)
    else:
        bpy.ops.wm.usd_import(filepath=src)
try:
    bpy.ops.file.unpack_all(method="USE_LOCAL")
except Exception:
    pass
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_apply=True, export_yup=True, export_animations=True)
print("BLINGMODELS_OK")
`

// FindBlender looks for blender(.exe): the given path, BLINGMODELS_BLENDER, PATH, then the usual install folders.
func FindBlender(explicit string) (string, error) {
	try := func(p string) bool {
		if p == "" {
			return false
		}
		st, err := os.Stat(p)
		return err == nil && !st.IsDir()
	}
	if try(explicit) {
		return explicit, nil
	}
	if env := os.Getenv("BLINGMODELS_BLENDER"); try(env) {
		return env, nil
	}
	if p, err := exec.LookPath("blender"); err == nil {
		return p, nil
	}
	if runtime.GOOS == "windows" {
		var found []string
		for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), `C:\Program Files`} {
			if root == "" {
				continue
			}
			m, _ := filepath.Glob(filepath.Join(root, "Blender Foundation", "Blender*", "blender.exe"))
			found = append(found, m...)
		}
		for _, steam := range []string{`C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe`, `C:\Program Files\Steam\steamapps\common\Blender\blender.exe`} {
			if try(steam) {
				found = append(found, steam)
			}
		}
		if len(found) > 0 {
			sort.Strings(found)
			return found[len(found)-1], nil // newest version folder
		}
	}
	return "", fmt.Errorf("pentru acest format trebuie Blender (gratuit, blender.org); instalează-l sau dă calea cu -blender \"C:\\...\\blender.exe\"")
}

// ViaBlender exports a .blend/.fbx/.obj/.dae/.usdz file to a temporary GLB and returns its path.
func ViaBlender(src, blender string) (string, func(), error) {
	exe, err := FindBlender(blender)
	if err != nil {
		return "", nil, err
	}
	dir, err := os.MkdirTemp("", "blingmodels-")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() { os.RemoveAll(dir) }
	dst := filepath.Join(dir, "export.glb")
	abs, _ := filepath.Abs(src)
	cmd := exec.Command(exe, "--background", "--factory-startup", "--python-expr", blenderScript, "--", abs, dst)
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "BLINGMODELS_OK") {
		cleanup()
		tail := string(out)
		if len(tail) > 1500 {
			tail = tail[len(tail)-1500:]
		}
		return "", nil, fmt.Errorf("Blender nu a putut exporta fișierul:\n%s", tail)
	}
	return dst, cleanup, nil
}
