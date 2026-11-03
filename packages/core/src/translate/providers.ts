/** Un serviciu de traducere automată (specul etapei 5 §5). `source: "auto"` = limba se detectează. */
export interface GcsTranslateProvider {
  readonly name: string;
  translateHtml(html: string, target: string): Promise<string>;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 20_000;

async function postJson(fetchImpl: Fetch, url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Traducerea a eșuat (${res.status})`);
  return res.json();
}

/** LibreTranslate propriu (serviciul `translate` din Docker): HTML păstrat, limba sursă detectată. */
export class GcsLibreTranslateProvider implements GcsTranslateProvider {
  readonly name = "libretranslate";
  constructor(
    private readonly url: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async translateHtml(html: string, target: string): Promise<string> {
    const body = (await postJson(this.fetchImpl, `${this.url.replace(/\/$/, "")}/translate`, { q: html, source: "auto", target, format: "html" })) as { translatedText?: unknown };
    if (typeof body.translatedText !== "string") throw new Error("Răspuns LibreTranslate invalid");
    return body.translatedText;
  }
}

/** DeepL (cheie din ACP): cheile gratuite (`…:fx`) folosesc api-free.deepl.com. */
export class GcsDeepLProvider implements GcsTranslateProvider {
  readonly name = "deepl";
  constructor(
    private readonly key: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async translateHtml(html: string, target: string): Promise<string> {
    const host = this.key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
    const lang = target === "en" ? "EN-GB" : target.toUpperCase();
    const body = (await postJson(
      this.fetchImpl,
      `https://${host}/v2/translate`,
      { text: [html], target_lang: lang, tag_handling: "html" },
      { authorization: `DeepL-Auth-Key ${this.key}` },
    )) as { translations?: { text?: unknown }[] };
    const text = body.translations?.[0]?.text;
    if (typeof text !== "string") throw new Error("Răspuns DeepL invalid");
    return text;
  }
}

/**
 * Google Cloud Translation (API v2, cheia din ACP): HTML păstrat (`format: html`), limba sursă detectată. Cheia merge în
 * adresă (`?key=`), cum cere API-ul cu chei simple; cererea pleacă doar de pe server.
 */
export class GcsGoogleTranslateProvider implements GcsTranslateProvider {
  readonly name = "google";
  constructor(
    private readonly key: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async translateHtml(html: string, target: string): Promise<string> {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.key)}`;
    const body = (await postJson(this.fetchImpl, url, { q: [html], target, format: "html" })) as { data?: { translations?: { translatedText?: unknown }[] } };
    const text = body.data?.translations?.[0]?.translatedText;
    if (typeof text !== "string") throw new Error("Răspuns Google Translate invalid");
    return text;
  }
}
