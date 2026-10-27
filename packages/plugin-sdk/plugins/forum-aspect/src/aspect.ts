import type { GcsPluginForumNode } from "../../../src/index";

/** Starea unui server de joc legat de un forum (`ctx.api.servers.byForums`). */
export type GcsServerState = { serverId: number; name: string; online: boolean; players: number; maxPlayers: number };

/** Insigna unui subforum în lista rândului părinte: eticheta (cheia de text), tonul temei și, la servere, tooltip-ul. */
export type GcsSubBadge = { label: "badge.on" | "badge.off" | "badge.new"; tone: "ok" | "neutral" | "accent"; server: GcsServerState | null };

const FILE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Insigna unui subforum (alegerea lui din tabul „Aspect”): manual ON / OFF / NOU, nimic, sau „automat” după starea
 * serverului legat de el (aplicația Servere); automat fără server legat = nimic.
 */
export function subBadge(data: Record<string, unknown>, server: GcsServerState | undefined): GcsSubBadge | null {
  const mode = str(data.badge) || "auto";
  if (mode === "on") return { label: "badge.on", tone: "ok", server: null };
  if (mode === "off") return { label: "badge.off", tone: "neutral", server: null };
  if (mode === "new") return { label: "badge.new", tone: "accent", server: null };
  if (mode === "auto" && server) return server.online ? { label: "badge.on", tone: "ok", server } : { label: "badge.off", tone: "neutral", server };
  return null;
}

/** Subforumurile (din toate rândurile listei) care așteaptă insigna automată: pentru o singură cerere a stării serverelor. */
export function autoBadgeForums(nodes: GcsPluginForumNode[]): number[] {
  return [...new Set(nodes.flatMap((n) => (n.children ?? []).filter((c) => (str(c.data.badge) || "auto") === "auto").map((c) => c.id)))];
}

/**
 * Fundalul moștenit (setarea „Subforumurile moștenesc fundalul”): un forum fără imaginea lui, sub un forum (nu o
 * categorie) cu imagine și moștenirea pornită, primește imaginea, varianta deschisă, stilul, punctul de interes și
 * voalul părintelui. `null` = nimic de moștenit.
 */
export function inheritedStyle(node: GcsPluginForumNode): { classes: string[]; vars: Record<string, string> } | null {
  const parent = node.parent;
  if (!parent || parent.type === "CATEGORY" || node.type === "CATEGORY") return null;
  if (FILE_ID.test(str(node.data.bg))) return null;
  const p = parent.data;
  const bg = str(p.bg);
  if (!FILE_ID.test(bg) || p.inherit === false) return null;
  const classes = ["gcs-forumRow--image"];
  if (p.bgStyle === "right") classes.push("gcs-forumRow--image-right");
  if (p.noMobile === true) classes.push("gcs-forumRow--imageDesktop");
  const vars: Record<string, string> = {
    "--gcs-forum-row-image": `url("/files/${bg}")`,
    "--gcs-forum-row-veil": `${num(p.veil, 80)}%`,
    "--gcs-forum-row-veil-hover": `${num(p.veilHover, 65)}%`,
  };
  if (FILE_ID.test(str(p.bgLight))) vars["--gcs-forum-row-image-light"] = `url("/files/${str(p.bgLight)}")`;
  if (["left", "center", "right"].includes(str(p.bgFocus))) vars["--gcs-forum-row-image-pos"] = str(p.bgFocus);
  return { classes, vars };
}
