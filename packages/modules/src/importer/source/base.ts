import type { GcsCond, GcsRow, GcsSourceReader } from "./reader";
import { num } from "./values";

/** Părțile comune ale adaptoarelor: prefixul tabelelor, tabelele existente, citirea pe loturi. */
export class GcsSourceTables {
  private tableSet: Promise<Set<string>> | null = null;
  private readonly columnCache = new Map<string, Promise<Set<string>>>();

  constructor(
    readonly reader: GcsSourceReader,
    readonly prefix: string,
  ) {}

  /** Numele complet al unui tabel (cu prefixul sursei). */
  t(name: string): string {
    return `${this.prefix}${name}`;
  }

  async has(name: string): Promise<boolean> {
    this.tableSet ??= this.reader.tables().then((all) => new Set(all.map((x) => x.toLowerCase())));
    return (await this.tableSet).has(this.t(name).toLowerCase());
  }

  async hasColumn(name: string, column: string): Promise<boolean> {
    let set = this.columnCache.get(name);
    if (!set) {
      set = this.reader.columns(this.t(name)).then((c) => new Set(c));
      this.columnCache.set(name, set);
    }
    return (await set).has(column);
  }

  /** Toate rândurile unui tabel mic (grupuri, forumuri…); tabel lipsă → listă goală. */
  async all(name: string, where?: Record<string, GcsCond>, orderBy?: [string, "asc" | "desc"][]): Promise<GcsRow[]> {
    if (!(await this.has(name))) return [];
    return this.reader.select(this.t(name), { ...(where ? { where } : {}), ...(orderBy ? { orderBy } : {}) });
  }

  /** Rândurile cu `column` în lista dată (citite în bucăți, ca interogarea să rămână mică). */
  async whereIn(name: string, column: string, values: (string | number)[], where: Record<string, GcsCond> = {}): Promise<GcsRow[]> {
    if (values.length === 0 || !(await this.has(name))) return [];
    const out: GcsRow[] = [];
    for (let i = 0; i < values.length; i += 500) {
      out.push(...(await this.reader.select(this.t(name), { where: { ...where, [column]: { in: values.slice(i, i + 500) } } })));
    }
    return out;
  }

  /** Lotul următor după id (`id > cursor ORDER BY id LIMIT n`). */
  async idBatch(name: string, idColumn: string, cursor: string | null, limit: number, where: Record<string, GcsCond> = {}): Promise<{ rows: GcsRow[]; next: string | null }> {
    if (!(await this.has(name))) return { rows: [], next: null };
    const after = cursor === null ? -1 : Number(cursor);
    const rows = await this.reader.select(this.t(name), { where: { ...where, [idColumn]: { gt: after } }, orderBy: [[idColumn, "asc"]], limit });
    return { rows, next: rows.length < limit ? null : String(num(rows[rows.length - 1]![idColumn])) };
  }

  /**
   * Lotul următor al unui tabel cu cheie compusă: rândurile cu `column` în `(cursor, cursor + span]`.
   * Un interval fără rânduri trece la următorul, până la valoarea maximă.
   */
  async rangeBatch(name: string, column: string, cursor: string | null, span: number, where: Record<string, GcsCond> = {}): Promise<{ rows: GcsRow[]; next: string | null }> {
    if (!(await this.has(name))) return { rows: [], next: null };
    const max = (await this.reader.max(this.t(name), column)) ?? 0;
    let from = cursor === null ? -1 : Number(cursor);
    while (from < max) {
      const to = from + span;
      const rows = await this.reader.select(this.t(name), { where: { ...where, [column]: { between: [from, to] } } });
      if (rows.length > 0) return { rows, next: to >= max ? null : String(to) };
      from = to;
    }
    return { rows: [], next: null };
  }

  async count(name: string, where?: Record<string, GcsCond>): Promise<number> {
    if (!(await this.has(name))) return 0;
    return this.reader.count(this.t(name), where);
  }
}

/** Un cursor cu faze (`faza:valoare`), pentru pașii care citesc mai multe tabele unul după altul. */
export function phaseCursor(cursor: string | null, phases: readonly string[]): { phase: string; value: string | null } {
  if (cursor === null) return { phase: phases[0]!, value: null };
  const at = cursor.indexOf(":");
  const phase = at === -1 ? phases[0]! : cursor.slice(0, at);
  const value = at === -1 ? cursor : cursor.slice(at + 1);
  return { phase: phases.includes(phase) ? phase : phases[0]!, value: value === "" ? null : value };
}

/** Cursorul după un lot: aceeași fază cu valoarea nouă, faza următoare, sau `null` la final. */
export function nextPhaseCursor(phase: string, next: string | null, phases: readonly string[]): string | null {
  if (next !== null) return `${phase}:${next}`;
  const i = phases.indexOf(phase);
  return i + 1 < phases.length ? `${phases[i + 1]}:` : null;
}

/** Numele unui grup, forum sau câmp: fără spații de prisos, tăiat la `max` caractere. */
export function cleanName(v: string, max: number, fallback: string): string {
  const s = v.replace(/\s+/g, " ").trim();
  return (s || fallback).slice(0, max);
}
