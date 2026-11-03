/**
 * Verificările popupului de încărcare, înainte de orice trimitere: tipul real (după primii octeți, nu după numele
 * fișierului), mărimea și, la imagini, dimensiunile și decodarea. Serverul verifică oricum din nou.
 */
export type GcsUploadRules = {
  /** Tipurile MIME acceptate (`image/png`, `application/zip`…); și atributul `accept` al alegerii din calculator. */
  accept: string[];
  /** Tipurile, pe scurt, pentru om („PNG, WebP sau SVG”). */
  typesLabel: string;
  maxBytes: number;
  /** Fișierul e o imagine: se decodează și se verifică dimensiunile. */
  image?: { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; square?: boolean };
};

export type GcsUploadCheckKey = "okType" | "okSize" | "okDims" | "okReal" | "errType" | "errSize" | "errMin" | "errMax" | "errSquare" | "errReal";
export type GcsUploadCheck = { key: GcsUploadCheckKey; ok: boolean; size?: number; width?: number; height?: number };

/** `412 KB`, `3,2 MB` (în limba browserului). */
export function formatBytes(bytes: number): string {
  const nf = (v: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${nf(bytes / 1024)} KB`;
  return `${nf(bytes / (1024 * 1024))} MB`;
}

/** Tipul după semnătura de la începutul fișierului (`null` = necunoscut: rămâne tipul declarat). */
export function sniffType(head: Uint8Array): string | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  if (at(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...head.slice(8, 12));
    return brand.startsWith("avif") || brand.startsWith("avis") ? "image/avif" : "video/mp4";
  }
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (at(0, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  const text = new TextDecoder().decode(head).trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "image/svg+xml";
  return null;
}

/** Un tip e acceptat: exact, `image/*` sau extensia (`.json`) pentru fișierele fără semnătură. */
export function typeAccepted(type: string, fileName: string, accept: string[]): boolean {
  const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";
  return accept.some((a) => a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))) || (a.startsWith(".") && a.toLowerCase() === ext));
}

async function imageSize(file: File, type: string): Promise<{ width: number; height: number } | null> {
  if (type !== "image/svg+xml" && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return size;
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Toate verificările unui fișier, în ordinea din popup. */
export async function checkUploadFile(file: File, rules: GcsUploadRules): Promise<GcsUploadCheck[]> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const sniffed = sniffType(head);
  const type = sniffed ?? file.type;
  const checks: GcsUploadCheck[] = [];
  const typeOk = typeAccepted(type, file.name, rules.accept);
  checks.push({ key: typeOk ? "okType" : "errType", ok: typeOk });
  const sizeOk = file.size <= rules.maxBytes;
  checks.push({ key: sizeOk ? "okSize" : "errSize", ok: sizeOk, size: file.size });
  if (!rules.image) {
    if (sniffed) checks.push({ key: "okReal", ok: true });
    return checks;
  }
  const dims = typeOk ? await imageSize(file, type) : null;
  if (!dims || dims.width === 0) {
    checks.push({ key: "errReal", ok: false });
    return checks;
  }
  const { width, height } = dims;
  const img = rules.image;
  if ((img.minWidth && width < img.minWidth) || (img.minHeight && height < img.minHeight)) checks.push({ key: "errMin", ok: false, width, height });
  else if ((img.maxWidth && width > img.maxWidth) || (img.maxHeight && height > img.maxHeight)) checks.push({ key: "errMax", ok: false, width, height });
  else if (img.square && Math.abs(width - height) > Math.max(2, Math.round(Math.min(width, height) * 0.02))) checks.push({ key: "errSquare", ok: false, width, height });
  else checks.push({ key: "okDims", ok: true, width, height });
  checks.push({ key: "okReal", ok: true });
  return checks;
}
