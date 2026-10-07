import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { GcsByteRange, GcsFileStore, GcsStoredFile } from "./store";

export type GcsS3Config = { endpoint: string; accessKey: string; secretKey: string; bucket: string; region?: string };

/** Store pe MinIO (sau orice S3). Bucket-ul se creează la prima scriere, dacă lipsește. */
export class GcsS3FileStore implements GcsFileStore {
  private readonly client: S3Client;
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly config: GcsS3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    });
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      } catch (e) {
        if (!(e instanceof S3ServiceException) || e.$metadata.httpStatusCode !== 404) throw e;
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
      }
    })().catch((e: unknown) => {
      // O eroare trecătoare (MinIO încă pornește) nu trebuie să blocheze definitiv scrierile.
      this.bucketReady = undefined;
      throw e;
    });
    return this.bucketReady;
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: mime }));
  }

  async get(key: string, range?: GcsByteRange): Promise<GcsStoredFile | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }),
      );
      if (!out.Body) return null;
      // Cu `Range`, mărimea totală vine din `Content-Range` (`bytes 0-99/1234`).
      const total = range ? Number(/\/(\d+)$/.exec(out.ContentRange ?? "")?.[1] ?? 0) : (out.ContentLength ?? 0);
      return { body: out.Body.transformToWebStream() as ReadableStream<Uint8Array>, size: total };
    } catch (e) {
      if (e instanceof NoSuchKey || (e instanceof S3ServiceException && e.$metadata.httpStatusCode === 404)) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
