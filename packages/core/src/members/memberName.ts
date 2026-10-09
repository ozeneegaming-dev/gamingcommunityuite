/**
 * Numele unui membru, la fel peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): un singur markup pentru
 * numele stilizat, folosit de componenta React `GcsMemberName` (`@gcs/ui`), de șabloane (`{% username %}`), de
 * pluginuri și de HTML-ul salvat (mențiunile). Fără dependențe: se folosește și în client.
 *
 * - linkul spre profil: `<a class="gcs-userLink gcs-name gcs-name--<cheie>" data-user-id data-text href>`; fără link
 *   (titlul profilului, meniul userului): `<span class="gcs-name gcs-name--<cheie>" data-name-user data-text>`;
 * - `data-text` (numele) îl folosesc efectele care dublează textul în straturi (`content: attr(data-text)`);
 * - `size: "full"` (`data-name-fx="full"`): locurile mari (postbit, profil, hover card, meniul userului), cu
 *   decorațiile efectului; implicit, varianta „inline” pentru liste dense: culoarea și animația ușoară;
 * - `letters`: efectele pe litere (ale membrilor care le-au ales). Textul simplu rămâne în `.gcs-name__t` (numele
 *   accesibil și textul copiat), iar literele desenate sunt în `.gcs-name__ls`, ascunse cititoarelor de ecran
 *   (`aria-hidden`); fiecare literă e un `<b>` gol, cu litera în `data-c` (desenată din CSS, `::before`), deci nu se
 *   dublează nici textul elementului.
 */

export type GcsMemberNameSize = "inline" | "full";

/**
 * Prefixul regulilor generate pentru nume (`/gcs-names.css`: stilurile grupurilor, efectele membrilor, stilurile
 * pluginurilor). `:is()` ia specificitatea celui mai specific argument, deci `#gcs-names` (un id care nu există) îi dă
 * specificitatea unui ID, iar `.gcs-root` (elementul `body`) îl face să se potrivească: orice regulă de temă sau de
 * pagină scrisă pe clase (Nova, Clasic, CSS-ul temei) pierde în fața stilului numelui, fără `!important`.
 */
export const NAME_SCOPE = ":is(.gcs-root,#gcs-names)";

export type GcsMemberNameInput = {
  id?: string | null;
  name: string;
  /** Cheia stilului: `gcs-name--<cheie>` (stilul ales, grupul afișat sau grupul principal). */
  nameKey?: string | null;
  /** Linkul profilului; fără el, numele nu e link (și nu deschide hover card-ul). */
  href?: string | null;
  size?: GcsMemberNameSize;
  /** Literele separate (efectele pe litere). */
  letters?: boolean;
  /** Textul la hover (`title`), ex. numele întreg când e tăiat în hover card. */
  title?: string | null;
  /** `false`: linkul nu deschide hover card-ul (numele din hover card): `data-name-user` în loc de `data-user-id`. */
  hoverCard?: boolean;
  /** Clase în plus (ale locului: `gcs-hoverCard__name`, `gcs-mention`…). */
  className?: string | null;
};

export type GcsMemberNameParts = {
  tag: "a" | "span";
  className: string;
  attrs: Record<string, string>;
  /** Literele (`data-c`), dacă se desenează pe litere. */
  letters: string[] | null;
};

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CLASS_RE = /^[A-Za-z0-9_ -]{0,160}$/;
/** Peste atâtea litere, numele rămâne întreg (efectul pe litere ar fi prea scump). */
export const MEMBER_NAME_MAX_LETTERS = 40;
/** Spațiul dintre cuvinte, ca literă: un spațiu care nu se strânge. */
const NBSP = " ";

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

/** Literele (grafemele) unui nume, cu spațiile ca spații fixe; `null` dacă numele e gol sau prea lung. */
export function nameLetters(name: string): string[] | null {
  if (segmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: "grapheme" }) => Segmenter }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  }
  const list = segmenter ? Array.from(segmenter.segment(name), (s) => s.segment) : Array.from(name);
  if (list.length === 0 || list.length > MEMBER_NAME_MAX_LETTERS) return null;
  return list.map((c) => (/^\s+$/.test(c) ? NBSP : c));
}

/** Clasele, atributele și literele numelui (aceleași în React și în HTML). */
export function memberNameParts(input: GcsMemberNameInput): GcsMemberNameParts {
  const key = input.nameKey && KEY_RE.test(input.nameKey) ? input.nameKey : "member";
  const id = input.id && ID_RE.test(input.id) ? input.id : null;
  const link = typeof input.href === "string" && input.href !== "";
  const extra = input.className && CLASS_RE.test(input.className) ? input.className.trim() : "";
  const className = [link ? "gcs-userLink" : "", "gcs-name", `gcs-name--${key}`, extra].filter(Boolean).join(" ");
  const attrs: Record<string, string> = {};
  if (link) attrs.href = input.href!;
  if (input.title) attrs.title = input.title;
  if (id) attrs[link && input.hoverCard !== false ? "data-user-id" : "data-name-user"] = id;
  attrs["data-text"] = input.name;
  if (input.size === "full") attrs["data-name-fx"] = "full";
  const letters = input.letters ? nameLetters(input.name) : null;
  if (letters) attrs["data-name-letters"] = "";
  return { tag: link ? "a" : "span", className, attrs, letters };
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Conținutul numelui: textul simplu și, cu litere, stratul desenat. */
export function memberNameInnerHtml(name: string, letters: string[] | null): string {
  if (!letters) return esc(name);
  const ls = letters.map((c, i) => `<b style="--i:${i}" data-c="${esc(c)}"></b>`).join("");
  return `<span class="gcs-name__t">${esc(name)}</span><span class="gcs-name__ls" aria-hidden="true">${ls}</span>`;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Textul din HTML (entitățile decodate), pentru literele separate. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

/** Un nume în HTML: un element simplu (doar text) cu `data-user-id` sau `data-name-user`. */
const NAME_ELEMENT = /<(a|span|button|strong)\b([^>]*)>([^<]*)<\/\1>/g;
const NAME_ID = /\bdata-(?:user-id|name-user)="([A-Za-z0-9_-]{1,64})"/;
const CLASS_ATTR = /\bclass="([^"]*)"/;
/** Clasele care marchează un nume de membru (linkul, pastila unei mențiuni, componenta comună). */
const NAME_CLASSES = ["gcs-userLink", "gcs-mention", "gcs-name"];

/** Id-urile membrilor din numele unui HTML (ex. mențiunile din conținutul salvat). */
export function memberUserIdsInHtml(html: string): string[] {
  const ids: string[] = [];
  for (const m of html.matchAll(NAME_ELEMENT)) {
    const id = NAME_ID.exec(m[2]!)?.[1];
    const cls = CLASS_ATTR.exec(m[2]!)?.[1]?.split(/\s+/) ?? [];
    if (id && cls.some((c) => NAME_CLASSES.includes(c))) ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Aduce numele dintr-un HTML (conținutul salvat, pluginurile, șabloanele) la markup-ul comun: clasa `gcs-name` și
 * cheia stilului (`keys`: grupul afișat de acum, dacă elementul nu are deja una), `data-text` și, pentru membrii din
 * `letters`, literele separate. Restul HTML-ului rămâne neatins (e deja sanitizat).
 */
export function decorateMemberNamesHtml(html: string, opts: { keys?: ReadonlyMap<string, string>; letters?: ReadonlySet<string> }): string {
  return html.replace(NAME_ELEMENT, (whole, tag: string, attrs: string, inner: string) => {
    const id = NAME_ID.exec(attrs)?.[1];
    const cm = CLASS_ATTR.exec(attrs);
    const classes = cm ? cm[1]!.split(/\s+/).filter(Boolean) : [];
    if (!id || !classes.some((c) => NAME_CLASSES.includes(c))) return whole;
    const add: string[] = [];
    if (!classes.includes("gcs-name")) add.push("gcs-name");
    const key = opts.keys?.get(id);
    if (key && KEY_RE.test(key) && !classes.some((c) => c.startsWith("gcs-name--"))) add.push(`gcs-name--${key}`);
    let next = attrs;
    if (add.length > 0) next = next.replace(CLASS_ATTR, `class="${[...classes, ...add].join(" ")}"`);
    if (!/\bdata-text="/.test(next)) next += ` data-text="${inner.replace(/"/g, "&quot;")}"`;
    let body = inner;
    if (opts.letters?.has(id) && !/\bdata-name-letters\b/.test(next)) {
      const text = decodeEntities(inner);
      const letters = nameLetters(text);
      if (letters) {
        next += " data-name-letters";
        body = memberNameInnerHtml(text, letters);
      }
    }
    return `<${tag}${next}>${body}</${tag}>`;
  });
}

/** Numele ca HTML (șabloane, pluginuri, conținutul salvat). */
export function memberNameHtml(input: GcsMemberNameInput): string {
  if (!input.name) return "";
  const p = memberNameParts(input);
  const attrs = Object.entries(p.attrs)
    .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
  return `<${p.tag} class="${esc(p.className)}"${attrs}>${memberNameInnerHtml(input.name, p.letters)}</${p.tag}>`;
}
