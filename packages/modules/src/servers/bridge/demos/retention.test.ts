import { describe, expect, it } from "vitest";
import { demoHeaderKind, demoHeaderOk, keepCompressed, planDemoExpiry } from "./retention";

const day = 86_400_000;
const now = new Date("2026-10-20T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * day);

/** Retenția și cota demo-urilor, antetul și comprimarea (specul 2026-10-08-servere-hltv §6). */
describe("retenția și cota", () => {
  it("retenția: cele mai vechi decât zilele setate expiră", () => {
    const rows = [
      { id: 1, storedSize: 100, availableAt: ago(15) },
      { id: 2, storedSize: 100, availableAt: ago(14.1) },
      { id: 3, storedSize: 100, availableAt: ago(13.9) },
    ];
    expect(planDemoExpiry(rows, { now, retentionDays: 14, quotaBytes: 10_000 })).toEqual({ expired: [1, 2], evicted: [] });
  });

  it("cota: peste ea, cele mai vechi (rămase după retenție) ies până sub cotă; cel păstrat nu iese", () => {
    const rows = [
      { id: 4, storedSize: 400, availableAt: ago(1) },
      { id: 1, storedSize: 300, availableAt: ago(5) },
      { id: 2, storedSize: 300, availableAt: ago(4) },
      { id: 3, storedSize: 300, availableAt: ago(3) },
      { id: 9, storedSize: 50, availableAt: ago(30) },
    ];
    expect(planDemoExpiry(rows, { now, retentionDays: 14, quotaBytes: 1000 })).toEqual({ expired: [9], evicted: [1] });
    expect(planDemoExpiry(rows, { now, retentionDays: 14, quotaBytes: 900 })).toEqual({ expired: [9], evicted: [1, 2] });
    // Demo-ul tocmai adus (4) nu iese chiar dacă e cel mai vechi; ies celelalte.
    expect(planDemoExpiry(rows.map((r) => (r.id === 4 ? { ...r, availableAt: ago(6) } : r)), { now, retentionDays: 14, quotaBytes: 900, keep: [4] })).toEqual({ expired: [9], evicted: [1, 2] });
    expect(planDemoExpiry(rows, { now, retentionDays: 14, quotaBytes: 100_000 })).toEqual({ expired: [9], evicted: [] });
  });
});

describe("antetul demo-ului și comprimarea", () => {
  it("antetul: HLDEMO (CS 1.6), HL2DEMO (CS:GO), PBDEMS2 (CS2); jocul trebuie să corespundă", () => {
    const head = (s: string) => Buffer.concat([Buffer.from(s, "latin1"), Buffer.alloc(16)]);
    expect(demoHeaderKind(head("HLDEMO\0\0"))).toBe("goldsrc");
    expect(demoHeaderKind(head("HL2DEMO\0"))).toBe("source");
    expect(demoHeaderKind(head("PBDEMS2\0"))).toBe("source2");
    expect(demoHeaderKind(head("PK\u0003\u0004"))).toBeNull();
    expect(demoHeaderKind(Buffer.from("HL"))).toBeNull();
    expect(demoHeaderOk("cs16", head("HLDEMO\0\0"))).toBe(true);
    expect(demoHeaderOk("cs16", head("PBDEMS2\0"))).toBe(false);
    expect(demoHeaderOk("cs2", head("PBDEMS2\0"))).toBe(true);
    expect(demoHeaderOk("cs2", head("HL2DEMO\0"))).toBe(true);
    expect(demoHeaderOk("cs2", head("HLDEMO\0\0"))).toBe(false);
  });

  it("comprimat doar dacă economisește cel puțin 10 %", () => {
    expect(keepCompressed(1000, 899)).toBe(true);
    expect(keepCompressed(1000, 900)).toBe(true);
    expect(keepCompressed(1000, 901)).toBe(false);
    expect(keepCompressed(0, 20)).toBe(false);
  });
});
