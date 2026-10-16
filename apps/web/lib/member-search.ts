import { GCS_ACP_MEMBER_SORTS, GCS_LOGIN_METHODS, GCS_MEMBER_QUICK_FILTERS, type GcsAcpMemberSort, type GcsMemberListQuery, type GcsMemberQuickFilter, type GcsMemberSearch } from "@gcs/core";

/**
 * Căutarea din ACP → Membri (Membri v2) în adresa paginii: filtrul rapid, căutarea avansată, sortarea și pagina. Aceleași
 * parametri merg la exportul CSV și la acțiunile în masă pe „toți cei filtrați”.
 */
export type GcsMemberSearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const int = (v: string): number | undefined => (/^\d{1,9}$/.test(v) ? Number(v) : undefined);
const date = (v: string, endOfDay = false): Date | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Parametrii adresei → interogarea listei (valorile invalide se ignoră). */
export function parseMemberSearch(sp: GcsMemberSearchParams): GcsMemberListQuery {
  const q: GcsMemberListQuery = { page: Math.max(1, int(one(sp.page)) ?? 1) };
  const text = one(sp.q);
  if (text) q.q = text.slice(0, 100);
  const quick = one(sp.quick);
  if ((GCS_MEMBER_QUICK_FILTERS as readonly string[]).includes(quick)) q.quick = quick as GcsMemberQuickFilter;
  const group = int(one(sp.group));
  if (group) q.groupId = group;
  const scope = one(sp.scope);
  if (scope === "primary" || scope === "secondary") q.groupScope = scope;
  const ip = one(sp.ip);
  if (ip && /^[0-9a-fA-F.:]{1,45}$/.test(ip)) q.ip = ip;
  const login = one(sp.login);
  if ((GCS_LOGIN_METHODS as readonly string[]).includes(login)) q.loginMethod = login as GcsMemberSearch["loginMethod"];
  const tfa = one(sp.tfa);
  if (tfa === "on" || tfa === "off") q.twoFactor = tfa === "on";
  const country = one(sp.country);
  if (/^[A-Za-z]{2}$/.test(country)) q.country = country.toUpperCase();
  const jf = date(one(sp.joinedFrom));
  if (jf) q.joinedFrom = jf;
  const jt = date(one(sp.joinedTo), true);
  if (jt) q.joinedTo = jt;
  const af = date(one(sp.activeFrom));
  if (af) q.activeFrom = af;
  const at = date(one(sp.activeTo), true);
  if (at) q.activeTo = at;
  const rank = int(one(sp.rank));
  if (rank) q.rankId = rank;
  const pmin = int(one(sp.postsMin));
  if (pmin !== undefined) q.postsMin = pmin;
  const pmax = int(one(sp.postsMax));
  if (pmax !== undefined) q.postsMax = pmax;
  const sort = one(sp.sort);
  if ((GCS_ACP_MEMBER_SORTS as readonly string[]).includes(sort)) q.sort = sort as GcsAcpMemberSort;
  const dir = one(sp.dir);
  if (dir === "asc" || dir === "desc") q.dir = dir;
  return q;
}

const ymd = (d: Date | undefined) => (d ? d.toISOString().slice(0, 10) : undefined);

/** Interogarea → parametrii adresei (fără valorile goale); `page` doar peste 1. */
export function memberSearchParams(q: Partial<GcsMemberListQuery>): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== "") p.set(k, String(v));
  };
  set("q", q.q);
  set("quick", q.quick);
  set("group", q.groupId);
  set("scope", q.groupId ? q.groupScope : undefined);
  set("ip", q.ip);
  set("login", q.loginMethod);
  set("tfa", q.twoFactor === undefined ? undefined : q.twoFactor ? "on" : "off");
  set("country", q.country);
  set("joinedFrom", ymd(q.joinedFrom));
  set("joinedTo", ymd(q.joinedTo));
  set("activeFrom", ymd(q.activeFrom));
  set("activeTo", ymd(q.activeTo));
  set("rank", q.rankId);
  set("postsMin", q.postsMin);
  set("postsMax", q.postsMax);
  set("sort", q.sort);
  set("dir", q.dir);
  if (q.page && q.page > 1) set("page", q.page);
  return p;
}

/** Câte criterii de căutare avansată sunt active (insigna de pe „Căutare avansată”). */
export function advancedCount(q: GcsMemberSearch): number {
  return [q.groupId, q.ip, q.loginMethod, q.twoFactor, q.country, q.joinedFrom ?? q.joinedTo, q.activeFrom ?? q.activeTo, q.postsMin ?? q.postsMax, q.rankId].filter((v) => v !== undefined).length;
}
