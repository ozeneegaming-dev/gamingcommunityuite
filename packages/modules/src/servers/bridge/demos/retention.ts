/**
 * Retenția și cota demo-urilor, antetul fișierelor și decizia comprimării (specul 2026-10-08-servere-hltv §6). Pur:
 * jobul de curățenie aplică planul (șterge fișierele, marchează rândurile `EXPIRED`).
 */

export type GcsStoredDemoRow = { id: number; storedSize: number; availableAt: Date };

/**
 * Planul curățeniei: `expired` = mai vechi decât retenția; `evicted` = cele mai vechi dintre rămase, scoase până când
 * totalul încape în cotă (fără cele din `keep`, ex. demo-ul tocmai adus).
 */
export function planDemoExpiry(rows: GcsStoredDemoRow[], opts: { now: Date; retentionDays: number; quotaBytes: number; keep?: number[] }): { expired: number[]; evicted: number[] } {
  const cutoff = opts.now.getTime() - opts.retentionDays * 86_400_000;
  const sorted = [...rows].sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.id - b.id);
  const expired = sorted.filter((r) => r.availableAt.getTime() < cutoff).map((r) => r.id);
  const keep = new Set(opts.keep ?? []);
  const remaining = sorted.filter((r) => r.availableAt.getTime() >= cutoff);
  let total = remaining.reduce((n, r) => n + r.storedSize, 0);
  const evicted: number[] = [];
  for (const r of remaining) {
    if (total <= opts.quotaBytes) break;
    if (keep.has(r.id)) continue;
    evicted.push(r.id);
    total -= r.storedSize;
  }
  return { expired, evicted };
}

export type GcsDemoHeaderKind = "goldsrc" | "source" | "source2";

/** Felul demo-ului după primii octeți: `HLDEMO` (GoldSrc, CS 1.6), `HL2DEMO` (Source), `PBDEMS2` (Source 2, CS2). */
export function demoHeaderKind(head: Buffer): GcsDemoHeaderKind | null {
  if (head.length < 8) return null;
  const magic = head.subarray(0, 8).toString("latin1");
  if (magic === "HLDEMO\0\0") return "goldsrc";
  if (magic === "HL2DEMO\0") return "source";
  if (magic === "PBDEMS2\0") return "source2";
  return null;
}

/** Antetul corespunde jocului serverului (CS 1.6 → GoldSrc; CS2 → Source 2 sau Source, serverele CS:GO). */
export function demoHeaderOk(game: string, head: Buffer): boolean {
  const kind = demoHeaderKind(head);
  return game === "cs16" ? kind === "goldsrc" : game === "cs2" ? kind === "source2" || kind === "source" : false;
}

/** Varianta comprimată se păstrează doar dacă economisește cel puțin 10 %. */
export function keepCompressed(original: number, compressed: number): boolean {
  return original > 0 && compressed <= original * 0.9;
}
