import { faBell } from "@fortawesome/free-solid-svg-icons";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GcsIcon, isGcsIcon, resolveIcon, searchIcons } from "../icons";
import { GcsIconSvg } from "../icons/svg";
import { GcsDropdown } from "./GcsDropdown";
import { GcsModal } from "./GcsModal";
import { dismissToast, gcsToast, GcsToastHost } from "./GcsToast";
import { GcsTooltip } from "./GcsTooltip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("iconițe", () => {
  test("după nume: SVG-ul corect, decorativ fără etichetă și cu rol img cu etichetă", () => {
    const { container } = render(<GcsIcon name="fa-solid fa-gamepad" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-icon")).toBe("fas-gamepad");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    render(<GcsIcon name="fa-brands fa-discord" label="Discord" />);
    expect(screen.getByRole("img", { name: "Discord" })).toBeTruthy();
  });

  test("un nume necunoscut sau malformat nu randează nimic și nu e valid", () => {
    const { container } = render(<GcsIcon name="fa-solid fa-nu-exista-deloc" />);
    expect(container.innerHTML).toBe("");
    for (const bad of ["fa-solid fa-nu-exista-deloc", "gamepad", "fa-solid gamepad", "fa-pro fa-bell", "<script>", null, 3]) {
      expect(isGcsIcon(bad)).toBe(false);
    }
    expect(isGcsIcon("fa-regular fa-bell")).toBe(true);
    expect(resolveIcon("fa-solid fa-bell")?.iconName).toBe("bell");
  });

  test("căutarea întoarce iconițe cu datele SVG, limitate", () => {
    const found = searchIcons("gamepad", 10);
    expect(found.map((i) => i.name)).toContain("fa-solid fa-gamepad");
    expect(found.every((i) => i.path.length > 0 && i.width > 0)).toBe(true);
    expect(searchIcons("", 5)).toHaveLength(5);
  });

  test("GcsIconSvg primește definiția direct (pentru componentele client)", () => {
    const { container } = render(<GcsIconSvg icon={faBell} />);
    expect(container.querySelector("path")).not.toBeNull();
  });
});

describe("GcsTooltip", () => {
  test("apare la focus din tastatură, e legat prin aria-describedby și dispare cu Escape", () => {
    render(
      <GcsTooltip content="Notificări">
        <button type="button">🔔</button>
      </GcsTooltip>,
    );
    const button = screen.getByRole("button");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Notificări");
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("GcsModal", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Deschide
        </button>
        {open && (
          <GcsModal title="Autentificare" closeLabel="Închide" onClose={() => setOpen(false)}>
            <input aria-label="Email" />
            <button type="button">Intră</button>
          </GcsModal>
        )}
      </>
    );
  }

  test("focusul intră în dialog, Tab rămâne înăuntru, Escape închide și focusul revine", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Deschide" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Autentificare" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Primul element focusabil e butonul de închidere din header.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Închide" }));

    const last = screen.getByRole("button", { name: "Intră" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Închide" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("GcsDropdown", () => {
  test("se deschide cu săgeata în jos, săgețile mută focusul, Escape închide și readuce focusul", () => {
    const onSelect = vi.fn();
    render(
      <GcsDropdown
        label="Meniul userului"
        trigger="Ana"
        items={[
          { kind: "link", label: "Profil", href: "/members/x" },
          { kind: "separator" },
          { kind: "action", label: "Ieșire", onSelect },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Meniul userului" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ieșire" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("toast-uri", () => {
  test("cel mult 3 vizibile, dispar după 6 s, se pot închide", () => {
    vi.useFakeTimers();
    render(<GcsToastHost closeLabel="Închide" />);
    act(() => {
      for (let i = 1; i <= 4; i++) gcsToast({ title: `T${i}`, href: `/n/${i}` });
    });
    const toasts = screen.getAllByTestId("gcs-toast");
    expect(toasts.map((t) => t.textContent)).toEqual(["T2", "T3", "T4"]);
    expect(screen.getByRole("link", { name: "T4" }).getAttribute("href")).toBe("/n/4");

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Închide" })[0]!);
    });
    expect(screen.getAllByTestId("gcs-toast")).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(screen.queryAllByTestId("gcs-toast")).toHaveLength(0);
  });

  test("dismissToast scoate un toast după id", () => {
    render(<GcsToastHost closeLabel="Închide" />);
    let id = 0;
    act(() => {
      id = gcsToast({ title: "Unu" });
    });
    act(() => dismissToast(id));
    expect(screen.queryAllByTestId("gcs-toast")).toHaveLength(0);
  });

  test("două host-uri montate odată: toast-ul apare o singură dată; al doilea preia după demontarea primului", () => {
    const first = render(<GcsToastHost closeLabel="Închide" />);
    render(<GcsToastHost closeLabel="Close" />);
    let id = 0;
    act(() => {
      id = gcsToast({ title: "O dată" });
    });
    expect(screen.getAllByTestId("gcs-toast")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Închide" })).toBeTruthy();

    first.unmount();
    expect(screen.getAllByTestId("gcs-toast")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    act(() => dismissToast(id));
  });
});
