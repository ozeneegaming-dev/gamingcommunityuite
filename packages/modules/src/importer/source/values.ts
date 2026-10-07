/** Conversiile valorilor citite din baza veche (MySQL întoarce numere, șiruri sau `Buffer` pentru coloanele binare). */

export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf8");
  return String(v);
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : fallback;
}

export function id(v: unknown): string {
  return String(Math.trunc(num(v)));
}

/** Un timestamp Unix (secunde) → `Date`; 0, negativ sau lipsă → `null`. */
export function unixDate(v: unknown): Date | null {
  const n = num(v);
  return n > 0 ? new Date(n * 1000) : null;
}

/** Lista de id-uri separate prin virgulă (ex. grupurile secundare). */
export function idList(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s) && s !== "0");
}

/** Un IP stocat binar (4 sau 16 octeți) sau ca text → forma text; altceva → `null`. */
export function ipString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const bytes = Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v) : null;
  if (bytes) {
    if (bytes.length === 4) return [...bytes].join(".");
    if (bytes.length === 16) {
      const groups: string[] = [];
      for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
      return groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
    }
    const text = bytes.toString("utf8");
    return /^[0-9a-f.:]{3,45}$/i.test(text) ? text : null;
  }
  const text = String(v).trim();
  return /^[0-9a-f.:]{3,45}$/i.test(text) ? text : null;
}

/** O culoare hex `#RRGGBB` dintr-un text CSS sau HTML (ex. `color: #f00; font-weight: bold`); altfel `null`. */
export function hexColor(v: unknown): string | null {
  const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(str(v));
  if (!m) return null;
  const h = m[1]!;
  return `#${(h.length === 3 ? [...h].map((c) => c + c).join("") : h).toUpperCase()}`;
}

/** Textul simplu al unui fragment HTML (descrieri de forum, nume de grup), cu entitățile de bază decodate. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type PhpValue = string | number | boolean | null | { [key: string]: PhpValue };

/**
 * Un decodor minimal pentru valorile serializate PHP (`a:1:{s:4:"hash";…}`), pe octeți (lungimile `s:` sunt în
 * octeți UTF-8). Obiectele PHP nu sunt acceptate (nu se instanțiază nimic). Formă invalidă → `null`.
 */
export function phpUnserialize(input: unknown): PhpValue {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(str(input), "utf8");
  let pos = 0;
  const readUntil = (ch: string): string => {
    const end = buf.indexOf(ch, pos);
    if (end === -1) throw new Error("php");
    const out = buf.subarray(pos, end).toString("utf8");
    pos = end + 1;
    return out;
  };
  const expect = (ch: string) => {
    if (buf.toString("utf8", pos, pos + 1) !== ch) throw new Error("php");
    pos++;
  };
  let depth = 0;
  const value = (): PhpValue => {
    const type = buf.toString("utf8", pos, pos + 1);
    pos += 1;
    if (type === "N") {
      expect(";");
      return null;
    }
    expect(":");
    if (type === "b") return readUntil(";") === "1";
    if (type === "i" || type === "d") return Number(readUntil(";"));
    if (type === "s") {
      const len = Number(readUntil(":"));
      if (!Number.isInteger(len) || len < 0) throw new Error("php");
      expect('"');
      const out = buf.subarray(pos, pos + len).toString("utf8");
      pos += len;
      expect('"');
      expect(";");
      return out;
    }
    if (type === "a") {
      if (++depth > 32) throw new Error("php");
      const count = Number(readUntil(":"));
      expect("{");
      const out: Record<string, PhpValue> = {};
      for (let i = 0; i < count; i++) {
        const key = value();
        out[String(key)] = value();
      }
      expect("}");
      depth--;
      return out;
    }
    throw new Error("php");
  };
  try {
    return value();
  } catch {
    return null;
  }
}

/** Un câmp JSON din baza veche; formă invalidă → `fallback`. */
export function jsonValue<T>(v: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(str(v)) as unknown;
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}
