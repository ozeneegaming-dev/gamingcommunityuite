/** Un fișier citit din store: conținutul ca stream web (bun pentru un `Response`) și mărimea. */
export type GcsStoredFile = { body: ReadableStream<Uint8Array>; size: number };

/**
 * Locul unde stau fișierele încărcate. În producție e MinIO (S3); în teste și pe un dev fără MinIO, un folder local.
 * Cheile sunt generate de server (`2026/10/<uuid>.png`), niciodată de useri.
 */
export interface GcsFileStore {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<GcsStoredFile | null>;
  delete(key: string): Promise<void>;
}
