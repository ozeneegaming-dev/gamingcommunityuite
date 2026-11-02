import { describe, expect, test } from "vitest";
import { isMaintenanceExempt } from "./maintenance";

describe("căile scutite de mentenanță", () => {
  test("login-ul, autentificarea, health-check-ul și pagina de mentenanță rămân accesibile", () => {
    for (const path of ["/login", "/forgot-password", "/reset-password", "/api/auth/sign-in/email", "/api/health", "/maintenance", "/gcs-names.css"]) {
      expect(isMaintenanceExempt(path)).toBe(true);
    }
  });

  test("endpoint-ul intern al consolei (gcs maintenance off) nu e blocat de mentenanță", () => {
    expect(isMaintenanceExempt("/api/internal/cli")).toBe(true);
  });

  test("protocolul serverelor de joc (se autentifică singur, cu cheia pe server) rămâne disponibil", () => {
    for (const path of ["/api/servers/bridge/v1/heartbeat", "/api/servers/bridge/v1/sanctions"]) expect(isMaintenanceExempt(path)).toBe(true);
    for (const path of ["/api/servers/bridge/v2/heartbeat", "/api/servers/status", "/api/servers/bridge/v1"]) expect(isMaintenanceExempt(path)).toBe(false);
  });

  test("doar calea exactă a consolei: restul site-ului și alte căi interne rămân blocate", () => {
    for (const path of ["/", "/forums", "/api/internal/cli/x", "/api/internal/clix", "/api/internal/other", "/x/api/internal/cli", "/admin", "/reset-password/x", "/forgot-passwordx"]) {
      expect(isMaintenanceExempt(path)).toBe(false);
    }
  });
});
