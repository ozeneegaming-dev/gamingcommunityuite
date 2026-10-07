import sharp from "sharp";

/**
 * APNG → cadre compuse (RGBA), pentru recodarea în WebP animat. `sharp` (libvips) citește dintr-un PNG doar imaginea
 * implicită (`IDAT`), deci animația s-ar pierde. Aici: citim bucățile (`acTL`, `fcTL`, `IDAT`/`fdAT`), refacem fiecare
 * cadru ca un PNG de sine stătător (decodat tot de `sharp`, cu toate adâncimile, paletele și întrețeserea) și compunem
 * cadrele pe pânză după specificația APNG: decalajul, `blend_op` (SOURCE / OVER) și `dispose_op` (NONE / BACKGROUND /
 * PREVIOUS). Fără dependențe noi; limitele (cadre, pixeli, timp) se verifică înainte de lucrul greu.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Bucățile care schimbă decodarea culorilor: se copiază în PNG-ul fiecărui cadru. */
const COLOR_CHUNKS = new Set(["PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT"]);

export const APNG_DISPOSE = { none: 0, background: 1, previous: 2 } as const;
export const APNG_BLEND = { source: 0, over: 1 } as const;

export type GcsApngLimits = {
  /** Cele mai multe cadre acceptate. */
  maxFrames: number;
  /** Latura maximă a pânzei (lățime sau înălțime), în pixeli. */
  maxSide: number;
  /** Pixelii tuturor cadrelor compuse (lățime × înălțime × cadre): memoria folosită e de 4 ori atât, în octeți. */
  maxPixels: number;
  /** Timpul maxim al decodării și compunerii, în milisecunde. */
  timeBudgetMs: number;
};

/** De ce nu se poate converti fișierul: stricat, prea multe cadre, prea mare sau prea lent. */
export class GcsApngError extends Error {
  constructor(
    readonly code: "invalid_image" | "too_many_frames" | "animation_too_large" | "processing_timeout",
    readonly params: Record<string, string> = {},
  ) {
    super(code);
    this.name = "GcsApngError";
  }
}

type Chunk = { type: string; data: Buffer };

export type GcsApngFrameControl = { width: number; height: number; x: number; y: number; delayNum: number; delayDen: number; dispose: number; blend: number };

export type GcsApngInfo = { width: number; height: number; plays: number; frames: (GcsApngFrameControl & { data: Buffer[] })[]; ihdr: Buffer; color: Chunk[] };

/** Bucățile unui PNG (fără verificarea CRC: fișierele produse de unele programe o au greșită; o recalculăm oricum). */
function chunksOf(bytes: Buffer): Chunk[] {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new GcsApngError("invalid_image");
  const out: Chunk[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || at + 12 + len > bytes.length) throw new GcsApngError("invalid_image");
    out.push({ type, data: bytes.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
    if (type === "IEND") break;
    if (out.length > 200_000) throw new GcsApngError("invalid_image");
  }
  return out;
}

/** Un fișier APNG: `acTL` înaintea primului `IDAT`. */
export function isApng(bytes: Buffer): boolean {
  try {
    for (const c of chunksOf(bytes)) {
      if (c.type === "acTL") return true;
      if (c.type === "IDAT") return false;
    }
  } catch {
    return false;
  }
  return false;
}

function frameControl(data: Buffer): GcsApngFrameControl {
  if (data.length < 26) throw new GcsApngError("invalid_image");
  return {
    width: data.readUInt32BE(4),
    height: data.readUInt32BE(8),
    x: data.readUInt32BE(12),
    y: data.readUInt32BE(16),
    delayNum: data.readUInt16BE(20),
    delayDen: data.readUInt16BE(22),
    dispose: data[24]!,
    blend: data[25]!,
  };
}

/**
 * Citește structura unui APNG: pânza, numărul de redări și cadrele (controlul + datele comprimate). Imaginea implicită
 * care nu face parte din animație (`IDAT` fără `fcTL` înainte) se ignoră, ca în browsere.
 */
export function readApng(bytes: Buffer, limits: Pick<GcsApngLimits, "maxFrames" | "maxSide" | "maxPixels">): GcsApngInfo {
  const chunks = chunksOf(bytes);
  const ihdr = chunks[0];
  if (!ihdr || ihdr.type !== "IHDR" || ihdr.data.length !== 13) throw new GcsApngError("invalid_image");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  if (width === 0 || height === 0) throw new GcsApngError("invalid_image");
  if (width > limits.maxSide || height > limits.maxSide) throw new GcsApngError("animation_too_large", { maxSide: String(limits.maxSide) });
  const actl = chunks.find((c) => c.type === "acTL");
  if (!actl || actl.data.length < 8) throw new GcsApngError("invalid_image");
  const plays = actl.data.readUInt32BE(4);
  const color: Chunk[] = [];
  const frames: (GcsApngInfo["frames"][number] & { fromIdat: boolean })[] = [];
  let current: (typeof frames)[number] | null = null;
  let seenData = false;
  for (const c of chunks) {
    if (c.type === "fcTL") {
      if (frames.length >= limits.maxFrames) throw new GcsApngError("too_many_frames", { maxFrames: String(limits.maxFrames) });
      const control = frameControl(c.data);
      if (control.width > limits.maxSide || control.height > limits.maxSide) throw new GcsApngError("animation_too_large", { maxSide: String(limits.maxSide) });
      current = { ...control, data: [], fromIdat: false };
      frames.push(current);
    } else if (c.type === "IDAT") {
      // `IDAT` face parte din animație doar dacă un `fcTL` îl precede (primul cadru); altfel e imaginea implicită, ascunsă.
      if (current && frames.length === 1 && (current.fromIdat || current.data.length === 0)) {
        current.fromIdat = true;
        current.data.push(c.data);
      }
      seenData = true;
    } else if (c.type === "fdAT") {
      if (c.data.length < 4) throw new GcsApngError("invalid_image");
      if (current && !current.fromIdat) current.data.push(c.data.subarray(4));
    } else if (!seenData && COLOR_CHUNKS.has(c.type)) color.push(c);
  }
  const usable = frames.filter((f) => f.data.length > 0 && f.width > 0 && f.height > 0).map(({ fromIdat: _fromIdat, ...f }) => f);
  if (usable.length === 0) throw new GcsApngError("invalid_image");
  if (width * height * usable.length > limits.maxPixels) throw new GcsApngError("animation_too_large", { maxSide: String(limits.maxSide) });
  return { width, height, plays, frames: usable, ihdr: ihdr.data, color };
}

// ─── CRC32 (PNG) ───

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(...parts: Buffer[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** O bucată PNG cu lungimea și CRC-ul calculate. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4), data), 0);
  return Buffer.concat([head, data, crc]);
}

/** Un cadru ca PNG de sine stătător: antetul cu mărimea cadrului, bucățile de culoare și datele lui. */
function framePng(info: GcsApngInfo, frame: GcsApngInfo["frames"][number]): Buffer {
  const ihdr = Buffer.from(info.ihdr);
  ihdr.writeUInt32BE(frame.width, 0);
  ihdr.writeUInt32BE(frame.height, 4);
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", ihdr), ...info.color.map((c) => pngChunk(c.type, c.data)), pngChunk("IDAT", Buffer.concat(frame.data)), pngChunk("IEND", Buffer.alloc(0))]);
}

/** Durata unui cadru în ms: `delay_den` 0 = sutimi; sub 11 ms devine 100 ms (ca în browsere). */
export function apngDelayMs(num: number, den: number): number {
  const ms = Math.round((num * 1000) / (den === 0 ? 100 : den));
  return ms <= 10 ? 100 : Math.min(ms, 60_000);
}

export type GcsComposedAnimation = { width: number; height: number; frames: number; loop: number; delays: number[]; rgba: Buffer };

/**
 * Compune cadrele unui APNG pe pânză (RGBA nepremultiplicat, 8 biți): toate cadrele, unul sub altul, în `rgba`
 * (înălțimea totală = `height × frames`), cu duratele și numărul de bucle.
 */
export async function composeApng(bytes: Buffer, limits: GcsApngLimits): Promise<GcsComposedAnimation> {
  const started = Date.now();
  const info = readApng(bytes, limits);
  const W = info.width;
  const H = info.height;
  const frameBytes = W * H * 4;
  const out = Buffer.alloc(frameBytes * info.frames.length);
  const canvas = Buffer.alloc(frameBytes);
  const delays: number[] = [];
  for (let index = 0; index < info.frames.length; index++) {
    if (Date.now() - started > limits.timeBudgetMs) throw new GcsApngError("processing_timeout");
    const f = info.frames[index]!;
    let pixels: Buffer;
    try {
      const raw = await sharp(framePng(info, f), { limitInputPixels: f.width * f.height })
        .ensureAlpha()
        .toColourspace("srgb")
        .raw({ depth: "uchar" })
        .toBuffer({ resolveWithObject: true });
      if (raw.info.channels !== 4 || raw.info.width !== f.width || raw.info.height !== f.height) throw new Error("shape");
      pixels = raw.data;
    } catch {
      throw new GcsApngError("invalid_image");
    }
    // Regiunea cadrului, tăiată la pânză (unele programe scriu cadre care depășesc marginea).
    const x0 = Math.min(f.x, W);
    const y0 = Math.min(f.y, H);
    const w = Math.max(0, Math.min(f.width, W - x0));
    const h = Math.max(0, Math.min(f.height, H - y0));
    // PREVIOUS pe primul cadru = BACKGROUND (specificația APNG).
    const dispose = index === 0 && f.dispose === APNG_DISPOSE.previous ? APNG_DISPOSE.background : f.dispose;
    const saved = dispose === APNG_DISPOSE.previous ? Buffer.from(canvas) : null;
    for (let row = 0; row < h; row++) {
      const src = row * f.width * 4;
      const dst = ((y0 + row) * W + x0) * 4;
      if (f.blend !== APNG_BLEND.over) {
        pixels.copy(canvas, dst, src, src + w * 4);
        continue;
      }
      for (let col = 0; col < w; col++) {
        const s = src + col * 4;
        const d = dst + col * 4;
        const sa = pixels[s + 3]!;
        if (sa === 255) {
          canvas[d] = pixels[s]!;
          canvas[d + 1] = pixels[s + 1]!;
          canvas[d + 2] = pixels[s + 2]!;
          canvas[d + 3] = 255;
        } else if (sa > 0) {
          const da = canvas[d + 3]!;
          // „Over” cu alfa nepremultiplicat: a = sa + da·(1 − sa), c = (cs·sa + cd·da·(1 − sa)) / a.
          const dw = (da * (255 - sa)) / 255;
          const a = sa + dw;
          canvas[d] = Math.round((pixels[s]! * sa + canvas[d]! * dw) / a);
          canvas[d + 1] = Math.round((pixels[s + 1]! * sa + canvas[d + 1]! * dw) / a);
          canvas[d + 2] = Math.round((pixels[s + 2]! * sa + canvas[d + 2]! * dw) / a);
          canvas[d + 3] = Math.round(a);
        }
      }
    }
    canvas.copy(out, index * frameBytes);
    delays.push(apngDelayMs(f.delayNum, f.delayDen));
    if (dispose === APNG_DISPOSE.background) {
      for (let row = 0; row < h; row++) canvas.fill(0, ((y0 + row) * W + x0) * 4, ((y0 + row) * W + x0 + w) * 4);
    } else if (saved) saved.copy(canvas);
  }
  return { width: W, height: H, frames: info.frames.length, loop: Math.min(info.plays, 65_535), delays, rgba: out };
}
