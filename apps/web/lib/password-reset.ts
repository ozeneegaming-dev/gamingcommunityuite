import "server-only";
import { GcsForbidden, GcsValidationError, type GcsMail, type GcsPasswordResetAvailability, type GcsPasswordResetMail, type GcsPasswordResetSession } from "@gcs/core";
import { GCS_BRAND } from "@gcs/core/themes";
import { GCS_LOCALE_KEYS } from "@gcs/modules";
import { createTranslator } from "next-intl";
import { services } from "./services";

type GcsLocale = (typeof GCS_LOCALE_KEYS)[number];
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Cum pleacă emailul după răspuns (`after()` din Next.js în Server Actions; în teste, imediat). */
export type GcsDefer = (task: () => Promise<void>) => void;
export type GcsPasswordResetIo = { defer?: GcsDefer; send?: (mail: GcsMail) => Promise<void> };

const isLocale = (v: unknown): v is GcsLocale => GCS_LOCALE_KEYS.includes(v as GcsLocale);
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PROVIDER_NAMES: Record<string, string> = { discord: "Discord", google: "Google", steam: "Steam" };

/** Limba emailului: a membrului, altfel a site-ului. */
async function mailLocale(memberLocale: string): Promise<GcsLocale> {
  if (isLocale(memberLocale)) return memberLocale;
  const site = await services()
    .settings.get<string>("site.locale")
    .catch(() => "ro");
  return isLocale(site) ? site : "ro";
}

async function translator(locale: GcsLocale): Promise<Translate> {
  const messages = (await import(`../messages/${locale}.json`)).default as Record<string, unknown>;
  return createTranslator({ locale, messages: messages as never, namespace: "auth.resetEmail" as never }) as unknown as Translate;
}

function formatWhen(at: Date, locale: GcsLocale, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(at);
  }
}

/** Blocurile corpului: culorile brandului GCS (învelișul `email.layout` pune antetul și subsolul). */
const L = GCS_BRAND.color.light;
const p = (text: string) => `<p style="margin:0 0 14px">${escape(text)}</p>`;
const small = (text: string) => `<p style="margin:14px 0 0;font-size:13px;line-height:20px;color:${L.muted}">${escape(text)}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${escape(href)}" style="display:inline-block;background-color:${L.accentFill};color:${GCS_BRAND.neutrals[0]};font-weight:700;text-decoration:none;padding:12px 22px;border-radius:${GCS_BRAND.radius.button}px">${escape(label)}</a></p>`;
const fallback = (t: Translate, href: string) =>
  `<p style="margin:0 0 14px;font-size:13px;line-height:20px;color:${L.muted}">${escape(t("fallback"))}<br><a href="${escape(href)}" style="color:${L.accentInk};word-break:break-all">${escape(href)}</a></p>`;

/**
 * Emailul resetării, în limba membrului (altfel a site-ului), cu butonul în culorile brandului. Primul link al
 * conținutului e acțiunea emailului (linkul de resetare, autentificarea sau o resetare nouă).
 */
export async function passwordResetEmail(plan: GcsPasswordResetMail): Promise<GcsMail> {
  const locale = await mailLocale(plan.to.locale);
  const [t, site] = await Promise.all([
    translator(locale),
    services()
      .settings.get<string>("site.name")
      .catch(() => GCS_BRAND.name),
  ]);
  const greeting = p(t("greeting", { name: plan.to.name }));
  switch (plan.kind) {
    case "link": {
      // Un număr: limba română are forme de plural („5 minute”, „30 de minute”).
      const minutes = plan.minutes;
      return {
        to: plan.to.email,
        subject: t("link.subject", { site }),
        html: [greeting, p(t("link.body", { site })), button(plan.link, t("link.button")), fallback(t, plan.link), p(t("link.validity", { minutes })), small(t("link.ignore"))].join(""),
        text: [t("greeting", { name: plan.to.name }), t("link.body", { site }), plan.link, t("link.validity", { minutes }), t("link.ignore")].join("\n\n"),
      };
    }
    case "social": {
      const names = plan.providers.map((id) => PROVIDER_NAMES[id] ?? id);
      const body = names.length > 0 ? t("social.body", { site, providers: new Intl.ListFormat(locale, { type: "disjunction" }).format(names) }) : t("social.bodyNone", { site });
      return {
        to: plan.to.email,
        subject: t("social.subject", { site }),
        html: [greeting, p(body), button(plan.loginLink, t("social.button")), small(t("social.ignore"))].join(""),
        text: [t("greeting", { name: plan.to.name }), body, plan.loginLink, t("social.ignore")].join("\n\n"),
      };
    }
    case "changed": {
      const when = formatWhen(plan.at, locale, plan.to.timezone);
      const body = plan.ip ? t("changed.body", { site, when, ip: plan.ip }) : t("changed.bodyNoIp", { site, when });
      const lines = [body, ...(plan.sessionsRevoked ? [t("changed.sessions")] : [])];
      return {
        to: plan.to.email,
        subject: t("changed.subject", { site }),
        html: [greeting, ...lines.map(p), p(t("changed.notYou")), button(plan.forgotLink, t("changed.button"))].join(""),
        text: [t("greeting", { name: plan.to.name }), ...lines, t("changed.notYou"), plan.forgotLink].join("\n\n"),
      };
    }
  }
}

/** Trimite emailul după răspuns; o eroare de trimitere ajunge doar în log (răspunsul a plecat deja, la fel pentru toți). */
function deliver(plan: GcsPasswordResetMail, io: GcsPasswordResetIo): void {
  const send = io.send ?? ((mail: GcsMail) => services().mailer(mail));
  const defer: GcsDefer = io.defer ?? ((task) => void task());
  defer(async () => {
    try {
      await send(await passwordResetEmail(plan));
    } catch (error) {
      console.error("[GCS] Emailul resetării parolei nu a plecat:", error);
    }
  });
}

/**
 * „Am uitat parola”: cererea cu emailul sau numele. Răspunsul e același pentru orice date (`sent`), cu sau fără cont;
 * `disabled` / `no_email` țin doar de site. Peste limita IP-ului → `GcsRateLimited`.
 */
export async function requestPasswordReset(identifier: string, ip: string | null, io: GcsPasswordResetIo = {}): Promise<{ status: "sent" | Exclude<GcsPasswordResetAvailability, "available"> }> {
  const { passwordReset } = services();
  const availability = await passwordReset.availability();
  if (availability !== "available") return { status: availability };
  try {
    const plan = await passwordReset.request({ identifier, ip });
    if (plan) deliver(plan, io);
  } catch (error) {
    // Setarea s-a schimbat între verificare și cerere.
    if (error instanceof GcsForbidden) return { status: (await passwordReset.availability()) === "disabled" ? "disabled" : "no_email" };
    throw error;
  }
  return { status: "sent" };
}

/**
 * Parola nouă din linkul primit pe email: confirmarea, politica parolelor și tokenul (serviciul). La reușită pleacă
 * anunțul „parola a fost schimbată”.
 */
export async function completePasswordReset(
  input: { token: string; password: string; confirm: string; ip: string | null; session: GcsPasswordResetSession },
  io: GcsPasswordResetIo = {},
): Promise<{ userId: string }> {
  if (input.password !== input.confirm) throw new GcsValidationError({ confirm: "password_mismatch" });
  const result = await services().passwordReset.reset({ token: input.token, password: input.password, ip: input.ip, session: input.session });
  if (result.mail) deliver(result.mail, io);
  return { userId: result.userId };
}
