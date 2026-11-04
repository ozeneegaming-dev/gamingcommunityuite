import { isPremiumAppPackage, type GcsActor } from "@gcs/core";
import { buildRecruitment } from "@gcs/plugin-sdk/recruitment";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closePluginServices, createPluginServices, resetPluginWorld } from "../../test/pluginWorld";
import type { GcsServices } from "../services";

const KEY = "gcs.recruitment";

let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;
let guest: GcsActor;
let groups: Record<string, number>;

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
  ({ root, member, guest, groups } = await resetPluginWorld(services, [KEY]));
  const zip = await buildRecruitment();
  const { id, report } = await services.pluginAdmin.stage(root, { fileName: `${KEY}-1.0.0.zip`, data: zip });
  expect(report.checks.filter((c) => c.level === "error")).toEqual([]);
  await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY });
}, 180_000);

afterAll(async () => {
  await closePluginServices(services, configDir, [KEY]);
});

const html = async (a: GcsActor, path = "/", query: Record<string, string> = {}, area: "site" | "acp" = "site") => {
  const r = await services.plugins.renderPage(KEY, path, { actor: a, locale: "ro", query, area });
  return r.status === 200 ? r.html : `STATUS ${r.status}`;
};
const api = (a: GcsActor, path: string, body: Record<string, unknown>) => services.plugins.handleApi(KEY, { method: "POST", path, query: {}, body, actor: a, locale: "ro", form: true });
/** Rutele ACP (`acp: edit / delete`): gazda le primește doar cu `acp: true`, după verificarea rolului ACP din web. */
const acpApi = (a: GcsActor, path: string, body: Record<string, unknown>) => services.plugins.handleApi(KEY, { method: "POST", path, query: {}, body, actor: a, locale: "ro", form: true, acp: true });

describe("Recrutare (pluginul premium)", () => {
  test("e un pachet de aplicație premium: pornește doar cu licența care îl include", () => {
    expect(isPremiumAppPackage(KEY)).toBe(true);
    expect(services.plugins.loadedKeys()).toEqual([KEY]);
  });

  test("ACP: lista + panoul; posturile cu stare, grup și modul de aplicare", async () => {
    expect(await html(root, "/", { new: "1" }, "acp")).toContain(`action="/api/plugins/${KEY}/positions/save"`);
    expect(await acpApi(root, "/positions/save", { name: "Moderator", description: "Moderezi forumul.", status: "open", groupId: String(groups.moderator), applyMode: "form", questions: "Câți ani ai?\nDe ce tu?" })).toMatchObject({ body: { ok: true, id: 1 } });
    expect(await acpApi(root, "/positions/save", { name: "Designer", status: "closed", applyMode: "form" })).toMatchObject({ body: { ok: true, id: 2 } });
    expect(await acpApi(root, "/positions/save", { name: "Editor știri", status: "new", applyMode: "link", applyUrl: "https://forms.exemplu.ro/stiri" })).toMatchObject({ body: { ok: true, id: 3 } });
    expect(await acpApi(root, "/positions/save", { name: "Rău", status: "open", applyMode: "link", applyUrl: "javascript:alert(1)" })).toMatchObject({ status: 422, redirect: expect.stringContaining("error=position_url") });
    // Fără trecerea prin ACP (rolul verificat de web), ruta e refuzată.
    expect((await api(member, "/positions/save", { name: "Hack", status: "open" })).status).toBe(403);
    const acp = await html(root, "/", { edit: "1" }, "acp");
    expect(acp).toContain("Editează: Moderator");
    expect(acp).toContain("gcsp-rec__tag--off");
  });

  test("site: posturile; membrul aplică prin formular (o singură aplicație în așteptare)", async () => {
    const list = await html(guest);
    expect(list).toContain("Moderator");
    expect(list).toContain('href="https://forms.exemplu.ro/stiri"');
    expect(await html(member, "/apply/2")).toBe("STATUS 404");
    expect(await html(member, "/apply/1")).toContain(`action="/api/plugins/${KEY}/apply/1"`);
    expect(await api(guest, "/apply/1", { q0: "19", q1: "x" })).toMatchObject({ status: 403 });
    expect(await api(member, "/apply/1", { q0: "19", q1: "" })).toMatchObject({ status: 422, redirect: expect.stringContaining("answers_missing") });
    expect(await api(member, "/apply/1", { q0: "19", q1: "Sunt activ zilnic." })).toMatchObject({ body: { ok: true } });
    expect(await api(member, "/apply/1", { q0: "19", q1: "Din nou." })).toMatchObject({ status: 409 });
    expect(await html(member)).toContain("În așteptare");
  });

  test("ACP › Aplicații: răspunsurile și decizia", async () => {
    const apps = await html(root, "/applications", {}, "acp");
    expect(apps).toContain("Câți ani ai?");
    expect(apps).toContain("Sunt activ zilnic.");
    expect(await acpApi(root, "/applications/1/status", { status: "accepted", note: "Bun venit!" })).toMatchObject({ body: { ok: true, status: "accepted" } });
    expect(await html(member)).toContain("Acceptată");
  });

  test("rândul „Recrutare” pe index: posturile ca subforumuri, cu ON / OFF / NOU (tabul forumului)", async () => {
    const { forums, forumSlots } = services;
    const category = await forums.create({ parentId: null, type: "CATEGORY", name: "Comunitate" }, root);
    const row = await forums.create({ parentId: category.id, type: "FORUM", name: "Recrutare" }, root);
    const opts = { plugins: true };
    const ext = (await forumSlots.editTabs(row, opts)).find((t) => t.tab.key === "recruitment")!;
    expect(ext).toBeDefined();
    const ref = { id: row.id, type: row.type, parentId: row.parentId, name: row.name, slug: row.slug };
    expect((await forumSlots.list(guest, "ro", "index", [ref], opts)).get(row.id)?.meta ?? []).toEqual([]);
    await forumSlots.saveTab(root, { forumId: row.id, extension: ext.extension, tab: "recruitment", values: { positions: "on", closed: "on", card: "on" } }, opts);
    const meta = JSON.stringify((await forumSlots.list(guest, "ro", "index", [ref], opts)).get(row.id)?.meta ?? []);
    expect(meta).toContain("gcsp-rec__tag--on");
    expect(meta).toContain("gcsp-rec__tag--off");
    expect(meta).toContain("NOU");
    expect(meta).toContain("Editor știri");
  });
});
