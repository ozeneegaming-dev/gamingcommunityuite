import { blockPermission, GCS_BLOCK_TYPES, GCS_HIDDEN_MODES, type GcsActor, type GcsBlockType, type GcsHiddenPart, type GcsPermissionService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";

/** Cine vede pagina: vizitatorul, grupurile lui, dacă a răspuns în topic (sau e moderator) și dacă e autorul postării. */
export type GcsHiddenViewer = { userId: string | null; groupIds: number[]; replied: boolean; isAuthor: boolean };

/** Textele marcajului unui bloc ascuns încă închis (în limba vizitatorului). */
export type GcsHiddenLabels = { reply: string; members: string; groups: string; title: string };

const LABELS: Record<string, GcsHiddenLabels> = {
  ro: { title: "Conținut ascuns", reply: "Vizibil după ce răspunzi în acest topic.", members: "Vizibil doar membrilor logați.", groups: "Vizibil doar anumitor grupuri." },
  en: { title: "Hidden content", reply: "Visible after you reply in this topic.", members: "Visible to signed-in members only.", groups: "Visible to certain groups only." },
  de: { title: "Versteckter Inhalt", reply: "Sichtbar, nachdem du in diesem Thema antwortest.", members: "Nur für angemeldete Mitglieder sichtbar.", groups: "Nur für bestimmte Gruppen sichtbar." },
  es: { title: "Contenido oculto", reply: "Visible después de responder en este tema.", members: "Visible solo para miembros conectados.", groups: "Visible solo para ciertos grupos." },
  fr: { title: "Contenu masqué", reply: "Visible après avoir répondu dans ce sujet.", members: "Visible uniquement par les membres connectés.", groups: "Visible uniquement par certains groupes." },
  ru: { title: "Скрытый контент", reply: "Видно после ответа в этой теме.", members: "Видно только вошедшим участникам.", groups: "Видно только определённым группам." },
};

export const hiddenLabels = (locale: string | undefined): GcsHiddenLabels => LABELS[locale ?? "ro"] ?? LABELS.ro!;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Părțile ascunse salvate (`posts.hiddenParts`), verificate (o valoare stricată = nicio parte). */
export function parseHiddenParts(raw: unknown): GcsHiddenPart[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): GcsHiddenPart[] => {
    if (!p || typeof p !== "object") return [];
    const x = p as Record<string, unknown>;
    if (typeof x.id !== "string" || !/^h\d{1,4}$/.test(x.id) || typeof x.html !== "string" || !(GCS_HIDDEN_MODES as readonly string[]).includes(String(x.mode))) return [];
    const groups = Array.isArray(x.groups) ? x.groups.filter((g): g is number => Number.isSafeInteger(g)) : [];
    return [{ id: x.id, mode: x.mode as GcsHiddenPart["mode"], groups, label: typeof x.label === "string" ? x.label : null, html: x.html }];
  });
}

/** Poate vizitatorul vedea un bloc ascuns? Autorul postării îl vede mereu. */
export function canSeeHidden(part: Pick<GcsHiddenPart, "mode" | "groups">, viewer: GcsHiddenViewer): boolean {
  if (viewer.isAuthor) return true;
  switch (part.mode) {
    case "members":
      return viewer.userId !== null;
    case "reply":
      return viewer.userId !== null && viewer.replied;
    case "groups":
      return viewer.userId !== null && part.groups.some((g) => viewer.groupIds.includes(g));
  }
}

/**
 * HTML-ul unei postări pentru un vizitator (Forum v2, blocul „conținut ascuns”): fiecare marcaj `gcs-hiddenBlock`
 * primește conținutul lui (deja sanitizat la salvare) dacă vizitatorul îl poate vedea, altfel caseta închisă cu motivul.
 */
export function revealHidden(html: string, rawParts: unknown, viewer: GcsHiddenViewer & { labels?: GcsHiddenLabels }): string {
  if (!html.includes("gcs-hiddenBlock")) return html;
  const parts = new Map(parseHiddenParts(rawParts).map((p) => [p.id, p]));
  const labels = viewer.labels ?? LABELS.ro!;
  return html.replace(/<div class="gcs-hiddenBlock" data-hidden-id="(h\d{1,4})" data-hidden-mode="(reply|members|groups)"><\/div>/g, (_m, id: string, mode: string) => {
    const part = parts.get(id);
    const title = esc(part?.label ?? labels.title);
    if (part && canSeeHidden(part, viewer)) {
      return `<div class="gcs-hiddenBlock gcs-hiddenBlock--open" data-hidden-mode="${mode}"><div class="gcs-hiddenBlock__head">${title}</div><div class="gcs-hiddenBlock__body">${part.html}</div></div>`;
    }
    const why = mode === "reply" ? labels.reply : mode === "members" ? labels.members : labels.groups;
    return `<div class="gcs-hiddenBlock gcs-hiddenBlock--locked" data-hidden-mode="${mode}" data-testid="gcs-hidden-locked"><div class="gcs-hiddenBlock__head">${title}</div><p class="gcs-hiddenBlock__why">${esc(why)}</p></div>`;
  });
}

/**
 * Familiile de blocuri pe care le poate folosi un autor (permisiunile de grup `forums.block_*`). Blocul HTML cere în plus
 * grupul Root Admin (nicio permisiune dată greșit altui grup nu deschide HTML brut). `keep`: un document vechi (la o
 * editare), ale cărui blocuri rămân permise (un moderator fără drepturi pe blocuri poate corecta textul).
 */
export async function allowedBlocks(deps: { db: PrismaClient; permissions: GcsPermissionService }, actor: GcsActor, keep?: unknown): Promise<GcsBlockType[]> {
  if (!actor.userId) return [];
  const values = await Promise.all(GCS_BLOCK_TYPES.map((t) => deps.permissions.groupValue<boolean | number>(actor, blockPermission(t))));
  const out = GCS_BLOCK_TYPES.filter((_t, i) => values[i] === true);
  if (out.includes("html")) {
    const root = await deps.db.group.findFirst({ where: { key: "root_admin", id: { in: actor.groupIds } }, select: { id: true } });
    if (!root) out.splice(out.indexOf("html"), 1);
  }
  for (const t of blocksIn(keep)) if (!out.includes(t)) out.push(t);
  return out;
}

const NODE_BLOCK: Record<string, GcsBlockType> = {
  gcsSection: "section",
  gcsCallout: "callout",
  gcsCardGrid: "cards",
  gcsCard: "cards",
  gcsButton: "button",
  gcsColumns: "columns",
  gcsColumn: "columns",
  gcsSteps: "steps",
  gcsStep: "steps",
  gcsProgress: "progress",
  gcsHidden: "hidden",
  gcsHtml: "html",
};

/** Familiile de blocuri dintr-un document (JSON-ul editorului). */
export function blocksIn(doc: unknown): GcsBlockType[] {
  const found = new Set<GcsBlockType>();
  const walk = (n: unknown, depth: number) => {
    if (depth > 30 || !n || typeof n !== "object") return;
    const node = n as { type?: unknown; content?: unknown };
    const t = typeof node.type === "string" ? NODE_BLOCK[node.type] : undefined;
    if (t) found.add(t);
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(doc, 0);
  return [...found];
}
