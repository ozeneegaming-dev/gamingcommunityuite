import type { GcsActor, GcsAppService, GcsContentSourceDef, GcsModuleRegistry } from "@gcs/core";
import type { GcsUserRef } from "../forums/queries";

/** Un rezultat al căutării dintr-o sursă de conținut (randat la fel pentru toate aplicațiile). */
export type GcsContentHit = {
  key: string;
  title: string;
  href: string;
  /** Text simplu (fără HTML). */
  snippet: string;
  author: GcsUserRef | null;
  at: string;
  /** Locul conținutului (ex. baza de date), cu linkul lui. */
  context: { label: string; href: string } | null;
  image: string | null;
};

export type GcsContentSearchInput = { q: string; page: number; perPage: number };
export type GcsContentSearchHandler = (actor: GcsActor, input: GcsContentSearchInput) => Promise<{ hits: GcsContentHit[]; total: number }>;

/** Un element al fluxului de activitate adus de o sursă (`id` = id-ul numeric al conținutului, pentru cursor). */
export type GcsContentStreamEntry = {
  id: number;
  at: Date;
  user: GcsUserRef | null;
  title: string;
  href: string;
  snippet: string;
  context: { label: string; href: string } | null;
};

/** Elementele de până la momentul `until` (inclusiv), cele mai noi primele, cel mult `limit`. */
export type GcsContentStreamHandler = (viewer: GcsActor, query: { until: Date | null; limit: number }) => Promise<GcsContentStreamEntry[]>;

export type GcsContentSourceView = { key: string; module: string; labelKey: string; icon: string };

/**
 * Sursele de conținut ale aplicațiilor (specul 2026-11-03-pagini §6): metadatele vin din `GcsModule.contentSources`,
 * funcțiile le înregistrează serviciile fiecărei aplicații. O sursă apare doar cu aplicația ei pornită și cu funcția
 * înregistrată; căutarea site-ului îi dă un tab, fluxul de activitate îi amestecă elementele (tipul `app`).
 */
export class GcsContentSources {
  private readonly searchers = new Map<string, GcsContentSearchHandler>();
  private readonly streams = new Map<string, GcsContentStreamHandler>();

  constructor(private readonly deps: { registry: GcsModuleRegistry; apps: Pick<GcsAppService, "enabledFilter"> }) {}

  register(key: string, handlers: { search?: GcsContentSearchHandler; stream?: GcsContentStreamHandler }): void {
    if (handlers.search) this.searchers.set(key, handlers.search);
    if (handlers.stream) this.streams.set(key, handlers.stream);
  }

  private async active(kind: "search" | "stream"): Promise<{ module: string; def: GcsContentSourceDef }[]> {
    const enabled = await this.deps.apps.enabledFilter();
    const handlers = kind === "search" ? this.searchers : this.streams;
    return this.deps.registry.contentSources().filter((s) => s.def[kind] === true && handlers.has(s.def.key) && enabled(s.module));
  }

  /** Taburile căutării aduse de aplicațiile pornite. */
  async searchSources(): Promise<GcsContentSourceView[]> {
    return (await this.active("search")).map((s) => ({ key: s.def.key, module: s.module, labelKey: s.def.labelKey, icon: s.def.icon }));
  }

  /** Căutarea într-o sursă (`null` = sursa nu există sau aplicația ei e oprită). */
  async search(key: string, actor: GcsActor, input: GcsContentSearchInput): Promise<{ hits: GcsContentHit[]; total: number } | null> {
    if (!(await this.active("search")).some((s) => s.def.key === key)) return null;
    return this.searchers.get(key)!(actor, input);
  }

  /** Sursele fluxului de activitate pornite, cu funcțiile lor (indexul = poziția stabilă din cursor). */
  async streamSources(): Promise<{ index: number; key: string; icon: string; labelKey: string; run: GcsContentStreamHandler }[]> {
    const all = this.deps.registry.contentSources().filter((s) => s.def.stream === true);
    const on = new Set((await this.active("stream")).map((s) => s.def.key));
    return all.flatMap((s, index) => (on.has(s.def.key) ? [{ index, key: s.def.key, icon: s.def.icon, labelKey: s.def.labelKey, run: this.streams.get(s.def.key)! }] : []));
  }
}
