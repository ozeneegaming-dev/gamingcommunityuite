import { avatarHtml, DEFAULT_TEMPLATES, parseHtmlTree, sanitizeTemplateHtml, TEMPLATE_GROUP_ICONS, usernameHtml } from "@gcs/core";
import { templateIconSvg } from "@gcs/modules";
import { GcsAvatar, GcsUserLink } from "@gcs/ui";
import { GcsIconSvg } from "@gcs/ui/icons";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { htmlToReact, jsxText } from "./templates";

/** Arborele HTML (după sanitizer), ca să comparăm structura fără ordinea atributelor. */
const tree = (html: string) => parseHtmlTree(sanitizeTemplateHtml(html));
const react = (el: ReactElement) => renderToStaticMarkup(el);

describe("componentele șabloanelor produc același markup ca cele React", () => {
  const user = { id: "u1", name: "Ana Maria", url: "/members/u1-ana-maria", image: null, nameKey: "admin", frameKey: null };

  test("avatarul (fără imagine, cu imagine și ramă, cu clasă)", () => {
    expect(tree(avatarHtml(user, { size: "s" }))).toEqual(tree(react(createElement(GcsAvatar, { name: "Ana Maria", size: "s" }))));
    expect(tree(avatarHtml({ ...user, image: "/files/a.png", frameKey: "neon" }, { size: "l" }))).toEqual(
      tree(react(createElement(GcsAvatar, { name: "Ana Maria", size: "l", src: "/files/a.png", frame: "neon" }))),
    );
    expect(tree(avatarHtml(user, { size: "m", class: "gcs-hoverCard__avatar" }))).toEqual(
      tree(react(createElement(GcsAvatar, { name: "Ana Maria", size: "m", className: "gcs-hoverCard__avatar" }))),
    );
  });

  test("numele stilizat (linkul cu hover card)", () => {
    expect(tree(usernameHtml(user, {}))).toEqual(tree(react(createElement(GcsUserLink, { userId: "u1", name: "Ana Maria", nameKey: "admin", href: "/members/u1-ana-maria" }))));
  });

  test("iconițele Font Awesome", () => {
    for (const name of ["fa-solid fa-star", "fa-regular fa-comment", "fa-brands fa-css3-alt"]) {
      const def = resolveIcon(name)!;
      expect(tree(templateIconSvg(name, {}))).toEqual(tree(react(createElement(GcsIconSvg, { icon: def }))));
    }
    expect(tree(templateIconSvg("fa-regular fa-eye", { class: "gcs-metaIcon" }))).toEqual(tree(react(createElement(GcsIconSvg, { icon: resolveIcon("fa-regular fa-eye")!, className: "gcs-metaIcon" }))));
    expect(templateIconSvg("fa-solid fa-nu-exista", {})).toBe("");
  });

  test("toate iconițele folosite de șabloanele implicite există", () => {
    const names = new Set<string>(Object.values(TEMPLATE_GROUP_ICONS));
    for (const def of DEFAULT_TEMPLATES) {
      names.add(def.icon);
      for (const m of def.source.matchAll(/\{% icon "([^"]+)"/g)) names.add(m[1]!);
    }
    expect([...names].filter((n) => !resolveIcon(n))).toEqual([]);
  });
});

describe("HTML → React", () => {
  test("textul pe mai multe rânduri se comportă ca în JSX (indentarea nu adaugă spații)", () => {
    expect(jsxText("\n    ")).toBe("");
    expect(jsxText("a  b")).toBe("a  b");
    expect(jsxText("\n   de \n   ")).toBe("de");
    expect(jsxText("x\n  y")).toBe("x y");
  });

  test("atributele, stilurile, linkurile interne și sloturile", () => {
    const html = sanitizeTemplateHtml(
      '<div class="a" style="background: rgba(1, 2, 3, 0.5); --gcs-x: 3px; font-size: 12px" data-testid="row" tabindex="0">\n  <a href="/forum/1-x">F</a>\n  <a href="https://e.example" target="_blank">E</a>\n  <gcs-slot data-name="select"></gcs-slot>\n  <time datetime="2026-01-01T00:00:00.000Z">t</time>\n</div>',
    );
    const out = react(htmlToReact(html, { select: createElement("input", { type: "checkbox", className: "gcs-modCheck" }) }) as ReactElement);
    expect(out).toBe(
      '<div class="a" style="background:rgba(1, 2, 3, 0.5);--gcs-x:3px;font-size:12px" data-testid="row" tabindex="0"><a href="/forum/1-x">F</a><a href="https://e.example" target="_blank" rel="noopener">E</a><input type="checkbox" class="gcs-modCheck"/><time dateTime="2026-01-01T00:00:00.000Z">t</time></div>',
    );
  });

  test("un slot obligatoriu lipsă se adaugă la final; unul nefolosit nu", () => {
    const out = react(htmlToReact("<p>x</p>", { powered: createElement("b", null, "GCS"), other: createElement("i", null, "y") }, ["powered"]) as ReactElement);
    expect(out).toBe("<p>x</p><b>GCS</b>");
  });

  test("SVG-ul iconițelor păstrează viewBox", () => {
    const out = react(htmlToReact(sanitizeTemplateHtml(templateIconSvg("fa-solid fa-star", {}))) as ReactElement);
    expect(out).toMatch(/^<svg class="gcs-icon" viewBox="0 0 \d+ \d+"/);
  });
});
