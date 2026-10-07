import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Citește o arhivă simplă (fără ZIP64, *store* / *deflate*), ca semnarea unui pachet deja construit să lucreze pe exact
 * aceleași fișiere. Doar pentru arhivele proprii: GCS își verifică pachetele cu cititorul lui, mult mai strict.
 */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("zip: end of central directory not found");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("zip: bad central directory");
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(dataAt, dataAt + compressed);
    const data = method === 8 ? inflateRawSync(body) : method === 0 ? Buffer.from(body) : null;
    if (!data || (crc32(data) >>> 0) !== crc) throw new Error(`zip: cannot read ${name}`);
    if (!name.endsWith("/")) out.set(name, data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * O intrare de scris în arhivă. `mode` (cu biții de tip Unix, ex. `0o100644`) marchează arhiva ca fiind creată pe Unix;
 * `method`: 0 = fără compresie, 8 = deflate. `flags` și `crc` suprascriu valorile calculate (doar pentru teste).
 */
export type GcsZipEntryInput = {
  name: string;
  data: Uint8Array | string;
  mode?: number;
  method?: 0 | 8;
  flags?: number;
  crc?: number;
  /** Mărimea declarată (despachetat), dacă diferă de cea reală (teste). */
  declaredSize?: number;
};

/** Data fixă a intrărilor (arhive reproductibile). */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Un ZIP simplu (fără ZIP64), deterministic: aceleași intrări dau aceiași octeți. */
export function writeZip(entries: GcsZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data);
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(e.name, "utf8");
    const crc = e.crc ?? crc32(data);
    const flags = e.flags ?? 0x0800;
    const size = e.declaredSize ?? data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.mode !== undefined ? (3 << 8) | 20 : 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(e.mode !== undefined ? (e.mode << 16) >>> 0 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}
