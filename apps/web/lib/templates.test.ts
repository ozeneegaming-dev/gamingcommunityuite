import {
  avatarHtml,
  DEFAULT_TEMPLATES,
  defaultTemplate,
  parseHtmlTree,
  parseStyleAttribute,
  renderTemplate,
  sanitizeTemplateHtml,
  TEMPLATE_GROUP_ICONS,
  usernameHtml,
  type GcsHtmlNode,
} from "@gcs/core";
import { templateComponents, templateIconSvg, type GcsCardView, type GcsClanTag as GcsClanTagView, type GcsPostAuthor, type GcsPostbitData } from "@gcs/modules";
import { GcsAvatar, GcsClanTag, GcsHoverCard, GcsUserLink } from "@gcs/ui";
import { GcsIconSvg } from "@gcs/ui/icons";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { hoverCardVars, postbitVars } from "./template-data";
import { htmlToReact, jsxText } from "./templates";

/** Arborele HTML (după sanitizer), ca să comparăm structura fără ordinea atributelor. */
const tree = (html: string) => parseHtmlTree(sanitizeTemplateHtml(html));
const react = (el: ReactElement) => renderToStaticMarkup(el);

describe("componentele șabloanelor produc același markup ca cele React", () => {
  const user = { id: "u1", name: "Ana Maria", url: "/members/u1-ana-maria", image: null, nameKey: "admin", frameKey: null };

  test("avatarul (fără imagine, cu imagine și ramă, cu clasă)", () => {
    expect(tree(avatarHtml(user, { size: "s" }))).toEqual(tree(react(createElement(GcsAvatar, { name: "Ana Maria", userId: "u1", size: "s" }))));
    expect(tree(avatarHtml({ ...user, image: "/files/a.png", frameKey: "neon" }, { size: "l" }))).toEqual(
      tree(react(createElement(GcsAvatar, { name: "Ana Maria", userId: "u1", size: "l", src: "/files/a.png", frame: "neon" }))),
    );
    expect(tree(avatarHtml(user, { size: "m", class: "gcs-hoverCard__avatar" }))).toEqual(
      tree(react(createElement(GcsAvatar, { name: "Ana Maria", userId: "u1", size: "m", className: "gcs-hoverCard__avatar" }))),
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

/** Arborele fără spațiile de indentare și cu stilurile ca obiecte (ordinea și formatarea declarațiilor nu contează). */
function normalized(html: string): unknown[] {
  const walk = (nodes: GcsHtmlNode[]): unknown[] =>
    nodes.flatMap((n): unknown[] => {
      if (n.type === "text") {
        const text = jsxText(n.text);
        return text ? [text] : [];
      }
      const attrs: Record<string, unknown> = { ...n.attrs };
      if (n.attrs.style !== undefined) attrs.style = parseStyleAttribute(n.attrs.style);
      return [{ name: n.name, attrs, children: walk(n.children) }];
    });
  return walk(parseHtmlTree(sanitizeTemplateHtml(html)));
}

describe("hover card-ul: șablonul implicit `members.hover_card` produce markup-ul componentei React", () => {
  const texts: Record<string, string> = {
    "hoverCard.posts": "Postări",
    "hoverCard.reputation": "Reputație",
    "hoverCard.followers": "Urmăritori",
    "hoverCard.online": "Online",
    "hoverCard.joined": "Membru din",
  };
  const labels = { posts: "Postări", reputation: "Reputație", followers: "Urmăritori", online: "Online", joined: "Membru din" };
  const base: GcsCardView = {
    user: {
      id: "u1",
      name: "Ana Maria",
      image: null,
      nameKey: "admin",
      frameKey: null,
      groupKey: "admin",
      group: { name: "Administrator", color: "#D62839" },
      rank: { name: "Recrut", icon: null },
      slug: "ana-maria",
      bio: "",
      accentColor: null,
      cover: null,
      coverPositionY: 50,
    },
    stats: { posts: 1234, reputation: 0, followers: 3, joinedAt: "2026-06-15T12:00:00.000Z" },
    online: { online: false, hidden: false, lastActiveAt: null },
    badges: [],
    fields: [],
    viewer: { isSelf: false, isFollowing: false, canMessage: false, canFollow: false },
  };
  const template = (card: GcsCardView) =>
    renderTemplate(defaultTemplate("members.hover_card")!.source, hoverCardVars(card), { locale: "ro", translate: (key) => texts[key] ?? key, components: templateComponents() });
  const component = (card: GcsCardView) =>
    react(
      createElement(GcsHoverCard, {
        data: card,
        labels,
        format: { number: (n) => new Intl.NumberFormat("ro").format(n), year: (iso) => String(new Date(iso).getFullYear()) },
        ...(card.viewer.canFollow || card.viewer.canMessage ? { actions: createElement("gcs-slot", { "data-name": "actions" }) } : {}),
      }),
    );

  const cases: [string, GcsCardView][] = [
    ["vizitator, fără copertă, membru nou", base],
    [
      "cu copertă (poziția salvată), bio, insigne, câmpuri, online, rang cu emoji, acțiuni",
      {
        ...base,
        user: { ...base.user, image: "/files/avatar1", frameKey: "neon", bio: "Nu există lag.", accentColor: "#3DDC97", cover: "/files/cover1", coverPositionY: 30, rank: { name: "Veteran", icon: "🎖" } },
        stats: { ...base.stats, reputation: 12 },
        online: { online: true, hidden: false, lastActiveAt: null },
        badges: [
          { key: "b1", name: "Fondator", description: "Membru fondator", symbol: "F", image: null, color: "#F4B740", art: "/badge-art/v1/rosette-gold-f4b740-t-F.svg", awardedAt: "2026-06-15T12:00:00.000Z" },
          { key: "b2", name: "Lider", description: "", symbol: null, image: "/files/badge2", color: "#5EA2FF", art: "/badge-art/v1/medal-silver-5ea2ff-i-solid-crown.svg", awardedAt: "2026-06-15T12:00:00.000Z" },
        ],
        fields: [
          { label: "Țară", value: "România" },
          { label: "Rank CS2", value: "REGE" },
        ],
        viewer: { isSelf: false, isFollowing: false, canMessage: true, canFollow: true },
      },
    ],
    ["rang cu iconiță Font Awesome (nu apare ca text), reputație negativă", { ...base, user: { ...base.user, rank: { name: "Staff", icon: "fa-crown" } }, stats: { ...base.stats, reputation: -2 } }],
  ];

  test.each(cases)("%s", (_name, card) => {
    expect(normalized(template(card))).toEqual(normalized(component(card)));
  });

  test("cu tagul clanului lângă nume (aplicația Clanuri)", () => {
    const clan: GcsClanTagView = { id: 3, tag: "RLX", name: "Red Lynx", href: "/clans/3-red-lynx", color: "#F4B740", color2: "#1B1E26", ink: "#0B0C10", logoUrl: null, role: "OFFICER" };
    const html = renderTemplate(defaultTemplate("members.hover_card")!.source, hoverCardVars(base, clan), { locale: "ro", translate: (key) => texts[key] ?? key, components: templateComponents() });
    const card = { ...base, clan } as GcsCardView & { clan: GcsClanTagView };
    expect(normalized(html)).toEqual(normalized(component(card)));
    expect(html).toContain("gcs-clanTag");
  });

  test("numele și grupul stau sub copertă, nu în ea; coperta are poziția salvată", () => {
    const html = component(cases[1]![1]);
    const tree = normalized(html) as { children: { attrs: Record<string, unknown>; children: unknown[] }[] }[];
    const [cover, body] = tree[0]!.children;
    expect(cover!.children).toEqual([]);
    expect(cover!.attrs.style).toMatchObject({ background: "center 30% / cover no-repeat url(/files/cover1)", "--gcs-hoverCard-accent": "#3DDC97" });
    expect(JSON.stringify(body)).toContain("gcs-hoverCard__name");
    expect(component(cases[2]![1])).not.toContain("fa-crown");
  });
});

describe("postbit-ul: șablonul implicit `postbit.author`", () => {
  const author = {
    id: "u2",
    name: "Bl1ng",
    image: null,
    groupKey: "admin",
    nameKey: "admin",
    frameKey: null,
    rank: null,
    groupColor: "#D62839",
    groupName: "Administrator",
    groupTitle: null,
    postsCount: 9,
    reputation: 0,
    joinedAt: "2026-06-15T12:00:00.000Z",
    signatureHtml: "",
  } satisfies GcsPostAuthor;
  const data: GcsPostbitData = {
    customTitle: null,
    group: { key: "admin", name: "Administrator", color: "#D62839", icon: null, banner: null },
    vip: false,
    vipName: null,
    secondaryGroup: null,
    rankLevel: null,
    topicsCount: 2,
    motto: null,
    cover: { url: "/files/cover2", positionY: 35 },
    xp: { points: 0, floor: 0, next: null, nextRank: null, percent: 100 },
    badges: { count: 0, recent: [] },
    fields: [],
    online: true,
    joinedAt: "2026-06-15T12:00:00.000Z",
  };
  const render = (d: GcsPostbitData | null) =>
    sanitizeTemplateHtml(
      renderTemplate(defaultTemplate("postbit.author")!.source, postbitVars(author, d, { id: 1, number: 1 }), {
        locale: "ro",
        translate: (key) => key,
        components: templateComponents(),
        include: (name) => defaultTemplate(name)?.source ?? null,
      }),
    );

  test("coperta e fundalul blocului cu avatarul, cu poziția salvată; fără copertă blocul rămâne simplu", () => {
    const html = render(data);
    expect(html).toContain('class="gcs-postbit__profile gcs-postbit__profile--cover"');
    expect(html).toContain('<span class="gcs-postbit__cover" aria-hidden="true" style="background:center 35% / cover no-repeat url(/files/cover2)"');
    const plain = render({ ...data, cover: null });
    expect(plain).toContain('class="gcs-postbit__profile"');
    expect(plain).not.toContain("gcs-postbit__cover");
  });

  test("tagul clanului: aceeași plăcuță ca în componenta React, sub nume", () => {
    const clan: GcsClanTagView = { id: 3, tag: "RLX", name: "Red Lynx", href: "/clans/3-red-lynx", color: "#D62839", color2: "#1B1E26", ink: "#FFFFFF", logoUrl: null, role: "MEMBER" };
    const html = sanitizeTemplateHtml(
      renderTemplate(defaultTemplate("postbit.author")!.source, postbitVars(author, data, { id: 1, number: 1 }, clan), {
        locale: "ro",
        translate: (key) => key,
        components: templateComponents(),
        include: (name) => defaultTemplate(name)?.source ?? null,
      }),
    );
    const part = /<span class="gcs-postbit__clan"[\s\S]*?<\/span><\/span>/.exec(html)![0];
    const expected = react(
      createElement("span", { className: "gcs-postbit__clan", "data-testid": "gcs-postbit-clan" }, createElement(GcsClanTag, { clan, size: "sm" }), createElement("span", { className: "gcs-postbit__clanName" }, clan.name)),
    );
    expect(tree(part)).toEqual(tree(expected));
    expect(render(data)).not.toContain("gcs-postbit__clan");
  });

  test("statusul online apare o singură dată (sus), nu și în subsol", () => {
    const html = render(data);
    expect(html.match(/topic\.author\.statusOnline/g)).toHaveLength(1);
    expect(html).not.toContain("footStatus");
    expect(html).toContain("topic.author.memberSince");
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
