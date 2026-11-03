import { describe, expect, test } from "vitest";
import { flyoutPlacement, panelMaxHeight, PANEL_MIN_HEIGHT } from "./account-menu-layout";

const VIEW = { width: 1440, height: 900 };
const FLY = { width: 248, height: 180 };
/** Panoul contului la dreapta antetului (340 px), sub buton. */
const RIGHT_PANEL = { top: 80, left: 1080, right: 1420, bottom: 780 };
const row = (top: number) => ({ top, left: 1088, right: 1412, bottom: top + 34 });

describe("meniul contului: înălțimea maximă", () => {
  test("ecranul minus antetul (și o margine), cu derulare internă", () => {
    expect(panelMaxHeight(80, 900)).toBe(808);
    expect(panelMaxHeight(80, 900, 20)).toBe(800);
  });

  test("pe un ecran foarte scund rămâne folosibil (minimul, derulează)", () => {
    expect(panelMaxHeight(300, 400)).toBe(PANEL_MIN_HEIGHT);
  });
});

describe("meniul contului: submeniul „Staff”", () => {
  test("panoul la dreapta: submeniul se deschide spre stânga (interiorul ecranului), în dreptul rândului", () => {
    expect(flyoutPlacement(RIGHT_PANEL, row(400), FLY, VIEW)).toEqual({ side: "left", top: 314 });
  });

  test("panoul la stânga (contul în zona din stânga): spre dreapta", () => {
    const panel = { top: 80, left: 20, right: 360, bottom: 780 };
    expect(flyoutPlacement(panel, { ...row(200), left: 28, right: 352 }, FLY, VIEW).side).toBe("right");
  });

  test("rândul jos în ecran: submeniul urcă cât să încapă (marginea de 8 px)", () => {
    const placed = flyoutPlacement(RIGHT_PANEL, row(860), FLY, VIEW);
    expect(placed.side).toBe("left");
    expect(RIGHT_PANEL.top + placed.top + FLY.height).toBe(VIEW.height - 8);
  });

  test("fără loc în nicio parte (ecran îngust): sub rând, în panou", () => {
    const narrow = { width: 400, height: 800 };
    const panel = { top: 64, left: 30, right: 370, bottom: 700 };
    expect(flyoutPlacement(panel, row(300), FLY, narrow)).toEqual({ side: "inline", top: 0 });
  });

  test("la egalitate (panoul centrat), spre stânga", () => {
    const panel = { top: 80, left: 550, right: 890, bottom: 780 };
    expect(flyoutPlacement(panel, row(200), FLY, VIEW).side).toBe("left");
  });
});
