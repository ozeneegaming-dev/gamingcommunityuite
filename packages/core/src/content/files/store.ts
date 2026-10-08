/** Un fișier citit din store: conținutul ca stream web (bun pentru un `Response`) și mărimea totală a fișierului. */
export type GcsStoredFile = { body: ReadableStream<Uint8Array>; size: number };

/** O parte dintr-un fișier (cererile `Range` ale player-elor audio/video), cu capetele incluse. */
export type GcsByteRange = { start: number; end: number };

/**
 * Locul unde stau fișierele încărcate. În producție e MinIO (S3); în teste și pe un dev fără MinIO, un folder local.
 * Cheile sunt generate de server (`2026/10/<uuid>.png`), niciodată de useri.
 */
export interface GcsFileStore {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /**
   * Un fișier mare de pe discul local, citit în flux (fără să fie ținut în memorie): ex. demo-urile meciurilor, de sute
   * de MB. Fișierul sursă rămâne; îl șterge apelantul.
   */
  putFile(key: string, filePath: string, mime: string): Promise<void>;
  /** Fișierul întreg sau, cu `range`, doar acea parte (`size` rămâne mărimea totală). */
  get(key: string, range?: GcsByteRange): Promise<GcsStoredFile | null>;
  delete(key: string): Promise<void>;
}
