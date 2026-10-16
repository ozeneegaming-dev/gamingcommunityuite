import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GcsButton } from "./GcsButton";
import { GcsSpinner } from "./GcsSpinner";
import { GcsTooltip } from "./GcsTooltip";
import { GcsTooltipHost, autoTipText } from "./GcsTooltipHost";
import { placeTooltip } from "./tooltipPlace";

const css = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("poziția tooltip-ului", () => {
  const vp = { width: 400, height: 300 };
  test("centrat deasupra elementului, cu săgeata în dreptul centrului", () => {
    const p = placeTooltip({ left: 180, top: 100, width: 40, height: 20 }, { width: 80, height: 24 }, vp);
    expect(p).toEqual({ left: 160, top: 66, side: "top", arrow: 40 });
  });
  test("dedesubt când nu încape sus; ținut în ecran la margini", () => {
    const p = placeTooltip({ left: 2, top: 4, width: 20, height: 20 }, { width: 120, height: 24 }, vp);
    expect(p.side).toBe("bottom");
    expect(p.left).toBe(8);
    expect(p.top).toBe(34);
    expect(p.arrow).toBe(10);
  });
});

describe("tooltip-urile automate", () => {
  test("data-tip, title și butoanele doar cu iconiță primesc tooltip; butoanele cu text și zonele refuzate nu", () => {
    document.body.innerHTML = `
      <span id="a" data-tip="Sus"></span>
      <a id="b" href="#" title="Profilul">x</a>
      <button id="c" aria-label="Închide"><svg></svg></button>
      <button id="d" aria-label="Trimite">Trimite</button>
      <button id="f" aria-label="Mesaje: 3 necitite"><svg></svg><span>3</span></button>
      <span class="gcs-tooltipWrap"><button id="g" title="Are tooltip propriu"></button><div><time id="h" title="16 oct."></time></div></span>
      <div data-gcs-tip-off><button id="e" title="Nu"></button></div>`;
    const get = (id: string) => document.getElementById(id)!;
    expect(autoTipText(get("a"))).toBe("Sus");
    expect(autoTipText(get("b"))).toBe("Profilul");
    expect(autoTipText(get("c"))).toBe("Închide");
    expect(autoTipText(get("d"))).toBeNull();
    expect(autoTipText(get("f"))).toBe("Mesaje: 3 necitite");
    // Declanșatorul unui `GcsTooltip` nu primește și tooltip-ul automat; conținutul unui meniu din înveliș, da.
    expect(autoTipText(get("g"))).toBeNull();
    expect(autoTipText(get("h"))).toBe("16 oct.");
    expect(autoTipText(get("e"))).toBeNull();
  });

  test("gazda arată bula la focus din tastatură și pune `title` la loc după", () => {
    vi.useFakeTimers();
    render(
      <>
        <GcsTooltipHost />
        <button type="button" title="Notificări">
          <svg />
        </button>
      </>,
    );
    const button = screen.getByRole("button");
    // jsdom nu știe `:focus-visible`: îl simulăm.
    const matches = button.matches.bind(button);
    button.matches = (s: string) => (s === ":focus-visible" ? true : matches(s));
    act(() => {
      button.focus();
      vi.runAllTimers();
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Notificări");
    expect(button.hasAttribute("title")).toBe(false);
    act(() => button.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("title")).toBe("Notificări");
    vi.useRealTimers();
  });

  test("tooltip-ul unui element dintr-un meniu deschis stă în <body>, nu în meniu (nu se pierde)", () => {
    render(
      <div className="gcs-dropdown__menu" style={{ overflow: "hidden" }} data-testid="menu">
        <GcsTooltip content="12 membri">
          <a href="/members?group=3">Moderator</a>
        </GcsTooltip>
      </div>,
    );
    fireEvent.mouseEnter(screen.getByRole("link"));
    const tip = screen.getByRole("tooltip");
    expect(tip.parentElement).toBe(document.body);
    expect(screen.getByTestId("menu").contains(tip)).toBe(false);
  });
});

describe("loaderul", () => {
  test("GcsSpinner: decor fără etichetă, status cu etichetă", () => {
    const { rerender } = render(<GcsSpinner />);
    expect(screen.getByTestId("gcs-spinner").getAttribute("aria-hidden")).toBe("true");
    rerender(<GcsSpinner label="Se încarcă" size="lg" />);
    expect(screen.getByRole("status", { name: "Se încarcă" }).className).toContain("gcs-spinner--lg");
  });

  test("butonul în lucru: loaderul în locul iconiței, dezactivat și aria-busy", () => {
    render(
      <GcsButton variant="primary" loading>
        Salvează
      </GcsButton>,
    );
    const b = screen.getByRole("button", { name: "Salvează" });
    expect(b).toHaveProperty("disabled", true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector(".gcs-spinner")).not.toBeNull();
  });

  test("loaders.css are câte un stil pentru fiecare cheie din setarea „Stil loader” și varianta de mișcare redusă", () => {
    const sheet = css("loaders.css");
    const keys = ["dualRing", "arc", "dots", "pulse", "bars", "wave", "orbit", "square", "ripple", "flip", "chase", "grid", "hourglass", "dash", "comet", "bounce", "slash"];
    for (const k of keys) expect(sheet, k).toContain(`[data-gcs-loader="${k}"]`);
    expect(sheet).toContain("prefers-reduced-motion: reduce");
    expect(sheet).not.toContain("gcs-nova");
  });
});
