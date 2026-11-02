import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../../errors";
import { processImage, thumbnailOf } from "./images";

/** Un JPEG „de telefon”: mare, cu EXIF (autorul, drepturile). */
async function phoneJpeg(width = 3000, height = 2000): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#3D7EFF" } })
    .composite([{ input: { create: { width: Math.floor(width / 2), height: Math.floor(height / 2), channels: 3, background: "#FF6A3D" } }, top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .withExif({ IFD0: { Artist: "Telefonul lui Krypt", Copyright: "gps-44.4268-26.1025" } })
    .toBuffer();
}

describe("processImage (pipeline-ul comun)", () => {
  test("micșorează la latura maximă și scrie WebP fără metadate", async () => {
    const input = await phoneJpeg();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processImage(input, { width: 2000, height: 2000, fit: "inside", format: "webp", quality: 82 });
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect([out.width, out.height]).toEqual([2000, 1333]);
    expect(meta.exif).toBeUndefined();
    expect(out.bytes.includes(Buffer.from("Krypt"))).toBe(false);
  });

  test("calitatea mai mică dă un fișier mai mic; imaginile mici nu se măresc", async () => {
    const input = await phoneJpeg(1200, 800);
    const high = await processImage(input, { width: 2000, height: 2000, fit: "inside", format: "jpeg", quality: 95 });
    const low = await processImage(input, { width: 2000, height: 2000, fit: "inside", format: "jpeg", quality: 40 });
    expect(low.bytes.length).toBeLessThan(high.bytes.length);
    expect(Math.max(high.width!, high.height!)).toBe(1200);
    expect((await sharp(low.bytes).metadata()).format).toBe("jpeg");
  });

  test("cu stripMetadata: false, EXIF-ul rămâne", async () => {
    const out = await processImage(await phoneJpeg(600, 400), { width: 2000, height: 2000, fit: "inside", format: "webp", quality: 82, stripMetadata: false });
    expect((await sharp(out.bytes).metadata()).exif).toBeDefined();
    expect([out.width, out.height]).toEqual([600, 400]);
  });

  test("cover decupează exact; contain încadrează pe fundal transparent", async () => {
    const input = await phoneJpeg(900, 300);
    expect(await processImage(input, { width: 512, height: 512, fit: "cover", format: "webp", quality: 85 })).toMatchObject({ width: 512, height: 512 });
    const icon = await processImage(input, { width: 64, height: 64, fit: "contain", format: "png", quality: 100 });
    expect((await sharp(icon.bytes).metadata()).hasAlpha).toBe(true);
  });

  test("un GIF animat rămâne animat doar cu `animated`", async () => {
    const frame = (c: string) => sharp({ create: { width: 40, height: 40, channels: 3, background: c } }).png().toBuffer();
    const gif = await sharp([await frame("#FF0000"), await frame("#00FF00")], { join: { animated: true } }).gif().toBuffer();
    expect((await processImage(gif, { width: 100, height: 100, fit: "inside", format: "webp", quality: 80, animated: true })).pages).toBe(2);
    expect((await processImage(gif, { width: 100, height: 100, fit: "inside", format: "webp", quality: 80 })).pages).toBe(1);
  });

  test("miniatura: WebP de cel mult latura dată", async () => {
    const thumb = await thumbnailOf(await phoneJpeg(1600, 900), 400);
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
    expect((await sharp(thumb.bytes).metadata()).format).toBe("webp");
  });

  test("o imagine stricată → GcsValidationError invalid_image", async () => {
    const broken = Buffer.concat([(await phoneJpeg(100, 100)).subarray(0, 200), Buffer.alloc(100, 1)]);
    await expect(processImage(broken, { width: 100, height: 100, fit: "inside", format: "webp", quality: 80 })).rejects.toBeInstanceOf(GcsValidationError);
  });
});
