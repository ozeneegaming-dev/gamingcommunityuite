/**
 * Ce fișiere se pot atașa (ACP → Setări → Încărcări și imagini, `uploads.allowed_extensions`): tipul real (din magic
 * bytes) trebuie să fie unul cunoscut și permis, iar extensia din numele fișierului, dacă are una, permisă și potrivită
 * cu tipul real. Extensiile periculoase (programe, scripturi, pagini web) sunt refuzate mereu, oricare ar fi lista.
 */

/** Tipurile binare acceptate, recunoscute după magic bytes, cu extensiile lor (prima e cea canonică). */
export const GCS_BINARY_TYPES: Readonly<Record<string, readonly string[]>> = {
  "image/jpeg": ["jpg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/zip": ["zip"],
  "application/x-7z-compressed": ["7z"],
  "application/x-rar-compressed": ["rar"],
  "video/mp4": ["mp4", "m4v"],
  "video/webm": ["webm"],
  "audio/mpeg": ["mp3"],
  "audio/ogg": ["ogg"],
  // Mesajele vocale din chat (MediaRecorder: WebM/Opus în Chrome și Firefox, MP4/AAC în Safari).
  "audio/webm": ["webm"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/x-m4a": ["m4a", "mp4"],
};

/** Fișierele text (configuri de joc, loguri) nu au magic bytes: se acceptă după extensie, doar dacă sunt UTF-8 valid. */
export const GCS_TEXT_EXTENSIONS: readonly string[] = ["txt", "cfg", "ini", "log", "json", "md", "csv", "yml", "yaml"];

const IMAGE_EXTENSIONS = new Set(["jpg", "png", "gif", "webp"]);

/** Aceeași extensie scrisă altfel. */
const ALIASES: Record<string, string> = { jpeg: "jpg", jpe: "jpg", jfif: "jpg", oga: "ogg", opus: "ogg", weba: "webm" };

/** Toate extensiile pe care platforma le poate accepta (lista ACP alege dintre ele). */
export const GCS_KNOWN_EXTENSIONS: readonly string[] = [...new Set([...Object.values(GCS_BINARY_TYPES).flat(), ...GCS_TEXT_EXTENSIONS])];

/** Lista implicită: tot ce accepta platforma și înainte de setare (imagini, arhive, PDF, video, audio, texte). */
export const GCS_DEFAULT_ALLOWED_EXTENSIONS = "jpg, png, gif, webp, pdf, zip, 7z, rar, mp4, webm, mp3, ogg, m4a, txt, cfg, ini, log, json, md, csv, yml, yaml";

/** Extensiile refuzate mereu: programe, scripturi, pagini web și imagini vectoriale (pot conține scripturi). */
export const GCS_DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "dll", "com", "bat", "cmd", "msi", "msp", "mst", "scr", "pif", "cpl", "sys", "drv", "ocx", "lnk", "reg", "inf", "ins", "isp",
  "vb", "vbs", "vbe", "js", "jse", "mjs", "cjs", "ts", "wsf", "wsh", "ws", "ps1", "psm1", "psd1", "msc", "hta", "gadget", "jnlp", "chm",
  "sh", "bash", "zsh", "csh", "ksh", "fish", "command", "run", "bin", "elf", "so", "dylib", "app", "dmg", "pkg", "deb", "rpm", "apk", "ipa",
  "php", "php3", "php4", "php5", "php7", "php8", "phtml", "phar", "pl", "py", "pyc", "pyw", "rb", "cgi", "asp", "aspx", "ascx", "ashx",
  "jsp", "jspx", "war", "jar", "class", "html", "htm", "xhtml", "shtml", "xht", "svg", "svgz", "xml", "xsl", "xslt", "swf", "htaccess",
  "htpasswd", "iso", "img", "vhd", "vhdx", "appref-ms", "application", "url", "desktop", "scf",
]);

/** O extensie în forma ei canonică (litere mici, fără punct, aliasurile unificate). */
export function normalizeExtension(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/^\*?\./, "");
  return ALIASES[v] ?? v;
}

/** Extensia din numele fișierului (canonică), sau `""`. */
export function fileExtension(filename: string): string {
  const m = /\.([A-Za-z0-9-]{1,16})$/.exec(filename.trim());
  return m ? normalizeExtension(m[1]!) : "";
}

/** Lista din ACP (separată prin virgulă, spațiu sau rând nou) → extensiile canonice, fără dubluri. */
export function parseExtensionList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(normalizeExtension).filter((e) => e !== ""))];
}

/** Validarea listei: doar extensii cunoscute, niciuna periculoasă. */
export function extensionListError(v: unknown): string | null {
  if (typeof v !== "string") return "invalid_type";
  if (v.length > 2000) return "too_long";
  const list = parseExtensionList(v);
  if (list.some((e) => GCS_DANGEROUS_EXTENSIONS.has(e))) return "dangerous_extension";
  if (list.some((e) => !GCS_KNOWN_EXTENSIONS.includes(e))) return "unknown_extension";
  return null;
}

/** Tipul real al fișierului (`file-type`), sau `null` dacă nu are magic bytes. */
export type GcsSniffedType = { mime: string; ext: string } | null;

/**
 * Verifică un fișier încărcat: întoarce codul erorii (`dangerous_type`, `extension_not_allowed`, `type_mismatch`,
 * `unsupported_type`) sau `null` dacă se poate păstra. `text` = fișierul fără magic bytes e text UTF-8 valid.
 */
export function uploadTypeError(filename: string, sniffed: GcsSniffedType, allowed: readonly string[], text: boolean): string | null {
  const ext = fileExtension(filename);
  if (ext !== "" && GCS_DANGEROUS_EXTENSIONS.has(ext)) return "dangerous_type";
  const permitted = new Set(allowed.map(normalizeExtension));
  if (sniffed) {
    const exts = GCS_BINARY_TYPES[sniffed.mime];
    if (!exts) return "unsupported_type";
    if (!exts.some((e) => permitted.has(e))) return "extension_not_allowed";
    if (ext === "") return null;
    if (!permitted.has(ext)) return "extension_not_allowed";
    // O imagine redenumită (ex. un JPEG numit .png) e recodată oricum; restul trebuie să aibă extensia tipului real.
    const image = IMAGE_EXTENSIONS.has(exts[0]!);
    return exts.includes(ext) || (image && IMAGE_EXTENSIONS.has(ext)) ? null : "type_mismatch";
  }
  if (!GCS_TEXT_EXTENSIONS.includes(ext) || !text) return "unsupported_type";
  return permitted.has(ext) ? null : "extension_not_allowed";
}
