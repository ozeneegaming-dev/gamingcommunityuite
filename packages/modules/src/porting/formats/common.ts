import { detectLicense, countLines, isText } from "../text";
import { parseXml, type GcsXmlElement } from "../xml";
import type { GcsPortCodeFile, GcsPortCodeKind, GcsPortFormat, GcsPortMeta, GcsPortNote, GcsPortSource } from "../types";

/** O sursă goală, completată de cititorul formatului. */
export function emptySource(format: GcsPortFormat, files: Map<string, Buffer>, meta: GcsPortMeta): GcsPortSource {
  return {
    format,
    meta,
    settings: [],
    permissions: [],
    routes: [],
    menus: [],
    phrases: new Map(),
    tables: [],
    templates: [],
    styles: [],
    tasks: [],
    widgets: [],
    code: [],
    views: new Map(),
    files,
    license: detectLicense(files),
    notes: [],
  };
}

/** Un fișier ca text UTF-8 (fișierele binare → `null`). */
export function textOf(files: Map<string, Buffer>, path: string): string | null {
  const data = files.get(path);
  return data && isText(data) ? data.toString("utf8") : null;
}

/** JSON-ul unui fișier, sau `null` (cu o notă) dacă lipsește sau nu e valid. */
export function jsonOf(files: Map<string, Buffer>, path: string, notes: GcsPortNote[]): unknown {
  const text = textOf(files, path);
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    notes.push({ code: "invalid_file", params: { path } });
    return null;
  }
}

/** XML-ul unui fișier, sau `null` (cu o notă) dacă lipsește sau nu e valid. */
export function xmlOf(files: Map<string, Buffer>, path: string, notes: GcsPortNote[]): GcsXmlElement | null {
  const text = textOf(files, path);
  if (text === null) return null;
  try {
    const root = parseXml(text);
    if (!root) notes.push({ code: "invalid_file", params: { path } });
    return root;
  } catch {
    notes.push({ code: "invalid_file", params: { path } });
    return null;
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** O durată ISO 8601 (`PT1H`, `P1D`, `PT5M`) în minute, între 5 și 10080 (cât permite un job de plugin). */
export function isoMinutes(raw: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(raw.trim());
  if (!m) return 1440;
  const minutes = Number(m[1] ?? 0) * 10080 + Number(m[2] ?? 0) * 1440 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0) + Math.ceil(Number(m[5] ?? 0) / 60);
  return clampMinutes(minutes || 1440);
}

export const clampMinutes = (n: number) => Math.min(10080, Math.max(5, Math.round(n)));

/** Antetul unui fișier de șablon: `<prefix:template parameters="$a, $b" />` (eliminat din corp). */
export function templateHeader(body: string): { params: string[]; body: string } {
  const m = /^\s*<[a-z][a-z0-9]*:template\s+parameters="([^"]*)"[^>]*\/?>\s*/i.exec(body);
  if (!m) return { params: [], body };
  return { params: paramNames(m[1]!), body: body.slice(m[0].length) };
}

/** Numele parametrilor dintr-o listă PHP (`$items, $title=NULL`). */
export const paramNames = (raw: string): string[] => [...raw.matchAll(/\$([A-Za-z_]\w*)/g)].map((m) => m[1]!).slice(0, 30);

/** Fișierele de cod (PHP, JavaScript), cu tipul lor după cale; `kinds` suprascrie tipul unor fișiere anume. */
export function codeFiles(files: Map<string, Buffer>, classify: (path: string) => GcsPortCodeKind, kinds: Map<string, GcsPortCodeKind> = new Map()): GcsPortCodeFile[] {
  const out: GcsPortCodeFile[] = [];
  for (const [path, data] of files) {
    if (/\.php$/i.test(path)) out.push({ path, kind: kinds.get(path) ?? classify(path), lines: countLines(data) });
    else if (/\.(?:js|mjs)$/i.test(path) && !/\.min\.js$/i.test(path)) out.push({ path, kind: "javascript", lines: countLines(data) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
