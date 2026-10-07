import { GcsValidationError } from "../errors";
import { GcsContentRenderer, type GcsRendered, type GcsRenderOptions } from "./renderer";
import { richDocIssue, richValueToDoc, type GcsRichFieldProfile } from "./richFields";

/**
 * Opțiunile de randare ale câmpurilor formatate. Profilurile nu permit video, deci lista de embed-uri e goală; textele
 * citatului și spoilerului contează doar la semnătură (apelantul le dă pe cele ale site-ului, prin `render`).
 */
const DEFAULT_OPTIONS: GcsRenderOptions = { embeds: [], siteHost: "localhost", labels: { quoteWrote: "{name}:", spoiler: "Spoiler" } };
const renderer = new GcsContentRenderer();

export type GcsRichFieldLimits = {
  /** Limita de caractere (implicit: a profilului). */
  maxChars?: number;
  /** Numărul maxim de imagini (implicit: al profilului). */
  maxImages?: number;
  /** Numele câmpului din formular, pentru erori (implicit `content`). */
  field?: string;
  render?: Partial<GcsRenderOptions>;
};

/**
 * Valoarea trimisă de editor (sau un text vechi) → JSON validat + HTML sanitizat, după profilul câmpului. Același
 * validator ca la postări (`GcsContentRenderer`: noduri, atribute, linkuri, imagini https, sanitizer), apoi profilul
 * (noduri / mărci permise, imagini) și limita de caractere. Orice abatere → `GcsValidationError` pe câmp.
 */
export function renderRichField(raw: unknown, profile: GcsRichFieldProfile, limits: GcsRichFieldLimits = {}): GcsRendered {
  const field = limits.field ?? "content";
  const doc = richValueToDoc(raw);
  if (doc === null) throw new GcsValidationError({ [field]: "required" });
  let rendered: GcsRendered;
  try {
    rendered = renderer.render(doc, { ...DEFAULT_OPTIONS, ...limits.render });
  } catch (error) {
    if (error instanceof GcsValidationError) throw new GcsValidationError({ [field]: "invalid" });
    throw error;
  }
  const maxImages = limits.maxImages ?? profile.maxImages;
  const issue = richDocIssue(rendered.json, profile, maxImages);
  if (issue) throw new GcsValidationError({ [field]: issue }, issue === "too_many_images" ? { max: String(maxImages) } : undefined);
  const maxChars = limits.maxChars ?? profile.maxChars;
  if (rendered.text.length > maxChars) throw new GcsValidationError({ [field]: "too_long" }, { max: String(maxChars) });
  return rendered;
}

/** Codul erorii unei valori (pentru `validate` al unei setări) sau `null`; `""` e valid (câmpul gol). */
export function richFieldError(raw: unknown, profile: GcsRichFieldProfile, limits: GcsRichFieldLimits = {}): string | null {
  if (raw === "") return null;
  if (typeof raw === "string" && raw.length > (limits.maxChars ?? profile.maxChars)) return "too_long";
  try {
    renderRichField(raw, profile, limits);
    return null;
  } catch (error) {
    if (error instanceof GcsValidationError) return Object.values(error.fields)[0] ?? "invalid";
    throw error;
  }
}

/**
 * HTML-ul unei valori salvate, pentru afișare: documentul sau textul vechi (convertit la citire, un paragraf pe rând).
 * O valoare goală sau invalidă → `""` (nimic de afișat).
 */
export function richFieldHtml(raw: unknown, profile: GcsRichFieldProfile, render: Partial<GcsRenderOptions> = {}): string {
  if (richValueToDoc(raw) === null) return "";
  try {
    // Limitele s-au aplicat la salvare (și se pot schimba între timp din ACP); la afișare contează doar siguranța.
    return renderRichField(raw, profile, { maxChars: Number.MAX_SAFE_INTEGER, maxImages: Number.MAX_SAFE_INTEGER, render }).html;
  } catch (error) {
    if (error instanceof GcsValidationError) return "";
    throw error;
  }
}
