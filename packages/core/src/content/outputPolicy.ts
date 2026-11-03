/**
 * Politica de afișare a conținutului scris de membri (postări, semnături, profiluri, mesaje private, chat), aplicată la
 * randare peste HTML-ul deja sanitizat, deci și peste conținutul salvat înainte de o schimbare de setări:
 * - linkurile spre alte site-uri primesc `rel="nofollow ugc noopener"` (ACP → Promovare → SEO, `seo.nofollow_external`),
 *   în afară de domeniile din lista albă (`seo.nofollow_exclude`, și subdomeniile lor); linkurile interne nu au nofollow;
 * - imaginile de pe alte site-uri (ACP → Setări → Încărcări și imagini, `uploads.remote_images`) se arată, se arată doar
 *   cele `https:` sau devin un link spre imagine.
 */
export const GCS_REMOTE_IMAGE_MODES = ["allow", "https_only", "block"] as const;
export type GcsRemoteImageMode = (typeof GCS_REMOTE_IMAGE_MODES)[number];

export type GcsContentPolicy = {
  /** Host-ul site-ului (ex. `forum.exemplu.ro`); `www.` în plus sau în minus e tot site-ul. */
  siteHost: string;
  nofollowExternal: boolean;
  /** Domeniile fără nofollow, normalizate (`parseLinkDomains`). */
  nofollowExclude: readonly string[];
  remoteImages: GcsRemoteImageMode;
};

/** Valorile implicite ale setărilor (linkurile externe cu nofollow, imaginile externe afișate). */
export const GCS_DEFAULT_CONTENT_POLICY: Omit<GcsContentPolicy, "siteHost"> = { nofollowExternal: true, nofollowExclude: [], remoteImages: "allow" };

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
/** Câte domenii poate avea lista albă. */
export const DOMAIN_LIST_MAX = 200;

/** Un domeniu scris de admin (`https://www.Exemplu.ro/cale`, `*.exemplu.ro`) → `exemplu.ro`; `null` dacă nu e un domeniu. */
export function normalizeLinkDomain(raw: string): string | null {
  let v = raw.trim().toLowerCase();
  if (v === "") return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\*\./, "");
  v = v.split(/[/?#]/)[0] ?? "";
  v = v.replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN.test(v) ? v : null;
}

/** Lista albă (un domeniu pe rând, sau separate prin virgulă / spațiu), normalizată și fără dubluri. */
export function parseLinkDomains(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const d = normalizeLinkDomain(part);
    if (d) out.add(d);
  }
  return [...out];
}

/** Validarea listei albe: doar domenii, cel mult `DOMAIN_LIST_MAX`, 5000 de caractere. */
export function domainListError(v: unknown): string | null {
  if (typeof v !== "string") return "invalid_type";
  if (v.length > 5000) return "too_long";
  const parts = v.split(/[\s,;]+/).filter((p) => p.trim() !== "");
  if (parts.length > DOMAIN_LIST_MAX) return "too_many";
  return parts.every((p) => normalizeLinkDomain(p) !== null) ? null : "invalid_domain";
}

/** Host-ul fără `www.` și fără port, cu litere mici. */
const bareHost = (host: string) => host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");

/** `host` e domeniul dat sau un subdomeniu al lui. */
export function hostMatches(host: string, domain: string): boolean {
  const h = bareHost(host);
  return h === domain || h.endsWith(`.${domain}`);
}

/** Entitățile pe care sanitizer-ul le pune în atribute. */
function decodeAttr(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Adresa, dacă duce pe alt site (`http:` / `https:` cu alt host); `null` pentru adresele interne și restul. */
export function externalUrl(href: string, siteHost: string): URL | null {
  const value = decodeAttr(href).trim();
  if (!/^https?:\/\//i.test(value) || !URL.canParse(value)) return null;
  const url = new URL(value);
  return bareHost(url.host) === bareHost(siteHost) || bareHost(url.hostname) === bareHost(siteHost) ? null : url;
}

const ATTR = /([^\s=/]+)(?:\s*=\s*"([^"]*)")?/g;
type Attr = { name: string; value: string | null };

function parseAttrs(raw: string): Attr[] {
  const out: Attr[] = [];
  for (const m of raw.matchAll(ATTR)) out.push({ name: m[1]!.toLowerCase(), value: m[2] ?? null });
  return out;
}

const attrText = (attrs: Attr[]) => attrs.map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${a.value}"`)).join("");

/**
 * Valoarea `rel` a unui link: `nofollow ugc` doar pentru un link extern care nu e urmat, `noopener` pentru cele care se
 * deschid în alt tab (sau externe); restul cuvintelor (ex. `noreferrer`) rămân. `null` = fără atribut.
 */
export function linkRel(existing: string | null, opts: { external: boolean; follow: boolean; blank: boolean }): string | null {
  const kept = (existing ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== "" && !["nofollow", "ugc", "sponsored", "noopener"].includes(t));
  const tokens = [...(opts.external && !opts.follow ? ["nofollow", "ugc"] : []), ...(opts.blank || opts.external ? ["noopener"] : []), ...kept];
  return tokens.length > 0 ? [...new Set(tokens)].join(" ") : null;
}

/** Un link extern e urmat (fără nofollow) dacă setarea e oprită sau domeniul e în lista albă. */
function follows(url: URL, policy: GcsContentPolicy): boolean {
  return !policy.nofollowExternal || policy.nofollowExclude.some((d) => hostMatches(url.hostname, d));
}

function rewriteLink(tag: string, rawAttrs: string, policy: GcsContentPolicy): string {
  const attrs = parseAttrs(rawAttrs);
  const href = attrs.find((a) => a.name === "href")?.value;
  if (href === undefined || href === null) return tag;
  const decoded = decodeAttr(href).trim().toLowerCase();
  // `mailto:`, ancore și alte scheme rămân cum sunt.
  if (!decoded.startsWith("/") && !/^https?:\/\//.test(decoded)) return tag;
  const url = externalUrl(href, policy.siteHost);
  const blank = attrs.some((a) => a.name === "target" && a.value === "_blank");
  const relAttr = attrs.find((a) => a.name === "rel");
  const rel = linkRel(relAttr?.value ?? null, { external: url !== null, follow: url === null || follows(url, policy), blank });
  if ((relAttr?.value ?? null) === rel) return tag;
  const next = attrs.filter((a) => a.name !== "rel");
  if (rel !== null) next.push({ name: "rel", value: rel });
  return `<a${attrText(next)}>`;
}

/** O imagine externă afișată ca link (setarea „blocate”, sau `http:` cu „doar HTTPS”). */
function remoteImageLink(src: string, alt: string | null, policy: GcsContentPolicy, url: URL): string {
  const rel = linkRel(null, { external: true, follow: follows(url, policy), blank: true });
  const label = alt && alt.trim() !== "" ? alt : src;
  return `<a class="gcs-remoteImage" href="${src}" target="_blank"${rel ? ` rel="${rel}"` : ""}>${label}</a>`;
}

function rewriteImage(tag: string, rawAttrs: string, policy: GcsContentPolicy): string {
  if (policy.remoteImages === "allow") return tag;
  const attrs = parseAttrs(rawAttrs);
  const src = attrs.find((a) => a.name === "src")?.value;
  if (!src) return tag;
  const url = externalUrl(src, policy.siteHost);
  if (!url) return tag;
  if (policy.remoteImages === "https_only" && url.protocol === "https:") return tag;
  return remoteImageLink(src, attrs.find((a) => a.name === "alt")?.value ?? null, policy, url);
}

const TAG = /<(a|img)\b((?:\s+[^\s=>/]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>/gi;

/**
 * Aplică politica peste HTML-ul sanitizat al unui conținut (atributele sunt mereu între ghilimele duble, iar `<` / `>`
 * din valori sunt escapate de sanitizer). Un HTML fără linkuri sau imagini rămâne neatins.
 */
export function applyContentPolicy(html: string, policy: GcsContentPolicy): string {
  if (!html.includes("<a") && !html.includes("<img") && !html.includes("<A") && !html.includes("<IMG")) return html;
  return html.replace(TAG, (tag, name: string, rawAttrs: string) => (name.toLowerCase() === "a" ? rewriteLink(tag, rawAttrs, policy) : rewriteImage(tag, rawAttrs, policy)));
}

/** Imaginile externe ale chat-ului (embed-urile din linkuri): rămân doar cele pe care politica le arată. */
export function remoteImageShown(src: string, policy: GcsContentPolicy): boolean {
  const url = externalUrl(src, policy.siteHost);
  if (!url || policy.remoteImages === "allow") return true;
  return policy.remoteImages === "https_only" && url.protocol === "https:";
}
