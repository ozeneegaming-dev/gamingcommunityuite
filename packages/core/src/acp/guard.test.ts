import { describe, expect, test } from "vitest";
import { acpGate } from "./guard";

const now = new Date("2026-10-05T12:00:00Z");
const base = {
  canAccess: true,
  twoFactorEnabled: true,
  lastAcpAuthAt: new Date("2026-10-05T11:00:00Z"),
  lastAcpAuthIp: "10.0.0.1",
};

describe("acpGate", () => {
  test("fără acp.access → forbidden", () => {
    expect(acpGate({ ...base, canAccess: false }, "10.0.0.1", now)).toBe("forbidden");
  });

  test("fără 2FA → need_2fa_setup", () => {
    expect(acpGate({ ...base, twoFactorEnabled: false }, "10.0.0.1", now)).toBe("need_2fa_setup");
  });

  test("ultima autentificare acum 13h → need_reauth", () => {
    expect(acpGate({ ...base, lastAcpAuthAt: new Date("2026-10-04T23:00:00Z") }, "10.0.0.1", now)).toBe("need_reauth");
  });

  test("niciodată autentificat în ACP → need_reauth", () => {
    expect(acpGate({ ...base, lastAcpAuthAt: null, lastAcpAuthIp: null }, "10.0.0.1", now)).toBe("need_reauth");
  });

  test("IP schimbat → need_reauth", () => {
    expect(acpGate(base, "10.0.0.2", now)).toBe("need_reauth");
  });

  test("altfel → ok", () => {
    expect(acpGate(base, "10.0.0.1", now)).toBe("ok");
    expect(acpGate({ ...base, lastAcpAuthAt: new Date("2026-10-05T00:00:01Z") }, "10.0.0.1", now)).toBe("ok");
  });
});
