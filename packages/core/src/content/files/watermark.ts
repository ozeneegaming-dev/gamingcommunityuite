import sharp from "sharp";

export type GcsWatermarkPlacement = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "center";

const GRAVITY: Record<GcsWatermarkPlacement, string> = {
  "bottom-right": "southeast",
  "bottom-left": "southwest",
  "top-right": "northeast",
  "top-left": "northwest",
  center: "centre",
};

/**
 * Pune o imagine de watermark peste o captură (Descărcări, Galerie): watermark-ul se micșorează la cel mult un sfert din
 * lățimea imaginii, primește opacitatea aleasă (10–100%) și stă în colțul ales, la o margine de 2%. Formatul imaginii se
 * păstrează (WebP / PNG / JPEG); un GIF animat sau o imagine pe care sharp nu o poate citi întoarce `null` (neschimbată).
 */
export async function watermarkImage(image: Buffer, mark: Buffer, opts: { position: GcsWatermarkPlacement; opacity: number }): Promise<Buffer | null> {
  try {
    const base = sharp(image);
    const meta = await base.metadata();
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) return null;
    const maxWidth = Math.max(16, Math.round(meta.width / 4));
    const maxHeight = Math.max(16, Math.round(meta.height / 4));
    const alpha = Math.round((Math.min(Math.max(opts.opacity, 10), 100) / 100) * 255);
    const resized = await sharp(mark).resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true }).ensureAlpha().png().toBuffer();
    const faded = await sharp(resized)
      .composite([{ input: Buffer.from([255, 255, 255, alpha]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }])
      .png()
      .toBuffer();
    const margin = Math.round(Math.min(meta.width, meta.height) * 0.02);
    const padded = margin > 0 ? await sharp(faded).extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() : faded;
    const out = base.composite([{ input: padded, gravity: GRAVITY[opts.position] }]);
    if (meta.format === "png") return await out.png().toBuffer();
    if (meta.format === "jpeg") return await out.jpeg({ quality: 88 }).toBuffer();
    return await out.webp({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}
