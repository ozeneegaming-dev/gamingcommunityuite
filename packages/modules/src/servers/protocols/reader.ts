/** Codurile de eroare ale unei interogări (statusul serverului le păstrează în `error`). */
export type GcsQueryError = "timeout" | "blocked" | "dns" | "refused" | "unreachable" | "invalid_response" | "too_large" | "unknown_game" | "auth_failed" | "widget_disabled" | "not_found";

/** O interogare eșuată, cu un cod stabil (nu se afișează mesajul, doar codul tradus). */
export class GcsQueryFailure extends Error {
  constructor(readonly code: GcsQueryError) {
    super(code);
    this.name = "GcsQueryFailure";
  }
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Cititorul unui răspuns binar: fiecare citire verifică limitele bufferului, iar orice depășire e un răspuns invalid
 * (nu o excepție de runtime). Șirurile se termină cu `\0` și au o lungime maximă.
 */
export class GcsByteReader {
  private offset: number;

  constructor(
    private readonly buf: Buffer,
    offset = 0,
  ) {
    this.offset = offset;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private need(bytes: number): void {
    if (this.offset + bytes > this.buf.length) throw new GcsQueryFailure("invalid_response");
  }

  byte(): number {
    this.need(1);
    return this.buf.readUInt8(this.offset++);
  }

  int16(): number {
    this.need(2);
    const v = this.buf.readInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  uint16BE(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  int32(): number {
    this.need(4);
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  float(): number {
    this.need(4);
    const v = this.buf.readFloatLE(this.offset);
    this.offset += 4;
    return v;
  }

  bytes(n: number): Buffer {
    this.need(n);
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  skip(n: number): void {
    this.need(n);
    this.offset += n;
  }

  /** Un șir terminat cu `\0` (UTF-8, caracterele invalide devin �), de cel mult `max` octeți. */
  string(max = 1024): string {
    const end = this.buf.indexOf(0, this.offset);
    if (end === -1 || end - this.offset > max) throw new GcsQueryFailure("invalid_response");
    const text = decoder.decode(this.buf.subarray(this.offset, end));
    this.offset = end + 1;
    return text;
  }
}
