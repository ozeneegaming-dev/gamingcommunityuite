/**
 * Ajutoarele HTML: escaparea, atributele, iconițele, textul mesajelor (paragrafe și linkuri) și datele. HTML-ul trece
 * oricum prin sanitizer-ul GCS, dar îl generăm deja curat: tot textul venit de la membri e escapat.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, (c) => ESC[c]!);

/** Atributele unui element (`null` / `false` lipsesc, `true` = atribut fără valoare). */
export function attrs(map: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
}

/** O iconiță Font Awesome (GCS o transformă în SVG). */
export const icon = (name: string) => `<gcs-icon name="${esc(name)}"></gcs-icon>`;

const URL_RE = /\bhttps?:\/\/[^\s<>"']{2,500}/g;

/** Un rând de text cu linkurile `http(s)` făcute clicabile (punctuația de la final rămâne în afara linkului). */
function linkify(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    let url = m[0];
    const trail = /[.,;:!?)\]]+$/.exec(url)?.[0] ?? "";
    url = url.slice(0, url.length - trail.length);
    out += esc(line.slice(last, m.index)) + `<a href="${esc(url)}">${esc(url)}</a>` + esc(trail);
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}

/** Textul unui mesaj ca paragrafe (un rând gol desparte paragrafele, un rând nou devine `<br>`). */
export function formatText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.split("\n").map(linkify).join("<br>")}</p>`)
    .join("");
}

/** Data în limba vizitatorului (ex. „11 oct. 2026, 14:05”). */
export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Cât timp a trecut (ex. „acum 5 minute”), față de `now`. */
export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const sec = Math.round((d - now) / 1000);
  const abs = Math.abs(sec);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60 ? [sec, "second"] : abs < 3600 ? [Math.round(sec / 60), "minute"] : abs < 86400 ? [Math.round(sec / 3600), "hour"] : abs < 2592000 ? [Math.round(sec / 86400), "day"] : [Math.round(sec / 2592000), "month"];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
  } catch {
    return formatDate(iso, locale);
  }
}

/** `<time>` cu data completă în `title` și timpul relativ afișat. */
export function timeTag(iso: string, locale: string): string {
  return `<time${attrs({ datetime: iso, title: formatDate(iso, locale) })}>${esc(relativeTime(iso, locale))}</time>`;
}

/** Durata scurt (ex. „2 h 15 min”), pentru timpul mediu de răspuns; unitățile vin traduse. */
export function formatDuration(seconds: number, units: { min: string; h: string; d: string } = { min: "min", h: "h", d: "d" }): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} ${units.min}`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} ${units.h} ${m % 60} ${units.min}` : `${h} ${units.h}`;
  return `${Math.round(h / 24)} ${units.d}`;
}
