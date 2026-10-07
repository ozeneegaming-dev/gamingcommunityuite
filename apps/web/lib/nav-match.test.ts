import { describe, expect, test } from "vitest";
import { activeNavHref, fitCount, navActive, withoutDuplicateChildren, withoutHrefs } from "./nav-match";

type Item = { id: string; href: string; children: Item[] };
const leaf = (id: string, href: string): Item => ({ id, href, children: [] });

// Meniul implicit: Forum · Activitate · Chat · Membri ▾ · Clasament · VIP · Reguli.
const MENU: Item[] = [
  leaf("forum", "/"),
  leaf("activity", "/activity"),
  leaf("chat", "/chat"),
  {
    id: "members",
    href: "/members",
    children: [leaf("all", "/members"), leaf("online", "/members?online=1"), leaf("staff", "/staff"), leaf("sub-leaderboard", "/leaderboard")],
  },
  leaf("leaderboard", "/leaderboard"),
  leaf("vip", "/vip"),
  leaf("rules", "/rules"),
];

const activeIds = (pathname: string, search = "") => {
  const { isActive } = navActive(MENU, pathname, search);
  const all = MENU.flatMap((i) => [i, ...i.children]);
  return all.filter((i) => isActive(i)).map((i) => i.id);
};

describe("linkul activ al meniului", () => {
  test("„/” e activ doar pe pagina principală; o cale activează și paginile de sub ea", () => {
    expect(activeNavHref("/", "", ["/", "/activity"])).toBe("/");
    expect(activeNavHref("/forum/3-general", "", ["/", "/activity"])).toBeNull();
    expect(activeNavHref("/members/12-ana", "", ["/", "/members"])).toBe("/members");
    expect(activeNavHref("/membersx", "", ["/members"])).toBeNull();
    expect(activeNavHref("/chat", "", ["https://discord.gg/x", "//evil.com"])).toBeNull();
  });

  test("parametrii contează: „Online acum” bate „Toți membrii” doar cu ?online=1", () => {
    expect(activeIds("/members")).toEqual(["members", "all"]);
    expect(activeIds("/members", "online=1&page=2")).toEqual(["members", "online"]);
    expect(activeIds("/members", "online=0")).toEqual(["members", "all"]);
    expect(activeIds("/staff")).toEqual(["members", "staff"]);
  });

  test("Clasament (și în bară, și sub Membri) aprinde butonul lui, nu și Membri", () => {
    expect(activeIds("/leaderboard", "metric=posts")).toEqual(["sub-leaderboard", "leaderboard"]);
  });

  test("o pagină din afara meniului nu aprinde nimic", () => {
    expect(activeIds("/settings/profile")).toEqual([]);
  });
});

describe("itemii ascunși și dublurile", () => {
  test("Reguli dispare cât timp regulile sunt goale; un submeniu golit dispare cu totul", () => {
    expect(withoutHrefs(MENU, new Set(["/rules"])).map((i) => i.id)).toEqual(["forum", "activity", "chat", "members", "leaderboard", "vip"]);
    const hidden = withoutHrefs(MENU, new Set(["/members", "/members?online=1", "/staff", "/leaderboard"]));
    expect(hidden.map((i) => i.id)).toEqual(["forum", "activity", "chat", "vip", "rules"]);
    expect(withoutHrefs(MENU, new Set())).toEqual(MENU);
  });

  test("în sertar, Clasament nu se repetă sub Membri", () => {
    const members = withoutDuplicateChildren(MENU).find((i) => i.id === "members")!;
    expect(members.children.map((c) => c.id)).toEqual(["all", "online", "staff"]);
  });
});

describe("„Mai mult”", () => {
  test("toate butoanele încap: niciunul nu se mută", () => {
    expect(fitCount([100, 100, 100], 80, 2, 304)).toBe(3);
  });

  test("altfel, încap câte au loc lângă „Mai mult”, de la început", () => {
    expect(fitCount([100, 100, 100], 80, 2, 303)).toBe(2);
    expect(fitCount([100, 100, 100], 80, 2, 200)).toBe(1);
    expect(fitCount([100, 100, 100], 80, 2, 50)).toBe(0);
  });
});
