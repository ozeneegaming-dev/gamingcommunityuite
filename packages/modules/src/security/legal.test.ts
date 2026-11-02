import { settingValueError } from "@gcs/core";
import { describe, expect, test } from "vitest";
import { cookieBanner, legalLinks, resolveLegalDoc, termsRequiredOnRegister } from "./legal";
import { LEGAL_SETTING_DEFS, RETENTION_SETTING_DEFS, SECURITY_SETTING_DEFS, isLegalUrlOrEmpty } from "./settings";

const doc = { doc: { type: "doc", content: [] }, html: "<p>Termenii site-ului</p>", updatedAt: "2026-11-01T10:00:00.000Z" };

const settingsOf = (values: Record<string, unknown>) => ({
  get: async <T,>(key: string): Promise<T> => {
    const all = [...SECURITY_SETTING_DEFS, ...LEGAL_SETTING_DEFS, ...RETENTION_SETTING_DEFS];
    const def = all.find((d) => d.key === key);
    if (!def) throw new Error(`unknown ${key}`);
    return (key in values ? values[key] : def.default) as T;
  },
});

describe("setările de securitate și legale", () => {
  test("valorile implicite sunt valide, iar validarea refuză valorile greșite", () => {
    for (const def of [...SECURITY_SETTING_DEFS, ...LEGAL_SETTING_DEFS, ...RETENTION_SETTING_DEFS]) expect(settingValueError(def, def.default), def.key).toBeNull();
    const byKey = new Map([...SECURITY_SETTING_DEFS, ...LEGAL_SETTING_DEFS, ...RETENTION_SETTING_DEFS].map((d) => [d.key, d]));
    expect(settingValueError(byKey.get("security.login_max_attempts")!, -1)).toBe("invalid_range");
    expect(settingValueError(byKey.get("security.password_min_length")!, 6)).toBe("invalid_range");
    expect(settingValueError(byKey.get("security.mfa_recovery")!, "sms")).toBe("invalid_choice");
    expect(settingValueError(byKey.get("auth.password_reset_minutes")!, 4)).toBe("invalid_range");
    expect(settingValueError(byKey.get("auth.password_reset_minutes")!, 1441)).toBe("invalid_range");
    expect(settingValueError(byKey.get("auth.password_reset_minutes")!, 60)).toBeNull();
    expect(byKey.get("auth.password_reset_enabled")).toMatchObject({ type: "boolean", default: true, section: "2fa" });
    expect(byKey.get("auth.password_reset_revoke_sessions")).toMatchObject({ type: "boolean", default: true, section: "2fa" });
    expect(settingValueError(byKey.get("security.mfa_required_groups")!, [1, 1])).toBe("invalid");
    expect(settingValueError(byKey.get("legal.terms_mode")!, "pdf")).toBe("invalid_choice");
    expect(settingValueError(byKey.get("legal.terms_content")!, { html: "<p>x</p>" })).toBe("invalid");
    expect(settingValueError(byKey.get("legal.terms_content")!, doc)).toBeNull();
    expect(settingValueError(byKey.get("retention.audit_days")!, 5000)).toBe("invalid_range");
    expect(settingValueError(byKey.get("legal.cookie_text")!, "x".repeat(1001))).toBe("too_long");
  });

  test("adresele externe: doar http(s)", () => {
    expect(isLegalUrlOrEmpty("")).toBeNull();
    expect(isLegalUrlOrEmpty("https://example.com/terms")).toBeNull();
    expect(isLegalUrlOrEmpty("javascript:alert(1)")).toBe("invalid_url");
    expect(isLegalUrlOrEmpty("/terms")).toBe("invalid_url");
  });
});

describe("documentele legale", () => {
  test("pagina de pe site doar cu conținut; externă doar cu adresă validă; altfel nu există", () => {
    expect(resolveLegalDoc("terms", { mode: "page", content: doc, url: "" })).toMatchObject({ mode: "page", href: "/terms" });
    expect(resolveLegalDoc("terms", { mode: "page", content: null, url: "" })).toEqual({ kind: "terms", mode: "none" });
    expect(resolveLegalDoc("terms", { mode: "page", content: { ...doc, html: "  " }, url: "" })).toEqual({ kind: "terms", mode: "none" });
    expect(resolveLegalDoc("privacy", { mode: "external", content: null, url: "https://example.com/p" })).toEqual({ kind: "privacy", mode: "external", href: "https://example.com/p" });
    expect(resolveLegalDoc("privacy", { mode: "external", content: doc, url: "" })).toEqual({ kind: "privacy", mode: "none" });
    expect(resolveLegalDoc("privacy", { mode: "none", content: doc, url: "https://example.com/p" })).toEqual({ kind: "privacy", mode: "none" });
    expect(resolveLegalDoc("privacy", { mode: null, content: null, url: null })).toEqual({ kind: "privacy", mode: "none" });
  });

  test("linkurile, acceptarea la înregistrare și banda de cookie-uri", async () => {
    const none = settingsOf({});
    await expect(legalLinks(none)).resolves.toEqual({ terms: null, privacy: null });
    await expect(termsRequiredOnRegister(none)).resolves.toBe(false);
    await expect(cookieBanner(none)).resolves.toEqual({ enabled: false, text: null });

    const site = settingsOf({ "legal.terms_mode": "page", "legal.terms_content": doc, "legal.privacy_mode": "external", "legal.privacy_url": "https://example.com/p", "legal.cookie_banner": true, "legal.cookie_text": "  Folosim cookie-uri.  " });
    await expect(legalLinks(site)).resolves.toEqual({ terms: "/terms", privacy: "https://example.com/p" });
    await expect(termsRequiredOnRegister(site)).resolves.toBe(true);
    await expect(cookieBanner(site)).resolves.toEqual({ enabled: true, text: "Folosim cookie-uri." });

    const optional = settingsOf({ "legal.terms_mode": "page", "legal.terms_content": doc, "legal.require_terms_on_register": false });
    await expect(termsRequiredOnRegister(optional)).resolves.toBe(false);
  });
});
