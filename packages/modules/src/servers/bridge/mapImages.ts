/**
 * Imaginile hărților (specul 2026-10-08-servere-bridge §13), partea fără dependențe (rulează și în browser, ex.
 * previzualizarea din ACP): numele validat al hărții, șablonul de adresă pe joc (`https://…/{map}.jpg`), adresa unei
 * hărți după șablon și originile pentru `img-src` din CSP.
 *
 * Două moduri pe joc: `direct` (implicit) = browserul încarcă imaginea chiar de la adresa șablonului, nimic nu se
 * descarcă sau stochează pe site; `copy` = jobul `servers.bridge.maps` o aduce (descărcarea gardată) și o păstrează.
 * Ordinea imaginilor: bannerul serverului > imaginea încărcată în ACP > șablonul (direct sau copiat) > arta GCS.
 */

export const MAP_IMAGE_MODES = ["direct", "copy"] as const;
export type GcsMapImageMode = (typeof MAP_IMAGE_MODES)[number];
export const DEFAULT_MAP_IMAGE_MODE: GcsMapImageMode = "direct";
export const isMapImageMode = (v: unknown): v is GcsMapImageMode => (MAP_IMAGE_MODES as readonly unknown[]).includes(v);

/** Lungimea maximă a unui șablon și semnul înlocuit cu numele hărții. */
export const MAP_TEMPLATE_MAX = 500;
export const MAP_TEMPLATE_TOKEN = "{map}";

/** Opțiunile validării: `allowHttp` doar în dezvoltare (în producție, doar https). */
export type GcsMapTemplateOptions = { allowHttp?: boolean };

/** http e permis doar în dezvoltare (`NODE_ENV=development`); în producție și în teste, doar https. */
export const mapTemplateHttpAllowed = (): boolean => process.env.NODE_ENV === "development";

/** Numele unei hărți: litere mici, `[a-z0-9_.-]`, max 64, nu doar puncte; altfel `null`. */
export function cleanMapName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  return /^[a-z0-9_.-]{1,64}$/.test(name) && !/^\.+$/.test(name) ? name : null;
}

/** Adresa artei generice a unui joc (SVG original, cache public o zi). */
export const mapArtUrl = (game: string) => `/api/servers/maps/art/${encodeURIComponent(game)}`;

/** Ruta imaginii unei hărți (redirect la imaginea aleasă de site): pentru hărțile care se schimbă live pe pagină. */
export const mapImageRoute = (game: string, map: string) => `/api/servers/maps/image/${encodeURIComponent(game)}/${encodeURIComponent(map)}`;

/** Caractere care nu au ce căuta într-o adresă de imagine (spații, ghilimele, paranteze unghiulare, acolade în plus). */
const UNSAFE = /[\s"'<>\\`^|{}]/;

function probe(template: string, map: string): URL | null {
  const raw = template.replaceAll(MAP_TEMPLATE_TOKEN, map);
  return URL.canParse(raw) ? new URL(raw) : null;
}

/**
 * Validarea unui șablon (ACP): gol sau o adresă absolută https (http doar în dezvoltare) care conține `{map}` în cale
 * sau în parametri (nu în host: originea trebuie să fie fixă pentru CSP), fără nume / parolă, max 500 de caractere.
 * Întoarce codul erorii (cheie `errors.fields.*`) sau `null`.
 */
export function mapTemplateError(v: unknown, opts: GcsMapTemplateOptions = {}): string | null {
  if (v === "") return null;
  if (typeof v !== "string") return "invalid_map_template";
  if (v.length > MAP_TEMPLATE_MAX) return "map_template_too_long";
  if (!v.includes(MAP_TEMPLATE_TOKEN)) return "map_template_placeholder";
  if (UNSAFE.test(v.replaceAll(MAP_TEMPLATE_TOKEN, ""))) return "invalid_map_template";
  const a = probe(v, "de_dust2");
  const b = probe(v, "cs_office");
  if (!a || !b) return "invalid_map_template";
  if (a.protocol !== "https:" && !(opts.allowHttp && a.protocol === "http:")) return "map_template_https";
  if (a.username || a.password || b.username || b.password) return "map_template_credentials";
  if (!a.hostname || a.origin !== b.origin) return "map_template_placeholder";
  return null;
}

/** Adresa imaginii unei hărți după șablon (numele validat și codat), sau `null` (șablon gol / invalid, nume invalid). */
export function mapTemplateUrl(template: string, map: string, opts: GcsMapTemplateOptions = {}): string | null {
  const name = cleanMapName(map);
  if (!name || !template || mapTemplateError(template, opts) !== null) return null;
  return template.replaceAll(MAP_TEMPLATE_TOKEN, encodeURIComponent(name));
}

/** Originea (`https://host[:port]`) unui șablon valid, sau `null`. */
export function mapTemplateOrigin(template: string, opts: GcsMapTemplateOptions = {}): string | null {
  if (!template || mapTemplateError(template, opts) !== null) return null;
  return probe(template, "de_dust2")?.origin ?? null;
}

/** Originile pentru `img-src` (CSP) ale șabloanelor valide: fără dubluri, sortate, niciodată `*`. */
export function mapImageOrigins(templates: string[], opts: GcsMapTemplateOptions = {}): string[] {
  const origins = new Set<string>();
  for (const t of templates) {
    const origin = mapTemplateOrigin(t, opts);
    if (origin && origin !== "null" && !origin.includes("*")) origins.add(origin);
  }
  return [...origins].sort();
}
