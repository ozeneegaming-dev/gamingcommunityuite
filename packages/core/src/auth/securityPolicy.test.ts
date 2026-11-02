import { describe, expect, test } from "vitest";
import {
  DEFAULT_PASSWORD_POLICY,
  loadMfaRecovery,
  loadMfaRequiredGroups,
  loadPasswordPolicy,
  mfaRequiredGroupsError,
  mfaSetupRequired,
  passwordPolicyError,
} from "./securityPolicy";

const settingsOf = (values: Record<string, unknown>) => ({
  get: async <T,>(key: string): Promise<T> => {
    if (!(key in values)) throw new Error(`unknown ${key}`);
    return values[key] as T;
  },
});

describe("politica parolelor", () => {
  test("implicit: minimum 8 caractere, cu litere și cifre", () => {
    expect(passwordPolicyError("abc123", DEFAULT_PASSWORD_POLICY)).toBe("password_too_short");
    expect(passwordPolicyError("parolasigura", DEFAULT_PASSWORD_POLICY)).toBe("password_needs_mix");
    expect(passwordPolicyError("12345678", DEFAULT_PASSWORD_POLICY)).toBe("password_needs_mix");
    expect(passwordPolicyError("parola-sigura-123", DEFAULT_PASSWORD_POLICY)).toBeNull();
  });

  test("lungimea minimă din setări; literele pot fi din orice alfabet", () => {
    const policy = { minLength: 12, requireMix: true };
    expect(passwordPolicyError("parola12345", policy)).toBe("password_too_short");
    expect(passwordPolicyError("parola123456", policy)).toBeNull();
    expect(passwordPolicyError("пароль123456", policy)).toBeNull();
  });

  test("fără amestec cerut, doar lungimea contează; peste 128 de caractere e refuzată", () => {
    const policy = { minLength: 8, requireMix: false };
    expect(passwordPolicyError("parolasigura", policy)).toBeNull();
    expect(passwordPolicyError("a1".repeat(65), policy)).toBe("password_too_long");
  });

  test("minimul nu coboară sub 8 nici dacă setarea ar spune altfel", () => {
    expect(passwordPolicyError("abc1234", { minLength: 4, requireMix: true })).toBe("password_too_short");
  });

  test("setările: valorile salvate, limitate la 8–128; lipsa lor dă valorile implicite", async () => {
    await expect(loadPasswordPolicy(settingsOf({ "security.password_min_length": 10, "security.password_require_mix": false }))).resolves.toEqual({ minLength: 10, requireMix: false });
    await expect(loadPasswordPolicy(settingsOf({ "security.password_min_length": 500, "security.password_require_mix": true }))).resolves.toEqual({ minLength: 128, requireMix: true });
    await expect(loadPasswordPolicy(settingsOf({}))).resolves.toEqual(DEFAULT_PASSWORD_POLICY);
  });
});

describe("politica 2FA", () => {
  test("obligatoriu doar pentru membrii grupurilor alese, fără 2FA activ", () => {
    expect(mfaSetupRequired({ groupIds: [5, 9], twoFactorEnabled: false }, [9])).toBe(true);
    expect(mfaSetupRequired({ groupIds: [5, 9], twoFactorEnabled: true }, [9])).toBe(false);
    expect(mfaSetupRequired({ groupIds: [5], twoFactorEnabled: false }, [9])).toBe(false);
    expect(mfaSetupRequired({ groupIds: [5], twoFactorEnabled: false }, [])).toBe(false);
  });

  test("validarea listei de grupuri", () => {
    expect(mfaRequiredGroupsError([])).toBeNull();
    expect(mfaRequiredGroupsError([1, 4])).toBeNull();
    expect(mfaRequiredGroupsError([1, 1])).toBe("invalid");
    expect(mfaRequiredGroupsError([0])).toBe("invalid");
    expect(mfaRequiredGroupsError(["1"])).toBe("invalid");
    expect(mfaRequiredGroupsError("1")).toBe("invalid");
  });

  test("setările: grupurile valide și modul de recuperare (implicit codurile de rezervă)", async () => {
    await expect(loadMfaRequiredGroups(settingsOf({ "security.mfa_required_groups": [3, "x", -1, 7] }))).resolves.toEqual([3, 7]);
    await expect(loadMfaRequiredGroups(settingsOf({}))).resolves.toEqual([]);
    await expect(loadMfaRecovery(settingsOf({ "security.mfa_recovery": "email_code" }))).resolves.toBe("email_code");
    await expect(loadMfaRecovery(settingsOf({ "security.mfa_recovery": "altceva" }))).resolves.toBe("backup_codes");
    await expect(loadMfaRecovery(settingsOf({}))).resolves.toBe("backup_codes");
  });
});
