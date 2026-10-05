/** Login cu Steam prin OpenID 2.0 (Steam nu oferă OAuth). */
export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const TIMEOUT_MS = 5000;

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** URL-ul către care e trimis userul ca să se autentifice pe Steam. */
export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  url.search = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  }).toString();
  return url.toString();
}

/**
 * Verifică răspunsul primit de la Steam pe `return_to`: trimite parametrii înapoi la Steam cu
 * `openid.mode=check_authentication` și întoarce SteamID64 din `openid.claimed_id`, sau `null`
 * dacă răspunsul nu e valid (inclusiv la erori de rețea sau timeout).
 */
export async function verifySteamAssertion(
  params: URLSearchParams,
  fetchFn: FetchFn = fetch,
  opts: { expectedReturnTo?: string } = {},
): Promise<string | null> {
  if (params.get("openid.mode") !== "id_res") return null;
  if (params.get("openid.op_endpoint") !== STEAM_OPENID_ENDPOINT) return null;
  const match = CLAIMED_ID.exec(params.get("openid.claimed_id") ?? "");
  if (!match) return null;
  if (opts.expectedReturnTo !== undefined && !sameReturnTo(params.get("openid.return_to"), opts.expectedReturnTo)) {
    return null;
  }

  const body = new URLSearchParams(params);
  body.set("openid.mode", "check_authentication");
  try {
    const response = await fetchFn(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.split("\n").some((line) => line.trim() === "is_valid:true") ? match[1]! : null;
  } catch {
    return null;
  }
}

/** `return_to` primit trebuie să fie URL-ul nostru (parametrii din query pot diferi, ex. un `state`). */
function sameReturnTo(received: string | null, expected: string): boolean {
  if (!received || !URL.canParse(received)) return false;
  const a = new URL(received);
  const b = new URL(expected);
  return a.origin === b.origin && a.pathname === b.pathname;
}

/** Numele și avatarul public al unui cont Steam (Steam Web API, `GetPlayerSummaries`). `null` dacă nu se poate afla. */
export async function fetchSteamProfile(
  steamId: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<{ name: string; avatar: string | null } | null> {
  if (!apiKey) return null;
  const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  url.search = new URLSearchParams({ key: apiKey, steamids: steamId }).toString();
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = (await response.json()) as { response?: { players?: { personaname?: string; avatarfull?: string }[] } };
    const player = body.response?.players?.[0];
    if (!player?.personaname) return null;
    return { name: player.personaname, avatar: player.avatarfull ?? null };
  } catch {
    return null;
  }
}
