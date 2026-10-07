import { describe, expect, test } from "vitest";
import { isMaintenanceExempt } from "./maintenance";

describe("căile scutite de mentenanță", () => {
  test("login-ul, autentificarea, health-check-ul și pagina de mentenanță rămân accesibile", () => {
    for (const path of ["/login", "/api/auth/sign-in/email", "/api/health", "/maintenance", "/gcs-names.css"]) {
      expect(isMaintenanceExempt(path)).toBe(true);
    }
  });

  test("endpoint-ul intern al consolei (gcs maintenance off) nu e blocat de mentenanță", () => {
    expect(isMaintenanceExempt("/api/internal/cli")).toBe(true);
  });

  test("doar calea exactă a consolei: restul site-ului și alte căi interne rămân blocate", () => {
    for (const path of ["/", "/forums", "/api/internal/cli/x", "/api/internal/clix", "/api/internal/other", "/x/api/internal/cli", "/admin"]) {
      expect(isMaintenanceExempt(path)).toBe(false);
    }
  });
});
