import { escapeHtml, safeHtml, type GcsMailer, type GcsSettingsService, type GcsTemplateComponents, type GcsTemplateService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { resolveIcon } from "@gcs/ui/icon-registry";

const CLASS_RE = /^[A-Za-z0-9_ -]{0,120}$/;

/**
 * `{% icon "fa-solid fa-star" %}`: același SVG ca `GcsIconSvg` (Font Awesome Free, fără runtime). Opțiuni: `class`
 * (clase în plus) și `label` (text pentru cititoarele de ecran; fără el iconița e decorativă).
 */
export function templateIconSvg(name: string, opts: Record<string, unknown> = {}): string {
  const def = resolveIcon(name);
  if (!def) return "";
  const [width, height, , , path] = def.icon;
  const paths = (Array.isArray(path) ? path : [path]).map((d) => `<path d="${escapeHtml(d)}"></path>`).join("");
  const extra = typeof opts.class === "string" && CLASS_RE.test(opts.class) && opts.class.trim() ? ` ${opts.class.trim()}` : "";
  const label = typeof opts.label === "string" && opts.label.trim() ? opts.label.trim() : null;
  const a11y = label ? `role="img" aria-label="${escapeHtml(label)}"` : `aria-hidden="true"`;
  return `<svg class="gcs-icon${extra}" viewBox="0 0 ${width} ${height}" width="1em" height="1em" fill="currentColor" focusable="false" data-icon="${def.prefix}-${def.iconName}" ${a11y}>${paths}</svg>`;
}

/** Componentele șabloanelor cu iconițele Font Awesome (restul vin din `@gcs/core`). */
export const templateComponents = (): Partial<GcsTemplateComponents> => ({ icon: templateIconSvg });

/**
 * Învelișul emailurilor (`email.layout`): dacă tema implicită l-a modificat, fiecare email pleacă prin el (corpul
 * generat de site e `content`, HTML deja sigur); rezultatul e sanitizat cu regulile emailurilor. Orice eroare lasă
 * emailul neschimbat (și ajunge în log): un șablon greșit nu oprește trimiterea.
 */
export function withEmailLayout(mailer: GcsMailer, deps: { db: PrismaClient; templates: GcsTemplateService; settings: Pick<GcsSettingsService, "get"> }): GcsMailer {
  return async (mail) => {
    let html = mail.html;
    try {
      const theme = await deps.db.theme.findFirst({ where: { isDefault: true }, select: { key: true } });
      if (theme && (await deps.templates.overrides(theme.key))["email.layout"]) {
        const [siteName, siteUrl, locale] = await Promise.all([
          deps.settings.get<string>("site.name"),
          deps.settings.get<string>("site.url"),
          deps.settings.get<string>("site.locale").catch(() => "ro"),
        ]);
        const data = { site: { name: siteName, url: siteUrl }, subject: mail.subject, content: safeHtml(mail.html), year: new Date().getFullYear() };
        const rendered = await deps.templates.render(theme.key, "email.layout", data, { locale, components: templateComponents() });
        if (rendered !== null && rendered.trim()) html = rendered;
      }
    } catch (error) {
      console.error("[GCS] email.layout:", error);
    }
    return mailer({ ...mail, html });
  };
}
