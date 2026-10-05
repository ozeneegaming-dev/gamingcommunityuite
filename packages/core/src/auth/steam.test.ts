import { describe, expect, test, vi } from "vitest";
import { buildSteamLoginUrl, fetchSteamProfile, STEAM_OPENID_ENDPOINT, verifySteamAssertion } from "./steam";

const RETURN_TO = "https://forum.example.com/api/auth/steam/callback";
const STEAM_ID = "76561198000000000";

function assertion(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": RETURN_TO,
    "openid.response_nonce": "2026-10-05T00:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
  });
}

const steamSays = (valid: boolean) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`),
  );

describe("buildSteamLoginUrl", () => {
  test("cere identificarea prin OpenID 2.0 cu return_to și realm", () => {
    const url = new URL(buildSteamLoginUrl(RETURN_TO, "https://forum.example.com"));
    expect(url.origin + url.pathname).toBe(STEAM_OPENID_ENDPOINT);
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.return_to")).toBe(RETURN_TO);
    expect(url.searchParams.get("openid.realm")).toBe("https://forum.example.com");
    expect(url.searchParams.get("openid.identity")).toBe("http://specs.openid.net/auth/2.0/identifier_select");
  });
});

describe("fetchSteamProfile", () => {
  test("întoarce numele și avatarul din GetPlayerSummaries", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) =>
      Response.json({ response: { players: [{ personaname: "Krypt", avatarfull: "https://avatars.example/k.jpg" }] } }),
    );
    await expect(fetchSteamProfile(STEAM_ID, "KEY", fetchFn)).resolves.toEqual({
      name: "Krypt",
      avatar: "https://avatars.example/k.jpg",
    });
    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.searchParams.get("steamids")).toBe(STEAM_ID);
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  test("fără cheie API sau la eroare → null", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 500 }));
    await expect(fetchSteamProfile(STEAM_ID, "", fetchFn)).resolves.toBeNull();
    await expect(fetchSteamProfile(STEAM_ID, "KEY", fetchFn)).resolves.toBeNull();
  });
});

describe("verifySteamAssertion", () => {
  test("is_valid:true → SteamID64, trimis cu check_authentication", async () => {
    const fetchFn = steamSays(true);
    await expect(verifySteamAssertion(assertion(), fetchFn)).resolves.toBe(STEAM_ID);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(STEAM_OPENID_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(new URLSearchParams(String(init?.body)).get("openid.mode")).toBe("check_authentication");
  });

  test("is_valid:false → null", async () => {
    await expect(verifySteamAssertion(assertion(), steamSays(false))).resolves.toBeNull();
  });

  test("claimed_id pe alt domeniu → null, fără să mai întrebe Steam", async () => {
    const fetchFn = steamSays(true);
    const params = assertion({ "openid.claimed_id": `https://evil.example.com/openid/id/${STEAM_ID}` });
    await expect(verifySteamAssertion(params, fetchFn)).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("return_to diferit de cel așteptat → null", async () => {
    const params = assertion({ "openid.return_to": "https://evil.example.com/callback" });
    await expect(verifySteamAssertion(params, steamSays(true), { expectedReturnTo: RETURN_TO })).resolves.toBeNull();
  });

  test("o eroare de rețea → null", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(verifySteamAssertion(assertion(), fetchFn)).resolves.toBeNull();
  });
});
