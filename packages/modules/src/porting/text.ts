import { parseSemver } from "@gcs/core";
import type { GcsPortLicense, GcsPortNote } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodează entitățile HTML uzuale și pe cele numerice (fără caractere de control). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0x1f && code <= 0x10ffff && code !== 0x7f ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text simplu dintr-un fragment HTML: fără taguri, cu entitățile decodate și spațiile adunate. */
export function htmlToText(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** O etichetă pentru manifest: text simplu, fără `{}` și `<>` (ar avea sens special în mesajele ICU), plafonat. */
export function labelText(s: string, max: number): string {
  const text = htmlToText(s).replace(/[{}<>]/g, "").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * O parte a cheii unui plugin (`vendor` sau `nume`): `[a-z][a-z0-9]*(_[a-z0-9]+)*`, cel mult `max` caractere.
 * `MyAddOn` → `my_add_on`, `Cool Stuff!` → `cool_stuff`.
 */
export function keyPart(s: string, max = 24): string {
  const snake = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let out = /^[a-z]/.test(snake) ? snake : `p_${snake}`.replace(/_+$/, "");
  out = out.slice(0, max).replace(/_+$/, "");
  return out === "" || out === "p" ? "plugin" : out;
}

/** O cheie locală din manifest (setare, permisiune, widget, job): `[a-z][a-zA-Z0-9_]{0,39}`. */
export function localKey(s: string): string {
  let out = s.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(out)) out = /^[A-Z]/.test(out) ? out[0]!.toLowerCase() + out.slice(1) : `k_${out}`;
  return out.slice(0, 40).replace(/_+$/, "") || "key";
}

/** Face cheile unice, cu sufixe `_2`, `_3`… (ordinea se păstrează). */
export function uniqueKeys(keys: string[], max = 40): string[] {
  const used = new Set<string>();
  return keys.map((k) => {
    let candidate = k;
    for (let n = 2; used.has(candidate); n++) candidate = `${k.slice(0, max - String(n).length - 1)}_${n}`;
    used.add(candidate);
    return candidate;
  });
}

/** Versiunea sursei ca semver (`1.2` → `1.2.0`, `1.0.0 Beta 2` → `1.0.0-beta.2`); altfel `1.0.0`. */
export function toSemver(raw: string): string {
  const text = raw.trim();
  if (parseSemver(text)) return text;
  const m = /^v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[\s._-]*([A-Za-z]+)[\s._-]*(\d{1,4})?)?/.exec(text);
  if (!m) return "1.0.0";
  const base = `${Number(m[1])}.${Number(m[2] ?? 0)}.${Number(m[3] ?? 0)}`;
  const tag = m[4] ? `-${m[4].toLowerCase()}${m[5] ? `.${Number(m[5])}` : ""}` : "";
  return parseSemver(base + tag) ? base + tag : base;
}

/**
 * Text pe un singur rând pentru un comentariu `//` din codul generat: fără rânduri noi (inclusiv U+2028/U+2029),
 * caractere de control sau `*\/`, plafonat. Sursa nu poate ieși din comentariu.
 */
export function commentText(s: string, max = 160): string {
  const one = s
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\*\//g, "* /")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export const countLines = (data: Buffer | string): number => {
  const text = typeof data === "string" ? data : data.toString("utf8");
  return text === "" ? 0 : text.split("\n").length;
};

/** Un fișier e text dacă nu are octeți nuli în primii 8 KB. */
export const isText = (data: Buffer) => !data.subarray(0, 8192).includes(0);

const GPL = /\b(?:A|L)?GPL(?:-?v?\d(?:\.\d)?)?(?:-only|-or-later|\+)?\b|GNU (?:Affero |Lesser |Library )?General Public License/i;
const SPDX = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]{2,40})/;

/** Licența sursei: din fișierele `LICENSE`/`COPYING`, `composer.json`, `package.json` și antetele SPDX/GPL din cod. */
export function detectLicense(files: Map<string, Buffer>): GcsPortLicense {
  const found = new Set<string>();
  let spdx: string | null = null;
  let gpl = false;
  for (const [path, data] of files) {
    const base = path.split("/").pop()!.toLowerCase();
    const isLicenseFile = /^(?:license|licence|copying)(?:\.(?:md|txt))?$/.test(base);
    const isManifest = base === "composer.json" || base === "package.json";
    const isCode = /\.(?:php|js|css|less|html|phtml|xml)$/.test(base);
    if (!isLicenseFile && !isManifest && !isCode) continue;
    // Doar începutul fișierelor: licența e în antet, iar fișierele mari nu se citesc de mai multe ori.
    const head = data.subarray(0, isLicenseFile ? 4096 : 2048).toString("utf8");
    if (isManifest) {
      const m = /"license"\s*:\s*"([^"]{1,40})"/.exec(head);
      if (m) {
        spdx ??= m[1]!;
        found.add(path);
        if (GPL.test(m[1]!)) gpl = true;
      }
      continue;
    }
    const tag = SPDX.exec(head);
    if (tag) {
      spdx ??= tag[1]!;
      found.add(path);
    }
    if (GPL.test(head) && (isLicenseFile || /licen[cs]e|copyright|spdx/i.test(head))) {
      gpl = true;
      found.add(path);
      spdx ??= /Affero/i.test(head) ? "AGPL" : /Lesser|Library/i.test(head) ? "LGPL" : "GPL";
    } else if (isLicenseFile) {
      found.add(path);
      if (!spdx) {
        if (/MIT License|Permission is hereby granted, free of charge/i.test(head)) spdx = "MIT";
        else if (/Apache License/i.test(head)) spdx = "Apache-2.0";
        else if (/BSD/i.test(head)) spdx = "BSD";
      }
    }
  }
  return { spdx: spdx ? spdx.slice(0, 40) : null, gpl, files: [...found].sort().slice(0, 20) };
}

/** O notă cu parametrii plafonați (nume de tabele, căi): ajunge în raport și în ACP. */
export function boundNote(note: GcsPortNote): GcsPortNote {
  if (!note.params) return { code: note.code };
  return { code: note.code, params: Object.fromEntries(Object.entries(note.params).map(([k, v]) => [k, commentText(String(v), 200)])) };
}
