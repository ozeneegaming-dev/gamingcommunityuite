/**
 * Tipul real al unui fișier din Descărcări, după primii octeți (nu după nume), și regula extensiilor: extensia trebuie
 * să fie permisă de categorie și să se potrivească cu conținutul. Un executabil deghizat (`harta.bsp` care e de fapt un
 * `.exe`) e respins chiar dacă extensia e permisă; fișierele de joc fără semnătură cunoscută trec după extensie.
 */

/** Familiile recunoscute după conținut. `text` = UTF-8 valid, fără octeți nuli; `binary` = nerecunoscut. */
export type GcsFileKind =
  | "zip"
  | "rar"
  | "7z"
  | "gzip"
  | "bzip2"
  | "xz"
  | "tar"
  | "exe"
  | "elf"
  | "macho"
  | "ole"
  | "pdf"
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "bmp"
  | "mp4"
  | "mp3"
  | "ogg"
  | "wav"
  | "flac"
  | "bsp"
  | "vpk"
  | "demo"
  | "wad"
  | "text"
  | "binary";

/** Câți octeți de la început trebuie citiți pentru detecție (antetul tar e la 257). */
export const SNIFF_BYTES = 4096;

const MIME: Partial<Record<GcsFileKind, string>> = {
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  gzip: "application/gzip",
  bzip2: "application/x-bzip2",
  xz: "application/x-xz",
  tar: "application/x-tar",
  exe: "application/vnd.microsoft.portable-executable",
  elf: "application/x-executable",
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  text: "text/plain",
};

/** Tipul MIME trimis la descărcare (fișierele se descarcă mereu ca atașament). */
export const mimeOf = (kind: GcsFileKind) => MIME[kind] ?? "application/octet-stream";

const starts = (b: Buffer, bytes: number[], offset = 0) => b.length >= offset + bytes.length && bytes.every((x, i) => b[offset + i] === x);
const ascii = (b: Buffer, s: string, offset = 0) => b.length >= offset + s.length && b.toString("latin1", offset, offset + s.length) === s;

/** Tipul real după primii octeți (`head` = primii `SNIFF_BYTES`, sau tot fișierul dacă e mai mic). */
export function sniffKind(head: Buffer): GcsFileKind {
  if (starts(head, [0x50, 0x4b, 0x03, 0x04]) || starts(head, [0x50, 0x4b, 0x05, 0x06]) || starts(head, [0x50, 0x4b, 0x07, 0x08])) return "zip";
  if (ascii(head, "Rar!\x1a\x07")) return "rar";
  if (starts(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (starts(head, [0x1f, 0x8b])) return "gzip";
  if (ascii(head, "BZh")) return "bzip2";
  if (starts(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "xz";
  if (ascii(head, "ustar", 257)) return "tar";
  if (ascii(head, "MZ")) return "exe";
  if (starts(head, [0x7f, 0x45, 0x4c, 0x46])) return "elf";
  if (starts(head, [0xcf, 0xfa, 0xed, 0xfe]) || starts(head, [0xce, 0xfa, 0xed, 0xfe]) || starts(head, [0xca, 0xfe, 0xba, 0xbe])) return "macho";
  if (starts(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (ascii(head, "%PDF-")) return "pdf";
  if (starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(head, "GIF87a") || ascii(head, "GIF89a")) return "gif";
  if (ascii(head, "RIFF") && ascii(head, "WEBP", 8)) return "webp";
  if (ascii(head, "RIFF") && ascii(head, "WAVE", 8)) return "wav";
  if (ascii(head, "BM") && head.length > 14 && head.readUInt32LE(2) > 14) return "bmp";
  if (ascii(head, "ftyp", 4)) return "mp4";
  if (ascii(head, "ID3") || (head.length > 1 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && looksLikeMpegFrame(head))) return "mp3";
  if (ascii(head, "OggS")) return "ogg";
  if (ascii(head, "fLaC")) return "flac";
  // Hărțile Source (`VBSP`), Quake / GoldSrc (versiunea 29 / 30, ca întreg pe 4 octeți) și pachetele / demo-urile Valve.
  if (ascii(head, "VBSP") || ascii(head, "IBSP") || ascii(head, "rBSP") || starts(head, [0x1e, 0, 0, 0]) || starts(head, [0x1d, 0, 0, 0])) return "bsp";
  if (starts(head, [0x34, 0x12, 0xaa, 0x55])) return "vpk";
  if (ascii(head, "HL2DEMO\0") || ascii(head, "PBDEMS2\0") || ascii(head, "HLDEMO\0")) return "demo";
  if (ascii(head, "WAD2") || ascii(head, "WAD3") || ascii(head, "IWAD") || ascii(head, "PWAD")) return "wad";
  return isText(head) ? "text" : "binary";
}

function looksLikeMpegFrame(b: Buffer): boolean {
  // Antetul unui cadru MPEG audio: versiunea și stratul nu pot fi „rezervate”.
  const version = (b[1]! >> 3) & 0x03;
  const layer = (b[1]! >> 1) & 0x03;
  return version !== 0x01 && layer !== 0x00;
}

/** Text: UTF-8 valid (ultimul caracter poate fi tăiat de limita citirii), fără octeți nuli. */
export function isText(head: Buffer): boolean {
  if (head.length === 0) return true;
  if (head.includes(0)) return false;
  // Un caracter UTF-8 tăiat la capătul bucății citite nu face fișierul binar.
  let end = head.length;
  for (let i = Math.max(0, head.length - 3); i < head.length; i++) {
    const c = head[i]!;
    const need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
    if (need > 1 && i + need > head.length) end = i;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/**
 * Extensiile care trebuie să aibă un anumit conținut. O extensie absentă de aici (`.nav`, `.mdl`, `.smx`…) nu are o
 * semnătură sigură: trece după extensie, cu condiția ca fișierul să nu fie un executabil sau o arhivă deghizată.
 */
const EXTENSION_KINDS: Record<string, readonly GcsFileKind[]> = {
  zip: ["zip"],
  jar: ["zip"],
  apk: ["zip"],
  pk3: ["zip"],
  pk4: ["zip"],
  docx: ["zip"],
  xlsx: ["zip"],
  pptx: ["zip"],
  odt: ["zip"],
  rar: ["rar"],
  "7z": ["7z"],
  gz: ["gzip"],
  tgz: ["gzip"],
  bz2: ["bzip2"],
  xz: ["xz"],
  tar: ["tar"],
  exe: ["exe"],
  dll: ["exe"],
  sys: ["exe"],
  msi: ["ole"],
  doc: ["ole"],
  xls: ["ole"],
  ppt: ["ole"],
  so: ["elf"],
  pdf: ["pdf"],
  png: ["png"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  gif: ["gif"],
  webp: ["webp"],
  bmp: ["bmp"],
  mp4: ["mp4"],
  m4a: ["mp4"],
  mov: ["mp4"],
  mp3: ["mp3"],
  ogg: ["ogg"],
  wav: ["wav"],
  flac: ["flac"],
  bsp: ["bsp"],
  vpk: ["vpk"],
  dem: ["demo"],
  wad: ["wad"],
  txt: ["text"],
  cfg: ["text"],
  ini: ["text"],
  json: ["text"],
  lua: ["text"],
  sp: ["text"],
  sma: ["text"],
  inc: ["text"],
  md: ["text"],
  csv: ["text"],
  xml: ["text"],
  yml: ["text"],
  yaml: ["text"],
  log: ["text"],
  vmt: ["text"],
  res: ["text", "binary"],
};

/** Conținuturile care nu pot purta o extensie fără semnătură: executabilele și arhivele trebuie numite ca atare. */
const MUST_BE_NAMED: readonly GcsFileKind[] = ["exe", "elf", "macho", "ole", "zip", "rar", "7z", "gzip", "bzip2", "xz", "tar", "pdf"];

/** Extensia unui nume de fișier (`harta.v2.BSP` → `bsp`), `""` fără extensie. */
export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export type GcsFileCheck = { ok: true } | { ok: false; error: "extension_not_allowed" | "no_extension" | "type_mismatch"; detail?: string };

/** Extensia e permisă de categorie (lista goală = orice extensie)? */
export function extensionAllowed(name: string, allowed: readonly string[]): GcsFileCheck {
  const ext = extensionOf(name);
  if (!ext) return allowed.length === 0 ? { ok: true } : { ok: false, error: "no_extension" };
  if (allowed.length > 0 && !allowed.includes(ext)) return { ok: false, error: "extension_not_allowed", detail: ext };
  return { ok: true };
}

/** Conținutul se potrivește cu extensia? (după `extensionAllowed`.) */
export function contentMatches(name: string, kind: GcsFileKind): GcsFileCheck {
  const ext = extensionOf(name);
  const expected = EXTENSION_KINDS[ext];
  if (expected) return expected.includes(kind) ? { ok: true } : { ok: false, error: "type_mismatch", detail: kind };
  return MUST_BE_NAMED.includes(kind) ? { ok: false, error: "type_mismatch", detail: kind } : { ok: true };
}

/** Numele afișat al tipului (eticheta din pagina fișierului): `ZIP`, `Text`, `BSP`… */
export function kindLabel(kind: string, name: string): string {
  if (kind === "text" || kind === "binary" || kind === "") return (extensionOf(name) || kind || "").toUpperCase();
  return kind.toUpperCase();
}

/** Un nume de fișier sigur pentru descărcare și stocare (fără căi, caractere de control sau rezervate). */
export function cleanFileName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!cleaned) return "file";
  if (cleaned.length <= 120) return cleaned;
  const ext = extensionOf(cleaned);
  return ext ? `${cleaned.slice(0, 119 - ext.length)}.${ext}` : cleaned.slice(0, 120);
}
