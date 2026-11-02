import type { GcsSettingsService } from "@gcs/core";
import { isCommunityRules, type GcsCommunityRules } from "../community/rules";
import { COOKIE_BANNER_SETTING, COOKIE_TEXT_SETTING, LEGAL_MODES, REQUIRE_TERMS_SETTING, isLegalUrlOrEmpty, legalSetting, type GcsLegalDocKind, type GcsLegalMode } from "./settings";

/** Adresele publice ale documentelor legale de pe site. */
export const LEGAL_HREFS: Record<GcsLegalDocKind, string> = { terms: "/terms", privacy: "/privacy" };

/**
 * Un document legal așa cum îl vede site-ul:
 * - `none`: nu există (pagina răspunde 404, linkurile lipsesc);
 * - `page`: pagina de pe site, cu documentul scris în ACP (fără conținut = ca `none`);
 * - `external`: o adresă externă (pagina de pe site redirecționează acolo; fără adresă validă = ca `none`).
 */
export type GcsLegalDoc = { kind: GcsLegalDocKind; mode: "none" } | { kind: GcsLegalDocKind; mode: "page"; href: string; doc: GcsCommunityRules } | { kind: GcsLegalDocKind; mode: "external"; href: string };

type Settings = Pick<GcsSettingsService, "get">;

/** Forma pură (testabilă) din valorile setărilor. */
export function resolveLegalDoc(kind: GcsLegalDocKind, values: { mode: unknown; content: unknown; url: unknown }): GcsLegalDoc {
  const mode: GcsLegalMode = LEGAL_MODES.includes(values.mode as GcsLegalMode) ? (values.mode as GcsLegalMode) : "none";
  if (mode === "page" && isCommunityRules(values.content) && values.content.html.trim() !== "") return { kind, mode, href: LEGAL_HREFS[kind], doc: values.content };
  if (mode === "external" && typeof values.url === "string" && values.url !== "" && isLegalUrlOrEmpty(values.url) === null) return { kind, mode, href: values.url };
  return { kind, mode: "none" };
}

export async function legalDoc(settings: Settings, kind: GcsLegalDocKind): Promise<GcsLegalDoc> {
  const read = (part: "mode" | "content" | "url") => settings.get<unknown>(legalSetting(kind, part)).catch(() => null);
  const [mode, content, url] = await Promise.all([read("mode"), read("content"), read("url")]);
  return resolveLegalDoc(kind, { mode, content, url });
}

/** Linkurile documentelor care există (subsolul, formularul de înregistrare). */
export async function legalLinks(settings: Settings): Promise<{ terms: string | null; privacy: string | null }> {
  const [terms, privacy] = await Promise.all([legalDoc(settings, "terms"), legalDoc(settings, "privacy")]);
  return { terms: terms.mode === "none" ? null : terms.href, privacy: privacy.mode === "none" ? null : privacy.href };
}

/** Acceptarea termenilor e cerută la înregistrare: setarea e pornită și există o pagină de termeni. */
export async function termsRequiredOnRegister(settings: Settings): Promise<boolean> {
  const [required, terms] = await Promise.all([settings.get<boolean>(REQUIRE_TERMS_SETTING).catch(() => true), legalDoc(settings, "terms")]);
  return required !== false && terms.mode !== "none";
}

/** Banda de cookie-uri: pornită și textul ei (`null` = textul implicit tradus). */
export async function cookieBanner(settings: Settings): Promise<{ enabled: boolean; text: string | null }> {
  const [enabled, text] = await Promise.all([settings.get<boolean>(COOKIE_BANNER_SETTING).catch(() => false), settings.get<string>(COOKIE_TEXT_SETTING).catch(() => "")]);
  return { enabled: enabled === true, text: typeof text === "string" && text.trim() !== "" ? text.trim() : null };
}
