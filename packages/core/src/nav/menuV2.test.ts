import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsAppService } from "../apps/service";
import { GcsForbidden, GcsValidationError } from "../errors";
import type { GcsModule } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import { GcsSettingsService } from "../settings/service";
import { GcsNavService, NAV_SEPARATOR_HREF, type GcsNavItemInput } from "./service";

const base: GcsModule = {
  key: "navbase",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  nav: [{ key: "forum", labelKey: "nav.forum", icon: "fa-solid fa-comments", href: "/", position: 0 }],
};
const optional: GcsModule = {
  key: "navopt",
  permissions: [],
  settings: [],
  acpMenu: [],
  eventListeners: [],
  app: { optional: true, labelKey: "apps.navopt", icon: "fa-solid fa-gamepad" },
  nav: [{ key: "opt", labelKey: "nav.opt", icon: "fa-solid fa-gamepad", href: "/opt", position: 1, children: [{ key: "optsub", labelKey: "nav.optsub", icon: "fa-solid fa-star", href: "/opt/sub" }] }],
};

let w: GcsTestWorld;
let apps: GcsAppService;
let nav: GcsNavService;
let root: GcsActor;
let member: GcsActor;
let guest: GcsActor;

beforeEach(async () => {
  w = await createWorld([base, optional]);
  apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings: new GcsSettingsService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry }) });
  nav = new GcsNavService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, apps, isIcon: (n) => n.startsWith("fa-solid fa-") });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
  guest = { userId: null, groupIds: [w.groups.guest!], primaryGroupId: w.groups.guest!, isBanned: false, ip: "203.0.113.9" };
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

const hrefs = async (viewer: GcsActor) => (await nav.tree(viewer, "ro")).map((i) => [i.href, i.children.map((c) => c.href)]);

describe("managerul de meniu v2", () => {
  test("tipurile: grup (dropdown) cu subitemi și separator; separatorii de la capete și dublați dispar", async () => {
    const items: GcsNavItemInput[] = [
      { kind: "link", label: { ro: "Acasă" }, href: "/" },
      {
        kind: "dropdown",
        label: { ro: "Comunitate" },
        children: [
          { kind: "separator", label: {} },
          { label: { ro: "Membri" }, href: "/members" },
          { kind: "separator", label: {} },
          { kind: "separator", label: {} },
          { label: { ro: "Staff" }, href: "/staff" },
          { kind: "separator", label: {} },
        ],
      },
      { kind: "dropdown", label: { ro: "Gol" }, children: [{ kind: "separator", label: {} }] },
    ];
    await nav.save(root, items);
    const tree = await nav.tree(member, "ro");
    expect(tree.map((i) => i.href)).toEqual(["/", "#"]);
    expect(tree[1]!.children.map((c) => (c.separator ? "—" : c.href))).toEqual(["/members", "—", "/staff"]);
    expect(tree[1]!.children[1]).toMatchObject({ href: NAV_SEPARATOR_HREF, separator: true });
    // Editorul primește tipurile înapoi.
    const edit = await nav.editable();
    expect(edit.map((e) => e.kind)).toEqual(["link", "dropdown", "dropdown"]);
    expect(edit[1]!.children.map((c) => c.kind)).toEqual(["separator", "link", "separator", "separator", "link", "separator"]);
  });

  test("salvarea păstrează id-ul itemilor neschimbați (meniul împărțit din antet îi ține minte după id)", async () => {
    const base: GcsNavItemInput[] = [
      { label: { ro: "Acasă" }, href: "/" },
      { kind: "dropdown", label: { ro: "Comunitate" }, children: [{ label: { ro: "Membri" }, href: "/members" }, { kind: "separator", label: {} }, { label: { ro: "Staff" }, href: "/staff" }] },
      { label: { ro: "Clanuri" }, href: "/clans" },
    ];
    await nav.save(root, base);
    const ids = (list: Awaited<ReturnType<typeof nav.editable>>) => list.map((i) => [i.id, i.children.map((c) => c.id)] as const);
    const before = ids(await nav.editable());
    const [home] = before[0]!;
    const [group, [members, sep, staff]] = before[1]!;
    const [clans] = before[2]!;
    // Ordinea schimbată, „Clanuri” redenumit, un item nou: doar cei neschimbați își păstrează id-ul.
    await nav.save(root, [
      { kind: "dropdown", label: { ro: "Comunitate" }, children: [{ label: { ro: "Staff" }, href: "/staff" }, { kind: "separator", label: {} }, { label: { ro: "Membri" }, href: "/members" }] },
      { label: { ro: "Acasă" }, href: "/" },
      { label: { ro: "Echipe" }, href: "/clans" },
      { label: { ro: "Nou" }, href: "/new" },
    ]);
    const after = ids(await nav.editable());
    expect(after[0]).toEqual([group, [staff, sep, members]]);
    expect(after[1]![0]).toBe(home);
    expect([after[2]![0], after[3]![0]]).not.toContain(clans);
    expect(new Set(after.map(([id]) => id)).size).toBe(4);
  });

  test("validarea tipurilor: separator pe primul nivel, pagină de aplicație fără aplicație, valori necunoscute", async () => {
    const fields = (items: GcsNavItemInput[]) =>
      nav.save(root, items).then(
        () => null,
        (e: { fields?: Record<string, string> }) => e.fields,
      );
    expect(await fields([{ kind: "separator", label: {} }])).toEqual({ "items.0.kind": "separator_top" });
    expect(await fields([{ kind: "app", label: { ro: "x" }, href: "/x" }])).toEqual({ "items.0.appKey": "required" });
    expect(await fields([{ kind: "nou" as never, label: { ro: "x" }, href: "/x" }])).toEqual({ "items.0.kind": "invalid_choice" });
    expect(await fields([{ label: { ro: "x" }, href: "/x", audience: "toti" as never }])).toEqual({ "items.0.audience": "invalid_choice" });
    expect(await fields([{ label: { ro: "x" }, href: "/x", counter: "bani" }])).toEqual({ "items.0.counter": "invalid_choice" });
    expect(await fields([{ label: { ro: "x" }, href: "/x", highlight: "rosu" }])).toEqual({ "items.0.highlight": "invalid_choice" });
  });

  test("vizibilitatea: doar vizitatorii / doar membrii, plus grupurile", async () => {
    await nav.save(root, [
      { label: { ro: "Toți" }, href: "/" },
      { label: { ro: "Înscrie-te" }, href: "/register", audience: "guests" },
      { label: { ro: "Setări" }, href: "/settings", audience: "members" },
      { label: { ro: "Staff" }, href: "/admin", groups: [w.groups.root_admin!] },
    ]);
    expect((await hrefs(guest)).map(([h]) => h)).toEqual(["/", "/register"]);
    expect((await hrefs(member)).map(([h]) => h)).toEqual(["/", "/settings"]);
    expect((await hrefs(root)).map(([h]) => h)).toEqual(["/", "/settings", "/admin"]);
  });

  test("insigna: fixă („NOU”) sau contor live (doar peste 0); evidențierea ajunge în arbore", async () => {
    await nav.save(root, [
      { label: { ro: "Nou" }, href: "/new", badge: "NOU", highlight: "accent" },
      { label: { ro: "Online" }, href: "/online", counter: "online", badge: "X" },
      { label: { ro: "Azi" }, href: "/today", counter: "topics_today" },
    ]);
    nav.setCounterResolver(async (key) => (key === "online" ? 12 : 0));
    const tree = await nav.tree(member, "ro");
    expect(tree.map((i) => [i.href, i.badge, i.highlight])).toEqual([
      ["/new", "NOU", "accent"],
      ["/online", "12", null],
      ["/today", null, null],
    ]);
  });

  test("ciorna: salvarea nu schimbă site-ul; previzualizarea o arată; „Publică” o aplică, „Renunță” o șterge", async () => {
    const before = await hrefs(member);
    await nav.saveDraft(root, [{ label: { ro: "Ciornă" }, href: "/draft" }]);
    expect(await hrefs(member)).toEqual(before);
    expect((await nav.draft())?.items.map((i) => i.href)).toEqual(["/draft"]);

    let previewing = true;
    nav.setPreviewResolver(async () => previewing);
    expect(await hrefs(member)).toEqual([["/draft", []]]);
    previewing = false;
    expect(await hrefs(member)).toEqual(before);

    expect(await nav.publishDraft(root)).toBe(true);
    expect(await hrefs(member)).toEqual([["/draft", []]]);
    expect(await nav.draft()).toBeNull();
    expect(await w.db.auditLog.count({ where: { action: "nav.save" } })).toBe(1);

    await nav.saveDraft(root, [{ label: { ro: "Altceva" }, href: "/altceva" }]);
    await nav.discardDraft(root);
    expect(await nav.draft()).toBeNull();
    expect(await hrefs(member)).toEqual([["/draft", []]]);
    expect(await nav.publishDraft(root)).toBe(false);
  });

  test("„Restaurează implicit” pune meniul modulelor în ciornă; itemii aplicațiilor apar și dispar cu aplicația", async () => {
    await nav.save(root, [{ label: { ro: "Doar asta" }, href: "/x" }]);
    await nav.restoreDefaultsToDraft(root);
    const draft = await nav.draft();
    expect(draft?.items.map((i) => [i.href, i.kind, i.appKey])).toEqual([
      ["/", "link", null],
      ["/opt", "app", "navopt"],
    ]);
    await nav.publishDraft(root);
    expect(await hrefs(member)).toEqual([
      ["/", []],
      ["/opt", ["/opt/sub"]],
    ]);
    await apps.setEnabled(root, "navopt", false);
    expect(await hrefs(member)).toEqual([["/", []]]);
  });

  test("„Link scurt”: doar pe subitemi (pe primul nivel și pe separatori se pierde), în arbore, în editor și în ciornă", async () => {
    const items: GcsNavItemInput[] = [
      { label: { ro: "Sus" }, href: "/sus", shortLink: true },
      {
        kind: "dropdown",
        label: { ro: "Comunitate" },
        children: [
          { label: { ro: "Membri" }, href: "/members", description: { ro: "Lista membrilor" } },
          { kind: "separator", label: {}, shortLink: true },
          { label: { ro: "Reguli" }, href: "/rules", shortLink: true },
        ],
      },
    ];
    await nav.save(root, items);
    const tree = await nav.tree(member, "ro");
    expect(tree[0]!.shortLink).toBe(false);
    expect(tree[1]!.children.map((c) => [c.href, c.shortLink])).toEqual([
      ["/members", false],
      [NAV_SEPARATOR_HREF, undefined],
      ["/rules", true],
    ]);
    expect(tree[1]!.children[0]!.description).toEqual({ text: "Lista membrilor" });
    const edit = await nav.editable();
    expect(edit[0]!.shortLink).toBe(false);
    expect(edit[1]!.children.map((c) => c.shortLink)).toEqual([false, false, true]);

    // Ciorna (previzualizarea) are aceleași reguli.
    await nav.saveDraft(root, items);
    nav.setPreviewResolver(async () => true);
    const preview = await nav.tree(member, "ro");
    expect(preview[0]!.shortLink).toBe(false);
    expect(preview[1]!.children.map((c) => c.shortLink ?? false)).toEqual([false, false, true]);
    nav.setPreviewResolver(null);
  });

  test("validarea: „Link scurt” e boolean; descrierea are cel mult 100 de caractere, pe un rând, în limbile site-ului", async () => {
    const fields = (items: GcsNavItemInput[]) =>
      nav.save(root, items).then(
        () => null,
        (e: { fields?: Record<string, string> }) => e.fields,
      );
    const group = (child: GcsNavItemInput): GcsNavItemInput[] => [{ kind: "dropdown", label: { ro: "Grup" }, children: [child] }];
    expect(await fields(group({ label: { ro: "x" }, href: "/x", shortLink: "da" as never }))).toEqual({ "items.0.children.0.shortLink": "invalid" });
    expect(await fields(group({ label: { ro: "x" }, href: "/x", description: { ro: "d".repeat(101) } }))).toEqual({ "items.0.children.0.description": "invalid" });
    expect(await fields(group({ label: { ro: "x" }, href: "/x", description: { ro: "două\nrânduri" } }))).toEqual({ "items.0.children.0.description": "invalid" });
    expect(await fields(group({ label: { ro: "x" }, href: "/x", description: { xx: "limbă necunoscută" } }))).toEqual({ "items.0.children.0.description": "invalid" });
    expect(await fields(group({ label: { ro: "x" }, href: "/x", description: { ro: "d".repeat(100) }, shortLink: true }))).toBeNull();
  });

  test("ciorna cere dreptul pe Manager meniu și e validată ca meniul publicat", async () => {
    await expect(nav.saveDraft(member, [])).rejects.toBeInstanceOf(GcsForbidden);
    await expect(nav.discardDraft(member)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(nav.saveDraft(root, [{ label: { ro: "x" }, href: "javascript:alert(1)" }])).rejects.toBeInstanceOf(GcsValidationError);
  });
});
