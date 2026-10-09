import { memberNameHtml, type GcsMemberNameInput } from "@gcs/core/member-name";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GcsMemberName, GcsNameFxProvider, type GcsMemberNameProps } from "./GcsMemberName";

afterEach(() => {
  cleanup();
});

/** Elementul, cu atributele sortate (React și `memberNameHtml` le scriu în altă ordine). */
function normalized(html: string): string {
  const box = document.createElement("div");
  box.innerHTML = html;
  const walk = (el: Element): string => {
    const attrs = [...el.attributes].map((a) => `${a.name}=${a.value}`).sort();
    const kids = [...el.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : walk(n as Element))).join("");
    return `<${el.tagName.toLowerCase()} ${attrs.join(" ")}>${kids}</${el.tagName.toLowerCase()}>`;
  };
  return walk(box.firstElementChild!);
}

describe("GcsMemberName", () => {
  test("linkul: clasele, `data-user-id`, `data-text`, href", () => {
    render(<GcsMemberName userId="u1" name="ShadowRO" nameKey="vip_gold" href="/members/u1-shadowro" />);
    const link = screen.getByRole("link", { name: "ShadowRO" });
    expect(link.className).toBe("gcs-userLink gcs-name gcs-name--vip_gold");
    expect(link.getAttribute("href")).toBe("/members/u1-shadowro");
    expect(link.getAttribute("data-user-id")).toBe("u1");
    expect(link.getAttribute("data-text")).toBe("ShadowRO");
  });

  test("butonul (chat: click = mențiune) are stilul și hover card-ul unui link", () => {
    const click = vi.fn();
    render(<GcsMemberName userId="u1" name="Ana" nameKey="member" onClick={click} title="Menționează" />);
    const button = screen.getByRole("button", { name: "Ana" });
    expect(button.className).toBe("gcs-userLink gcs-name gcs-name--member");
    expect(button.getAttribute("data-user-id")).toBe("u1");
    expect(button.getAttribute("type")).toBe("button");
    button.click();
    expect(click).toHaveBeenCalledOnce();
  });

  test("literele doar pentru membrii din listă; numele accesibil rămâne textul simplu", () => {
    render(
      <GcsNameFxProvider letters={["u2"]}>
        <GcsMemberName userId="u1" name="Ana" nameKey="member" href="/m/1" />
        <GcsMemberName userId="u2" name="Bob" nameKey="member" href="/m/2" size="full" />
      </GcsNameFxProvider>,
    );
    expect(screen.getByRole("link", { name: "Ana" }).querySelector(".gcs-name__ls")).toBeNull();
    const bob = screen.getByRole("link", { name: "Bob" });
    expect(bob.getAttribute("data-name-fx")).toBe("full");
    expect(bob.querySelector(".gcs-name__ls")?.getAttribute("aria-hidden")).toBe("true");
    expect([...bob.querySelectorAll(".gcs-name__ls > b")].map((b) => b.getAttribute("data-c"))).toEqual(["B", "o", "b"]);
    expect(bob.textContent).toBe("Bob");
  });

  test("același markup ca `memberNameHtml` (șabloane, pluginuri, conținutul salvat)", () => {
    const cases: [GcsMemberNameProps, GcsMemberNameInput, string[]][] = [
      [{ userId: "u1", name: "Ana", nameKey: "admin", href: "/members/u1-ana" }, { id: "u1", name: "Ana", nameKey: "admin", href: "/members/u1-ana" }, []],
      [{ userId: "u1", name: "Ana", nameKey: "admin", size: "full", className: "gcs-hoverCard__name" }, { id: "u1", name: "Ana", nameKey: "admin", size: "full", className: "gcs-hoverCard__name" }, []],
      [{ userId: "u2", name: "Ștefan B", nameKey: "vip_gold", href: "/m" }, { id: "u2", name: "Ștefan B", nameKey: "vip_gold", href: "/m", letters: true }, ["u2"]],
    ];
    for (const [props, input, letters] of cases) {
      const react = renderToStaticMarkup(
        <GcsNameFxProvider letters={letters}>
          <GcsMemberName {...props} />
        </GcsNameFxProvider>,
      );
      expect(normalized(react)).toBe(normalized(memberNameHtml(input)));
    }
  });
});
