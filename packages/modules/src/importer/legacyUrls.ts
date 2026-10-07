import type { GcsImportSchema } from "./types";

/** O adresă veche recunoscută: tipul, id-ul din sursă și, la topicuri, pagina veche. */
export type GcsLegacyTarget = { kind: "topic" | "forum" | "member" | "post"; id: string; page?: number; slug?: string };

const int = (s: string | undefined | null) => (s && /^\d{1,15}$/.test(s) ? s : null);

function coreSchemaPath(path: string, params: URLSearchParams): GcsLegacyTarget | null {
  let m = /^\/topic\/(\d{1,15})(?:-([^/]*))?\/?(?:page\/(\d{1,6})\/?)?$/.exec(path);
  if (m) {
    const comment = params.get("do") === "findComment" ? int(params.get("comment")) : null;
    if (comment) return { kind: "post", id: comment };
    const page = Number(m[3] ?? params.get("page") ?? 1);
    return { kind: "topic", id: m[1]!, slug: m[2] ?? "", ...(page > 1 ? { page } : {}) };
  }
  m = /^\/forum\/(\d{1,15})(?:-([^/]*))?\/?(?:page\/\d{1,6}\/?)?$/.exec(path);
  if (m) return { kind: "forum", id: m[1]!, slug: m[2] ?? "" };
  m = /^\/profile\/(\d{1,15})(?:-[^/]*)?\/?(?:[a-z]+\/?)?$/.exec(path);
  if (m) return { kind: "member", id: m[1]! };
  return null;
}

function coreSchemaQuery(params: URLSearchParams): GcsLegacyTarget | null {
  const showtopic = int(params.get("showtopic"));
  if (showtopic) {
    const pid = int(params.get("p")) ?? int(params.get("view") === "findpost" ? params.get("p") : null);
    return pid ? { kind: "post", id: pid } : { kind: "topic", id: showtopic };
  }
  const showforum = int(params.get("showforum"));
  if (showforum) return { kind: "forum", id: showforum };
  const showuser = int(params.get("showuser"));
  if (showuser) return { kind: "member", id: showuser };
  const controller = params.get("controller");
  const idParam = int(params.get("id"));
  if (idParam && controller === "topic") return { kind: "topic", id: idParam };
  if (idParam && controller === "forums") return { kind: "forum", id: idParam };
  if (idParam && controller === "profile") return { kind: "member", id: idParam };
  return null;
}

function prefixedSchemaPath(path: string): GcsLegacyTarget | null {
  let m = /^\/threads\/(?:([^/]*)\.)?(\d{1,15})\/post-(\d{1,15})\/?$/.exec(path);
  if (m) return { kind: "post", id: m[3]! };
  m = /^\/threads\/(?:([^/]*)\.)?(\d{1,15})\/?(?:page-(\d{1,6})\/?)?(?:unread\/?|latest\/?)?$/.exec(path);
  if (m) {
    const page = Number(m[3] ?? 1);
    return { kind: "topic", id: m[2]!, slug: m[1] ?? "", ...(page > 1 ? { page } : {}) };
  }
  m = /^\/posts\/(\d{1,15})\/?$/.exec(path);
  if (m) return { kind: "post", id: m[1]! };
  m = /^\/forums\/(?:([^/]*)\.)?(\d{1,15})\/?(?:page-\d{1,6}\/?)?$/.exec(path);
  if (m) return { kind: "forum", id: m[2]! };
  m = /^\/members\/(?:[^/]*\.)?(\d{1,15})\/?$/.exec(path);
  if (m) return { kind: "member", id: m[1]! };
  return null;
}

/**
 * Recunoaște o adresă a site-ului vechi (calea fără prefixul vechi și query string-ul):
 * - `core-schema`: `/topic/123-titlu/` (`/page/4/`, `?page=4`, `?do=findComment&comment=456`), `/forum/5-nume/`,
 *   `/profile/7-nume/`, cu sau fără `index.php?`, plus formele vechi `?showtopic=`, `?showforum=`, `?showuser=`;
 * - `prefixed-schema`: `/threads/titlu.123/` (`page-4`, `post-456`), `/posts/456/`, `/forums/nume.5/`, `/members/nume.7/`,
 *   cu sau fără `index.php?`.
 */
export function matchLegacyPath(schema: GcsImportSchema, pathname: string, search = ""): GcsLegacyTarget | null {
  let path = pathname.replace(/\/{2,}/g, "/");
  let query = search.startsWith("?") ? search.slice(1) : search;
  // `index.php?/topic/…` (core) și `index.php?threads/…` (prefixed): calea e în query string.
  if (/\/index\.php$/i.test(path) || path === "/index.php" || path === "/" || path === "") {
    const [first, ...rest] = query.split("&");
    if (first && (first.startsWith("/") || /^(threads|forums|members|posts|topic|forum|profile)\//.test(first)) && !first.includes("=")) {
      let decoded = first;
      try {
        decoded = decodeURIComponent(first);
      } catch {
        // Un `%` stricat: calea rămâne cum e.
      }
      path = `/${decoded.replace(/^\/+/, "")}`;
      query = rest.join("&");
    } else {
      path = "";
    }
  }
  const params = new URLSearchParams(query);
  if (schema === "core-schema") return (path ? coreSchemaPath(path, params) : null) ?? (path === "" ? coreSchemaQuery(params) : null);
  return path ? prefixedSchemaPath(path) : null;
}

/** Calea veche relativă la prefixul site-ului vechi (`/forum/topic/1-x/` cu prefixul `/forum` → `/topic/1-x/`); altfel `null`. */
export function stripLegacyPrefix(pathname: string, prefix: string): string | null {
  const p = normalizePrefix(prefix);
  if (!p) return pathname;
  if (pathname === p) return "/";
  return pathname.startsWith(`${p}/`) ? pathname.slice(p.length) : null;
}

/** Prefixul căii vechi, fără `/` la final (`""` = rădăcina). */
export function normalizePrefix(prefix: string): string {
  const p = prefix.trim().replace(/\/+$/, "");
  if (!p) return "";
  return p.startsWith("/") ? p : `/${p}`;
}
