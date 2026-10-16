import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { useHydrated } from "./use-hydrated";

/**
 * Formularele cu parole / coduri 2FA: un click înainte de hidratare trimitea formularul nativ (GET), cu parola și codul
 * în adresă (istoric, loguri). Acum: `method="post"` pe fiecare formular și butonul de trimitere oprit până la hidratare.
 */
const CREDENTIAL_FORMS = [
  "app/(site)/login/LoginForm.tsx",
  "app/(site)/register/RegisterForm.tsx",
  "app/admin/(auth)/reauth/ReauthForm.tsx",
  "app/admin/(auth)/2fa-setup/TwoFactorSetup.tsx",
];

describe("formularele cu parole", () => {
  test.each(CREDENTIAL_FORMS)("%s: POST și butonul așteaptă hidratarea", (file) => {
    const src = readFileSync(path.resolve(__dirname, "..", file), "utf8");
    const forms = src.match(/<form\b[^>]*>/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) expect(form).toContain('method="post"');
    expect(src).toContain("useHydrated()");
    expect(src).not.toMatch(/disabled=\{pending\}/);
  });

  test("useHydrated e fals în HTML-ul de pe server", () => {
    function Probe() {
      return createElement("span", null, String(useHydrated()));
    }
    expect(renderToString(createElement(Probe))).toBe("<span>false</span>");
  });
});
