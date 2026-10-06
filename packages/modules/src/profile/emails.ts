import type { GcsMail } from "@gcs/core";

/** Emailurile modulelor etapei 3, în limba site-ului (`site.locale`). Textele nu conțin HTML de la useri, doar valori escapate. */
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Locale = "ro" | "en";
const pick = (locale: string): Locale => (locale === "en" ? "en" : "ro");

export function emailChangeMail(opts: { to: string; name: string; site: string; link: string; locale: string }): GcsMail {
  const l = pick(opts.locale);
  const name = escape(opts.name);
  const site = escape(opts.site);
  const link = escape(opts.link);
  return l === "en"
    ? {
        to: opts.to,
        subject: `Confirm your new email address — ${opts.site}`,
        html: `<p>Hi ${name},</p><p>Confirm this address for your ${site} account:</p><p><a href="${link}">${link}</a></p><p>The link is valid for 24 hours. If you did not request this, ignore this email.</p>`,
        text: `Confirm your new email address for ${opts.site}: ${opts.link}`,
      }
    : {
        to: opts.to,
        subject: `Confirmă noua adresă de email — ${opts.site}`,
        html: `<p>Salut, ${name}!</p><p>Confirmă această adresă pentru contul tău de pe ${site}:</p><p><a href="${link}">${link}</a></p><p>Linkul e valabil 24 de ore. Dacă nu ai cerut schimbarea, ignoră acest email.</p>`,
        text: `Confirmă noua adresă de email pentru ${opts.site}: ${opts.link}`,
      };
}
