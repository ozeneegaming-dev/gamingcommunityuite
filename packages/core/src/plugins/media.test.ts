import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../errors";
import { mp4DurationMs, parseByteRange, pluginMediaMaxBytes, preparePluginMedia, webmDurationMs } from "./media";

/** O cutie MP4: mărimea (4 octeți), tipul și conținutul. */
function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

/** Un MP4 minim: `ftyp` + `moov/mvhd` (versiunea 0) cu durata dată. */
function mp4(seconds: number, timescale = 1000): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(seconds * timescale), 16);
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\x02\0isomiso2mp41", "latin1")), box("moov", box("mvhd", mvhd))]);
}

/** Un element EBML cu id-ul (octeții lui) și conținutul, mărimea pe 8 octeți. */
function ebml(id: number[], data: Buffer): Buffer {
  const size = Buffer.alloc(8);
  size.writeUInt8(0x01, 0);
  size.writeUIntBE(data.length, 2, 6);
  return Buffer.concat([Buffer.from(id), size, data]);
}

/** Un WebM minim: antetul EBML (doctype `webm`) și `Segment/Info` cu `TimecodeScale` și `Duration` (float64, ms). */
function webm(seconds: number): Buffer {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from("webm")));
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(seconds * 1000, 0);
  const scale = Buffer.from([0x0f, 0x42, 0x40]);
  const info = ebml([0x15, 0x49, 0xa9, 0x66], Buffer.concat([ebml([0x2a, 0xd7, 0xb1], scale), ebml([0x44, 0x89], duration)]));
  return Buffer.concat([header, ebml([0x18, 0x53, 0x80, 0x67], info)]);
}

const decl = { image: { maxMb: 1, maxSide: 256, animated: false }, video: { maxMb: 1, maxSeconds: 30 }, audio: { maxMb: 1 }, quotaMb: 10 };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof GcsValidationError ? e.fields.file : String(e);
  }
};

describe("fișierele media ale pluginurilor", () => {
  test("durata unui MP4 vine din moov/mvhd", () => {
    expect(mp4DurationMs(mp4(12.5))).toBe(12_500);
    expect(mp4DurationMs(mp4(90, 600))).toBe(90_000);
    expect(mp4DurationMs(Buffer.from("not a video"))).toBeNull();
    // O cutie cu mărime falsă (mai mare decât fișierul) nu duce la citiri în afara bufferului.
    const broken = mp4(5);
    broken.writeUInt32BE(0x7fffffff, broken.indexOf("moov") - 4);
    expect(mp4DurationMs(broken)).toBeNull();
  });

  test("durata unui WebM vine din Segment/Info", () => {
    expect(webmDurationMs(webm(42))).toBe(42_000);
    expect(webmDurationMs(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0xff]))).toBeNull();
  });

  test("imaginile se recodează în WebP, cu transparența și latura maximă", async () => {
    const png = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    const out = await preparePluginMedia(png, decl);
    expect(out).toMatchObject({ kind: "image", mime: "image/webp", ext: "webp", width: 256, height: 128 });
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
  });

  test("tipul se citește din conținut; tipurile nedeclarate și fișierele prea mari sunt refuzate", async () => {
    expect(await code(preparePluginMedia(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), decl))).toBe("unsupported_type");
    expect(await code(preparePluginMedia(Buffer.from("<html><script>x</script></html>"), decl))).toBe("unsupported_type");
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
    expect(await code(preparePluginMedia(png, { quotaMb: 10, video: { maxMb: 1, maxSeconds: 5 } }))).toBe("unsupported_type");
    // Antet PNG valid, conținut stricat.
    expect(await code(preparePluginMedia(Buffer.concat([png.subarray(0, 40), Buffer.alloc(200, 7)]), decl))).toBe("invalid_image");
    const big = Buffer.concat([png, Buffer.alloc(1024 * 1024 + 10)]);
    expect(await code(preparePluginMedia(big, decl))).toBe("too_large");
  });

  test("video: durata maximă și durata necunoscută", async () => {
    expect(await preparePluginMedia(mp4(10), decl)).toMatchObject({ kind: "video", mime: "video/mp4", ext: "mp4", durationMs: 10_000 });
    expect(await code(preparePluginMedia(mp4(31), decl))).toBe("too_long");
    expect(await code(preparePluginMedia(webm(45), decl))).toBe("too_long");
    expect(await preparePluginMedia(webm(20), decl)).toMatchObject({ kind: "video", mime: "video/webm", durationMs: 20_000 });
  });

  test("cererile Range: un interval, capetele validate", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=9-3", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-1,5-9", 100)).toBeNull();
    expect(parseByteRange("items=0-9", 100)).toBeNull();
  });

  test("mărimea maximă a unei încărcări vine din declarație", () => {
    expect(pluginMediaMaxBytes({ quotaMb: 10, image: { maxMb: 4, maxSide: 2048, animated: false }, video: { maxMb: 40, maxSeconds: 30 } })).toBe(40 * 1024 * 1024);
  });
});
