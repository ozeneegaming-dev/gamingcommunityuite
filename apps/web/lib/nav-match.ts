/**
 * Regulile meniului principal, fără React (folosite de header pe server și pe client): linkul activ, itemii ascunși
 * automat, dublurile din sertar și câte butoane încap pe bară („Mai mult”).
 */
export type GcsNavNode<T> = { href: string; children: T[] };

const split = (href: string): [string, string] => {
  const clean = href.split("#")[0]!;
  const at = clean.indexOf("?");
  return at === -1 ? [clean, ""] : [clean.slice(0, at), clean.slice(at + 1)];
};

/**
 * Linkul activ pentru pagina curentă, ales o singură dată pentru tot meniul: dintre linkurile interne a căror cale se
 * potrivește (egală sau prefix; „/” doar exact) și ai căror parametri sunt toți în adresă, câștigă cel cu mai mulți
 * parametri, apoi cel cu calea mai lungă. Pe `/members?online=1`, „Online acum” bate „Toți membrii”.
 */
export function activeNavHref(pathname: string, search: string, hrefs: readonly string[]): string | null {
  const current = new URLSearchParams(search);
  let best: { href: string; params: number; path: number } | null = null;
  for (const href of hrefs) {
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const [path, query] = split(href);
    const matches = path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path.replace(/\/$/, "")}/`);
    if (!matches) continue;
    const params = [...new URLSearchParams(query)];
    if (!params.every(([k, v]) => current.getAll(k).includes(v))) continue;
    if (!best || params.length > best.params || (params.length === best.params && path.length > best.path)) best = { href, params: params.length, path: path.length };
  }
  return best?.href ?? null;
}

/** Linkurile reale ale meniului: itemii fără submeniu și subitemii (un item cu submeniu e doar un buton). */
export function navLinks<T extends GcsNavNode<T>>(items: readonly T[]): string[] {
  return items.flatMap((i) => (i.children.length > 0 ? i.children.map((c) => c.href) : [i.href]));
}

/**
 * Starea activă a meniului: linkul activ, iar un item cu submeniu e activ când unul dintre copii e activ, dar nu și
 * când același link e direct pe primul nivel (ex. Clasament, și în bară, și sub Membri: se aprinde doar butonul lui).
 */
export function navActive<T extends GcsNavNode<T>>(items: readonly T[], pathname: string, search: string): { href: string | null; isActive: (item: T) => boolean } {
  const href = activeNavHref(pathname, search, navLinks(items));
  const topLevel = new Set(items.filter((i) => i.children.length === 0).map((i) => i.href));
  return {
    href,
    isActive: (item) => (item.children.length > 0 ? href !== null && !topLevel.has(href) && item.children.some((c) => c.href === href) : item.href === href),
  };
}

/** Meniul fără itemii cu linkurile date (ex. Reguli, cât timp regulile sunt goale). Un submeniu golit dispare. */
export function withoutHrefs<T extends GcsNavNode<T>>(items: readonly T[], hidden: ReadonlySet<string>): T[] {
  if (hidden.size === 0) return [...items];
  return items.flatMap((i) => {
    if (i.children.length === 0) return hidden.has(i.href) ? [] : [i];
    const children = i.children.filter((c) => !hidden.has(c.href));
    return children.length > 0 ? [{ ...i, children }] : [];
  });
}

/** Pentru sertarul de pe mobil: subitemii care repetă un link de pe primul nivel nu se mai afișează. */
export function withoutDuplicateChildren<T extends GcsNavNode<T>>(items: readonly T[]): T[] {
  const topLevel = new Set(items.filter((i) => i.children.length === 0).map((i) => i.href));
  return items.map((i) => (i.children.length > 0 ? { ...i, children: i.children.filter((c) => !topLevel.has(c.href)) } : i));
}

/**
 * Câte butoane (de la început) încap pe bară: toate, dacă încap toate; altfel câte încap lângă butonul „Mai mult”.
 * `widths` sunt lățimile butoanelor, `gap` spațiul dintre ele, `available` lățimea barei.
 */
export function fitCount(widths: readonly number[], moreWidth: number, gap: number, available: number): number {
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available + 0.5) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const w of widths) {
    if (used + w + gap > available + 0.5) break;
    used += w + gap;
    count++;
  }
  return count;
}
