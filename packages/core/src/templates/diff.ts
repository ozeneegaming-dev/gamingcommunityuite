/**
 * Diferențele pe rânduri dintre două texte (algoritmul Myers), pentru istoricul șabloanelor și al fișierelor CSS.
 * Pur (fără Node): exportat și ca `@gcs/core/diff`, ca editorul din browser să compare versiunile local.
 */

export type GcsDiffLine = { op: "eq" | "add" | "del"; text: string; a: number | null; b: number | null };

const MAX_EDITS = 1000;

function splitLines(s: string): string[] {
  if (s === "") return [];
  return s.replace(/\r\n?/g, "\n").split("\n");
}

/** Rândurile celor două texte, marcate: comune (`eq`), șterse din `a` (`del`), adăugate în `b` (`add`). */
export function diffLines(a: string, b: string): GcsDiffLine[] {
  const x = splitLines(a);
  const y = splitLines(b);
  // Prefixul și sufixul comun nu intră în căutare (cazul obișnuit: o modificare mică într-un fișier mare).
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const mid = middle(x.slice(start, endX), y.slice(start, endY));
  const out: GcsDiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: "eq", text: x[i]!, a: i + 1, b: i + 1 });
  for (const m of mid) {
    out.push({ op: m.op, text: m.text, a: m.a === null ? null : m.a + start + 1, b: m.b === null ? null : m.b + start + 1 });
  }
  for (let i = endX, j = endY; i < x.length; i++, j++) out.push({ op: "eq", text: x[i]!, a: i + 1, b: j + 1 });
  return out;
}

/** Myers O(ND) pe partea din mijloc; peste `MAX_EDITS` diferențe, totul vechi șters și totul nou adăugat. */
function middle(x: string[], y: string[]): { op: "eq" | "add" | "del"; text: string; a: number | null; b: number | null }[] {
  const n = x.length;
  const m = y.length;
  if (n === 0) return y.map((text, j) => ({ op: "add" as const, text, a: null, b: j }));
  if (m === 0) return x.map((text, i) => ({ op: "del" as const, text, a: i, b: null }));
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let i: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) i = v[offset + k + 1]!;
      else i = v[offset + k - 1]! + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) {
        i++;
        j++;
      }
      next[offset + k] = i;
      if (i >= n && j >= m) {
        found = d;
        break;
      }
    }
    v = next;
    if (found !== -1) {
      trace.push(v.slice());
      break;
    }
  }
  if (found === -1) {
    return [...x.map((text, i) => ({ op: "del" as const, text, a: i, b: null })), ...y.map((text, j) => ({ op: "add" as const, text, a: null, b: j }))];
  }
  // Drumul înapoi prin istoricul vectorilor `v`.
  const ops: { op: "eq" | "add" | "del"; text: string; a: number | null; b: number | null }[] = [];
  let i = n;
  let j = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const k = i - j;
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevI = prev[offset + prevK]!;
    const prevJ = prevI - prevK;
    while (i > prevI && j > prevJ) {
      i--;
      j--;
      ops.push({ op: "eq", text: x[i]!, a: i, b: j });
    }
    if (down) {
      j--;
      ops.push({ op: "add", text: y[j]!, a: null, b: j });
    } else {
      i--;
      ops.push({ op: "del", text: x[i]!, a: i, b: null });
    }
  }
  while (i > 0 && j > 0) {
    i--;
    j--;
    ops.push({ op: "eq", text: x[i]!, a: i, b: j });
  }
  return ops.reverse();
}

/** Câte rânduri s-au adăugat și câte s-au șters. */
export function diffStats(lines: GcsDiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === "add") added++;
    else if (l.op === "del") removed++;
  }
  return { added, removed };
}

/**
 * Bucățile de afișat: rândurile modificate cu `context` rânduri comune în jur; restul devin un separator
 * (`{ skipped: n }`), ca un fișier lung să nu fie afișat întreg pentru o modificare de un rând.
 */
export function diffHunks(lines: GcsDiffLine[], context = 3): (GcsDiffLine | { skipped: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.op === "eq") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: (GcsDiffLine | { skipped: number })[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (skipped) out.push({ skipped });
      skipped = 0;
      out.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ skipped });
  return out;
}
