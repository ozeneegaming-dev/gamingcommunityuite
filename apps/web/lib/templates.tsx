import "server-only";
import { DEFAULT_TEMPLATES, defaultTemplate, GcsTemplateError, parseHtmlTree, parseStyleAttribute, type GcsHtmlNode, type GcsTemplateRenderOptions } from "@gcs/core";
import { templateComponents } from "@gcs/modules";
import Link from "next/link";
import { getFormatter, getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { cache, createElement, Fragment, type ReactNode } from "react";
import { currentActor } from "./actor";
import { viewerTheme } from "./appearance";
import { services } from "./services";

/**
 * Șabloanele pe site (specul etapei 6, §3.2): o componentă React întreabă `siteTemplate(cheie, date, sloturi)`; dacă
 * tema viewer-ului a modificat șablonul, primește markup-ul lui (randat pe server, sanitizat, transformat în elemente
 * React), altfel `null` și își randează ieșirea implicită. O eroare în șablon nu strică pagina: revine la React.
 */

/** Suprascrierile temei pe care o vede viewer-ul (în previzualizarea editorului vizual: tema editată), o dată pe request. */
const viewerOverrides = cache(async () => {
  try {
    const { theme } = await viewerTheme();
    return { themeKey: theme.key, overrides: await services().templates.overrides(theme.key) };
  } catch {
    return null;
  }
});

type DateOptions = { dateStyle?: "full" | "long" | "medium" | "short"; timeStyle?: "full" | "long" | "medium" | "short"; year?: "numeric" };
const DATE_STYLES: Record<string, DateOptions> = {
  short: { dateStyle: "short", timeStyle: "short" },
  medium: { dateStyle: "medium", timeStyle: "short" },
  long: { dateStyle: "long", timeStyle: "short" },
  full: { dateStyle: "full", timeStyle: "short" },
  date: { dateStyle: "medium" },
  date_long: { dateStyle: "long" },
  time: { timeStyle: "short" },
  year: { year: "numeric" },
};

/**
 * Opțiunile de randare pe site: textele traduse, formatarea datelor și numerelor (aceeași ca a componentelor, prin
 * next-intl), componentele platformei și variabilele comune (`site`, `viewer`, `locale`). O dată pe request.
 */
export const siteRenderOptions = cache(async (): Promise<{ render: GcsTemplateRenderOptions; common: Record<string, unknown> }> => {
  const [t, format, locale, timeZone, actor] = await Promise.all([getTranslations(), getFormatter(), getLocale(), getTimeZone(), currentActor()]);
  const { settings, db } = services();
  const [siteName, siteUrl, viewer] = await Promise.all([
    settings.get<string>("site.name").catch(() => "GamingCommunitySuite"),
    settings.get<string>("site.url").catch(() => ""),
    actor.userId ? db.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  return {
    render: {
      locale,
      timeZone,
      translate: (key, params) => (t.has(key) ? t(key, params) : key),
      format: {
        date: (d, style) => (style === "iso" ? d.toISOString() : style === "relative" ? format.relativeTime(d, new Date()) : format.dateTime(d, DATE_STYLES[style] ?? DATE_STYLES.medium)),
        number: (n, { decimals, style }) =>
          style === "compact"
            ? format.number(n, { notation: "compact" })
            : style === "percent"
              ? format.number(n, { style: "percent" })
              : format.number(n, decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}),
        relative: (d) => format.relativeTime(d, new Date()),
      },
      components: templateComponents(),
    },
    common: { site: { name: siteName, url: siteUrl }, viewer: { id: viewer?.id ?? null, name: viewer?.name ?? null }, locale },
  };
});

/** Șabloanele parțiale incluse de șablonul implicit (ex. `postbit.fields` în `postbit.author`). */
function partialsOf(key: string): string[] {
  const source = defaultTemplate(key)?.source ?? "";
  return DEFAULT_TEMPLATES.filter((d) => d.partial && source.includes(`"${d.key}"`)).map((d) => d.key);
}

/**
 * HTML-ul sanitizat al unui șablon pe care tema viewer-ului l-a modificat (el sau un șablon parțial inclus de el),
 * sau `null` (nemodificat sau eroare).
 */
export async function siteTemplateHtml(key: string, data: Record<string, unknown>, hooks: Record<string, string> = {}): Promise<string | null> {
  const ctx = await viewerOverrides();
  if (!ctx) return null;
  const own = ctx.overrides[key]?.source;
  if (own === undefined && !partialsOf(key).some((p) => ctx.overrides[p])) return null;
  const source = own ?? defaultTemplate(key)?.source;
  if (source === undefined) return null;
  try {
    const opts = await siteRenderOptions();
    // `{% hook "…" %}`: HTML-ul pluginurilor pentru punctul de extensie, deja sanitizat (calculat de componentă).
    return await services().templates.render(ctx.themeKey, key, { ...opts.common, ...data }, { ...opts.render, source, hook: (name) => hooks[name] ?? "" });
  } catch (error) {
    console.error(`[GCS] șablonul ${key} (tema ${ctx.themeKey}):`, error instanceof GcsTemplateError ? error.message : error);
    return null;
  }
}

/**
 * Markup-ul unui șablon modificat, ca elemente React (cu sloturile puse la locul lor), sau `null` dacă tema
 * viewer-ului nu l-a modificat. Sloturile obligatorii lipsă din șablon se adaugă la final.
 */
export async function siteTemplate(
  key: string,
  data: Record<string, unknown>,
  slots: Record<string, ReactNode> = {},
  hooks: Record<string, string> = {},
): Promise<ReactNode | null> {
  const html = await siteTemplateHtml(key, data, hooks);
  if (html === null) return null;
  const required = (defaultTemplate(key)?.slots ?? []).filter((s) => s.required).map((s) => s.name);
  return htmlToReact(html, slots, required);
}

// ─── HTML → React ────────────────────────────────────────────────────────────

const ATTRS: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  datetime: "dateTime",
  hreflang: "hrefLang",
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  bgcolor: "bgColor",
  valign: "vAlign",
};
const BOOLEAN = new Set(["hidden", "open", "reversed"]);
const VOID = new Set(["br", "col", "hr", "img", "wbr"]);

/** `font-size` → `fontSize`, `-webkit-x` → `WebkitX`; proprietățile `--gcs-*` rămân cum sunt. */
const styleKey = (prop: string) => (prop.startsWith("--") ? prop : prop.replace(/^-(webkit|moz|ms)-/, (_m, v: string) => `${v[0]!.toUpperCase()}${v.slice(1)}-`).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()));

function props(attrs: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "style") {
      const style: Record<string, string> = {};
      for (const [p, v] of Object.entries(parseStyleAttribute(value))) style[styleKey(p)] = v;
      out.style = style;
    } else if (BOOLEAN.has(name)) {
      out[name] = true;
    } else {
      out[ATTRS[name] ?? name] = value;
    }
  }
  return out;
}

/**
 * Textul dintre taguri, ca în JSX: un text pe mai multe rânduri pierde spațiile de la capetele rândurilor, rândurile
 * goale dispar, iar restul se unesc cu un spațiu (deci indentarea șablonului nu adaugă spații în pagină).
 */
export function jsxText(text: string): string {
  if (!/[\r\n]/.test(text)) return text;
  const lines = text.split(/\r\n|\r|\n/);
  const out: string[] = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i !== 0) l = l.replace(/^ +/, "");
    if (i !== lines.length - 1) l = l.replace(/ +$/, "");
    if (l) out.push(l);
  });
  return out.join(" ");
}

const isInternal = (href: unknown) => typeof href === "string" && href.startsWith("/") && !href.startsWith("//");

function convert(nodes: GcsHtmlNode[], slots: Record<string, ReactNode>, used: Set<string>, pre: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = pre ? node.text : jsxText(node.text);
      if (text) out.push(text);
      continue;
    }
    if (node.name === "gcs-slot") {
      const name = node.attrs["data-name"] ?? "";
      used.add(name);
      if (slots[name] !== undefined && slots[name] !== null) out.push(createElement(Fragment, { key: `slot-${name}-${out.length}` }, slots[name]));
      continue;
    }
    const p: Record<string, unknown> = { ...props(node.attrs), key: out.length };
    const children = VOID.has(node.name) ? [] : convert(node.children, slots, used, pre || node.name === "pre");
    // Linkurile interne devin `next/link` (navigare fără reîncărcarea paginii, ca în componentele React).
    if (node.name === "a" && isInternal(p.href) && !p.target) out.push(createElement(Link, { ...p, href: p.href as string }, ...children));
    else out.push(createElement(node.name, p, ...children));
  }
  return out;
}

/** HTML-ul sanitizat al unui șablon → elemente React, cu sloturile înlocuite de nodurile lor. */
export function htmlToReact(html: string, slots: Record<string, ReactNode> = {}, required: string[] = []): ReactNode {
  const used = new Set<string>();
  const nodes = convert(parseHtmlTree(html), slots, used, false);
  for (const name of required) {
    if (!used.has(name) && slots[name] !== undefined && slots[name] !== null) nodes.push(createElement(Fragment, { key: `slot-${name}` }, slots[name]));
  }
  return createElement(Fragment, null, ...nodes);
}
