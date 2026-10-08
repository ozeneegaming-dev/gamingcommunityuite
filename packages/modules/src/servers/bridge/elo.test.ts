import { describe, expect, it } from "vitest";
import { expectedScore, rateMatch, type GcsEloConfig, type GcsEloPlayer } from "./elo";

const standard: GcsEloConfig = { k: 25, kNew: 40, provisional: 10, performance: 0 };
const veteran = (id: number, team: "A" | "B", elo: number, damage = 1000): GcsEloPlayer => ({ id, team, elo, matches: 50, damage });

describe("ELO-ul meciurilor mix (§10, testele golden)", () => {
  it("1000 vs 1000, K = 25, P = 0, câștigă A → A +13 fiecare, B −13 fiecare", () => {
    const players = [veteran(1, "A", 1000), veteran(2, "A", 1000), veteran(3, "B", 1000), veteran(4, "B", 1000)];
    const out = rateMatch(players, "A", standard);
    expect(out.get(1)).toEqual({ before: 1000, after: 1013, delta: 13 });
    expect(out.get(2)!.delta).toBe(13);
    expect(out.get(3)).toEqual({ before: 1000, after: 987, delta: -13 });
    expect(out.get(4)!.delta).toBe(-13);
  });

  it("A medie 1200, B medie 1000, câștigă B → E_B = 0.2403, B +19, A −19", () => {
    expect(expectedScore(1000, 1200)).toBeCloseTo(0.2403, 4);
    const players = [veteran(1, "A", 1100), veteran(2, "A", 1300), veteran(3, "B", 900), veteran(4, "B", 1100)];
    const out = rateMatch(players, "B", standard);
    expect([out.get(3)!.delta, out.get(4)!.delta]).toEqual([19, 19]);
    expect([out.get(1)!.delta, out.get(2)!.delta]).toEqual([-19, -19]);
  });

  it("același meci cu P = 0.25: un jucător din B cu damage dublu față de media echipei → f = 1.25, Δ = 24", () => {
    // Media echipei B = (2000 + 0 + 1000) / 3 = 1000: primul are damage dublu, al doilea zero, al treilea exact media.
    const players = [veteran(1, "A", 1200, 500), veteran(2, "A", 1200, 1500), veteran(3, "B", 1000, 2000), veteran(4, "B", 1000, 0), veteran(5, "B", 1000, 1000)];
    const out = rateMatch(players, "B", { ...standard, performance: 0.25 });
    expect(out.get(3)!.delta).toBe(24);
    expect(out.get(5)!.delta).toBe(19);
    expect(out.get(4)!.delta).toBe(14);
    // La pierdere, cine a contribuit mai mult pierde mai puțin: f = 0.875 → Δ = round(−18.99 × 1.125) = −21; f = 1.125 → −17.
    expect(out.get(1)!.delta).toBe(-21);
    expect(out.get(2)!.delta).toBe(-17);
  });

  it("K mare pentru jucătorii provizorii, egal = 0.5, ELO-ul minim 100, media damage-ului 0 → f = 1", () => {
    const players: GcsEloPlayer[] = [
      { id: 1, team: "A", elo: 1000, matches: 3, damage: 0 },
      { id: 2, team: "B", elo: 1000, matches: 30, damage: 0 },
    ];
    const win = rateMatch(players, "A", { ...standard, performance: 0.25 });
    expect(win.get(1)!.delta).toBe(20);
    expect(win.get(2)!.delta).toBe(-13);
    const draw = rateMatch(players, "DRAW", standard);
    expect(draw.get(1)!.delta).toBe(0);
    const floor = rateMatch([{ id: 1, team: "A", elo: 105, matches: 99, damage: 0 }, { id: 2, team: "B", elo: 105, matches: 99, damage: 0 }], "B", standard);
    expect(floor.get(1)).toEqual({ before: 105, after: 100, delta: -5 });
  });
});
