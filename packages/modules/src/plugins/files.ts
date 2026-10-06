import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeArchivePath, readPluginZip } from "@gcs/core";

const COMPLETE = ".gcs-complete";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dezarhivează arhiva unui plugin în `<dataDir>/<cheie>/<sha256 scurt>/` (o singură dată; versiunea e în nume).
 * Arhiva e verificată după `sha256` și citită cu aceleași reguli ca la instalare. Scrierea se face într-un folder
 * temporar, mutat la final, ca un alt proces să nu vadă niciodată un folder pe jumătate scris.
 * Păstrează și versiunea anterioară (un alt proces o poate folosi încă), restul se șterg.
 */
export async function extractPlugin(dataDir: string, key: string, sha256: string, pkg: Buffer): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("invalid_sha");
  const base = path.resolve(dataDir, key);
  const dir = path.join(base, sha256.slice(0, 16));
  if (await exists(path.join(dir, COMPLETE))) return dir;
  if (createHash("sha256").update(pkg).digest("hex") !== sha256) throw new Error("package_sha_mismatch");

  const files = readPluginZip(pkg);
  const tmp = `${dir}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await mkdir(tmp, { recursive: true });
  try {
    for (const [name, data] of files) {
      if (!isSafeArchivePath(name)) throw new Error(`unsafe_path ${name}`);
      const target = path.resolve(tmp, ...name.split("/"));
      if (!target.startsWith(tmp + path.sep)) throw new Error(`unsafe_path ${name}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data, { mode: 0o644 });
    }
    await writeFile(path.join(tmp, COMPLETE), sha256);
    try {
      await rename(tmp, dir);
    } catch (error) {
      // Alt proces a terminat primul: folosim folderul lui.
      if (!(await exists(path.join(dir, COMPLETE)))) throw error;
      await rm(tmp, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await pruneVersions(base, path.basename(dir));
  return dir;
}

/** Păstrează versiunea curentă și cea mai recentă dintre celelalte. */
async function pruneVersions(base: string, current: string): Promise<void> {
  try {
    const entries = await readdir(base, { withFileTypes: true });
    const others = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && e.name !== current)
        .map(async (e) => ({ name: e.name, mtime: (await stat(path.join(base, e.name))).mtimeMs })),
    );
    others.sort((a, b) => b.mtime - a.mtime);
    for (const old of others.slice(1)) await rm(path.join(base, old.name), { recursive: true, force: true });
  } catch {
    // Curățarea e opțională.
  }
}

/** Șterge toate fișierele dezarhivate ale unui plugin (dezinstalare). */
export async function removePluginFiles(dataDir: string, key: string): Promise<void> {
  await rm(path.resolve(dataDir, key), { recursive: true, force: true }).catch(() => {});
}
