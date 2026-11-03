import sharp from "sharp";
import { GcsValidationError } from "../../errors";

/**
 * Setările imaginilor încărcate (ACP → Setări → Încărcări și imagini): latura maximă, calitatea, conversia în WebP,
 * ștergerea metadatelor (EXIF, GPS) și latura miniaturii (0 = fără miniaturi).
 */
export type GcsImageSettings = { maxSide: number; quality: number; webp: boolean; stripMetadata: boolean; thumbnailSide: number };
export const GCS_IMAGE_DEFAULTS: GcsImageSettings = { maxSide: 2000, quality: 82, webp: true, stripMetadata: true, thumbnailSide: 400 };

/** Ce poate primi pipeline-ul atașamentelor din setări: extensiile permise și imaginile. */
export type GcsUploadPolicy = { allowedExtensions: readonly string[]; image: GcsImageSettings };

export type GcsImageFormat = "jpeg" | "png" | "webp" | "gif";

/**
 * O recodare: cutia (`inside` = încadrată fără mărire, `cover` = decupată exact, `contain` = încadrată pe fundal
 * transparent), formatul și calitatea. Animația (GIF / WebP) se păstrează doar cu `animated`; altfel rămâne primul cadru
 * și orientarea din EXIF se aplică pe pixeli. Metadatele se șterg, în afară de `stripMetadata: false`.
 */
export type GcsImageJob = {
  width: number;
  height: number;
  fit: "inside" | "cover" | "contain";
  format: GcsImageFormat;
  quality: number;
  animated?: boolean;
  stripMetadata?: boolean;
  /** `inside` mărește și imaginile mai mici (ex. un SVG rasterizat la latura maximă). */
  enlarge?: boolean;
  /** Rezoluția de rasterizare a unui SVG. */
  density?: number;
};

export type GcsProcessedImage = { bytes: Buffer; width: number | null; height: number | null; pages: number };

const LIMIT_INPUT_PIXELS = 100_000_000;

/** Pipeline-ul comun al imaginilor (atașamente, avataruri, cover-uri, imagini decorative). */
export async function processImage(bytes: Buffer, job: GcsImageJob): Promise<GcsProcessedImage> {
  const animated = job.animated ?? false;
  let out: Buffer;
  try {
    let img = sharp(bytes, { animated, limitInputPixels: LIMIT_INPUT_PIXELS, ...(job.density ? { density: job.density } : {}) });
    if (!animated) img = img.rotate();
    img = img.resize(
      job.fit === "cover"
        ? { width: job.width, height: job.height, fit: "cover", position: "attention" }
        : job.fit === "contain"
          ? { width: job.width, height: job.height, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }
          : { width: job.width, height: job.height, fit: "inside", withoutEnlargement: !job.enlarge },
    );
    if (job.stripMetadata === false) img = img.keepMetadata();
    const q = Math.min(100, Math.max(1, Math.round(job.quality)));
    img = job.format === "jpeg" ? img.jpeg({ quality: q, mozjpeg: true }) : job.format === "png" ? img.png() : job.format === "webp" ? img.webp({ quality: q }) : img.gif();
    out = await img.toBuffer();
  } catch {
    // Antet valid, conținut stricat (sau prea mare): e o eroare a fișierului, nu a serverului.
    throw new GcsValidationError({ file: "invalid_image" });
  }
  const meta = await sharp(out, { animated: true }).metadata();
  return { bytes: out, width: meta.width ?? null, height: meta.pageHeight ?? meta.height ?? null, pages: meta.pages ?? 1 };
}

/** Miniatura unei imagini: WebP, primul cadru, încadrată în `side` px, fără metadate. */
export function thumbnailOf(bytes: Buffer, side: number): Promise<GcsProcessedImage> {
  return processImage(bytes, { width: side, height: side, fit: "inside", format: "webp", quality: 75 });
}
