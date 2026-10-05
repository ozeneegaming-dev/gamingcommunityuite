import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { GcsS3FileStore } from "./s3Store";

/**
 * Rulează doar cu un MinIO/S3 real: `TEST_S3_URL=http://<cheie>:<secret>@localhost:9000` (în CI, serviciul `minio`).
 * Bucket-ul de test e creat automat la prima scriere.
 */
const url = process.env.TEST_S3_URL;

describe.skipIf(!url)("GcsS3FileStore (MinIO)", () => {
  function store(): GcsS3FileStore {
    const u = new URL(url!);
    return new GcsS3FileStore({
      endpoint: `${u.protocol}//${u.host}`,
      accessKey: decodeURIComponent(u.username),
      secretKey: decodeURIComponent(u.password),
      bucket: "gcs-test",
    });
  }

  async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
    return new Response(stream).text();
  }

  test("put → get → delete", async () => {
    const s = store();
    const key = `test/${randomUUID()}.txt`;
    await s.put(key, Buffer.from("salut din MinIO"), "text/plain");

    const file = await s.get(key);
    expect(file?.size).toBe(15);
    expect(await text(file!.body)).toBe("salut din MinIO");

    await s.delete(key);
    expect(await s.get(key)).toBeNull();
  });

  test("o cheie inexistentă → null", async () => {
    expect(await store().get(`test/${randomUUID()}`)).toBeNull();
  });
});
