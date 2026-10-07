/**
 * Formularele trimise spre rutele API ale pluginurilor (specul Studio VIP §2.3): câmpurile devin un obiect JSON pentru
 * plugin. Numele repetate (checkbox-uri, liste) devin liste, numele nesigure se ignoră, valorile sunt limitate.
 */
const FIELD = /^[A-Za-z][A-Za-z0-9_.:-]{0,59}$/;
export const PLUGIN_FORM_MAX_FIELDS = 800;
export const PLUGIN_FORM_MAX_VALUE = 20_000;
/** Câte fișiere poate avea un formular de pe site (ex. ramă + previzualizare, video + poster). */
export const PLUGIN_FORM_MAX_FILES = 4;
/**
 * Câte fișiere poate avea un formular trimis spre o rută ACP a pluginului (încărcarea în bloc a cataloagelor, ex. 50 de
 * rame odată). Corpul întreg are limita `PLUGIN_FORM_ACP_MAX_BYTES`; limita de rată a încărcărilor ACP rămâne.
 */
export const PLUGIN_FORM_ACP_MAX_FILES = 50;
/**
 * Corpul maxim al unui formular `multipart` spre o rută ACP: 48 MB (sub limita proxy-ului Next de 64 MB și sub cei
 * 50 MB ai nginx-ului din instalarea standard). Un lot mai mare se împarte în mai multe încărcări.
 */
export const PLUGIN_FORM_ACP_MAX_BYTES = 48 * 1024 * 1024;
/** Un formular urlencoded (fără fișiere) are aceeași limită ca un corp JSON. */
export const PLUGIN_FORM_MAX_BYTES = 64 * 1024;

export function isPluginFormField(name: string): boolean {
  return FIELD.test(name);
}

/**
 * Câmpurile unui formular ca obiect. Valorile text se taie la `PLUGIN_FORM_MAX_VALUE` caractere; cel mult
 * `PLUGIN_FORM_MAX_FIELDS` valori. Valorile ne-text (fișierele deja verificate de nucleu) trec așa cum sunt.
 */
export function pluginFormBody(entries: Iterable<[string, unknown]>): Record<string, unknown> {
  const out = new Map<string, unknown>();
  let count = 0;
  for (const [name, raw] of entries) {
    if (!FIELD.test(name)) continue;
    if (++count > PLUGIN_FORM_MAX_FIELDS) break;
    const value = typeof raw === "string" ? raw.slice(0, PLUGIN_FORM_MAX_VALUE) : raw;
    const prev = out.get(name);
    if (prev === undefined) out.set(name, value);
    else if (Array.isArray(prev)) prev.push(value);
    else out.set(name, [prev, value]);
  }
  return Object.fromEntries(out);
}

/**
 * Pagina de unde a venit formularul (`Referer`), dacă e una a pluginului (site sau ACP): acolo se întoarce browserul
 * când pluginul nu cere altă adresă. Doar calea și query-ul, pe aceeași origine.
 */
export function pluginFormReturn(referer: string | null, origin: string, pluginKey: string): string | null {
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const target = `${url.pathname}${url.search}`;
  const inside = (prefix: string) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
  if (!(inside(`/p/${pluginKey}`) || inside(`/admin/plugins/${pluginKey}`))) return null;
  return /^[A-Za-z0-9._~/?=&%:-]+$/.test(target) && !target.includes("..") ? target : null;
}
