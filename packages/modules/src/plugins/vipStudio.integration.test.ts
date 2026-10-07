import { buildVipStudio } from "@gcs/plugin-sdk/vip-studio";
import { parseMemberAppearance, type GcsActor } from "@gcs/core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closePluginServices, createPluginServices, resetPluginWorld, TEST_SIGN } from "../../test/pluginWorld";
import type { GcsServices } from "../services";

const KEY = "gcs.vip_studio";

let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;
let guest: GcsActor;
let groups: Record<string, number>;

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
  ({ root, member, guest, groups } = await resetPluginWorld(services, [KEY]));
  const zip = await buildVipStudio({ sign: TEST_SIGN });
  const { id, report } = await services.pluginAdmin.stage(root, { fileName: "gcs.vip_studio.zip", data: zip });
  expect(report.checks.filter((c) => c.level === "error")).toEqual([]);
  expect(report.signature).toEqual({ status: "signed", keyId: "test" });
  await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY });
}, 180_000);

afterAll(async () => {
  await closePluginServices(services, configDir, [KEY]);
});

const page = (actor: GcsActor, path = "/", query: Record<string, string> = {}) => services.plugins.renderPage(KEY, path, { actor, locale: "ro", query, area: "site" });
const acpPage = (path: string, query: Record<string, string> = {}) => services.plugins.renderPage(KEY, path, { actor: root, locale: "ro", query, area: "acp" });
const api = (actor: GcsActor, path: string, body: Record<string, unknown>, acp = false) => services.plugins.handleApi(KEY, { method: "POST", path, query: {}, body, actor, locale: "ro", form: true, acp });
const html = (r: Awaited<ReturnType<typeof page>>) => (r.status === 200 ? r.html : "");

describe("Studio VIP: instalat ca plugin semnat", () => {
  test("se încarcă: paginile, ACP-ul, JS-ul (semnat) și catalogul implicit", async () => {
    expect(services.plugins.loadedKeys()).toEqual([KEY]);
    const studio = await page(member);
    expect(studio).toMatchObject({ status: 200, title: "Studio VIP", scripts: [expect.stringMatching(/^\/plugins\/gcs\.vip_studio\/assets\/vip\.js\?v=/)] });
    const h = html(studio);
    expect(h).toContain('<form class="gcsp-form" method="post" action="/api/plugins/gcs.vip_studio/save"');
    expect(h).toContain('value="neon" name="nameStyle"');
    expect(h).toMatch(/value="neon:cyan"[^>]*name="nameVariant"/);
    expect(h).toContain("/plugins/gcs.vip_studio/assets/frames/ember.png");
    // Ne-VIP: poate încerca, dar vede chemarea spre VIP.
    expect(h).toContain("gcsp-notice--vip");
    expect(await page(guest)).toEqual({ status: 403 });
    const acp = await acpPage("/frames");
    expect(acp).toMatchObject({ status: 200 });
    expect(html(acp)).toContain('action="/api/plugins/gcs.vip_studio/acp/action"');
    expect((await services.plugins.asset(KEY, "assets/frames/ember.png"))?.contentType).toBe("image/png");
  });

  test("ne-VIP: salvarea e refuzată (vip_required)", async () => {
    const r = await api(member, "/save", { nameStyle: "neon", nameVariant: "neon:red" });
    expect(r).toMatchObject({ status: 403, body: { ok: false, error: "vip_required" }, redirect: expect.stringContaining("error=vip_required") });
  });

  test("VIP: salvarea publică aspectul validat de GCS; CSS-ul numelor îl include", async () => {
    await services.vip.grant(root, { userId: member.userId!, groupId: groups.vip_gold!, days: 30 });
    const r = await api(member, "/save", {
      nameStyle: "neon",
      nameVariant: ["duo:red", "neon:cyan"],
      frame: "ember",
      banner: "gold_shine",
      card: "nebula",
      cardX: "30",
      cardY: "60",
      weapon: "rifle",
      background: "aurora",
      quote: "Joc pentru echipă",
      theme: "carbon",
      gcsp_mode: "full",
      gcsp_tab_full: "quote",
    });
    expect(r).toMatchObject({ status: 200, body: { ok: true, published: true }, redirect: "/p/gcs.vip_studio?saved=1&tab=quote" });
    const a = await services.appearance.forUser(member.userId!);
    expect(a).toMatchObject({
      name: { effect: "neon", fill: { colors: ["#22D3EE", "#0E7490"] } },
      banner: { label: "VIP Gold" },
      frame: { image: "/plugins/gcs.vip_studio/assets/frames/ember.png" },
      flair: { label: "Pușcă de asalt" },
      profile: { quote: { text: "Joc pentru echipă" }, theme: { key: "carbon" } },
    });
    expect(parseMemberAppearance(a, { pluginKey: KEY }).ok).toBe(true);
    const css = await services.appearance.css();
    expect(css).toContain(`[data-user-id="${member.userId}"]`);
    expect(css).toContain("assets/frames/ember.png");
    // Studioul arată alegerile salvate.
    const h = html(await page(member));
    expect(h).toMatch(/value="ember" checked[^>]*name="frame"/);
    expect(h).toContain("Joc pentru echipă");
  });

  test("un element rezervat altui plan e refuzat la salvare, cu planul lui", async () => {
    const crown = html(await acpPage("/frames")).match(/data-gcsp-item="crown"[\s\S]*?href="\/admin\/plugins\/gcs\.vip_studio\/item\/(\d+)"/);
    expect(crown).not.toBeNull();
    const id = crown![1]!;
    const save = await api(root, "/acp/item", { kind: "frame", id, name: "Coroană", plans: ["vip_legend"], scale: "136", x: "0", y: "0", enabled: "1" }, true);
    expect(save).toMatchObject({ status: 200, redirect: `/admin/plugins/gcs.vip_studio/item/${id}?saved=1` });
    const r = await api(member, "/save", { frame: "crown" });
    expect(r).toMatchObject({ status: 422, body: { ok: false, error: "locked", problems: [{ group: "frame", plans: ["VIP Legend"] }] } });
  });

  test("rutele ACP cer poarta ACP", async () => {
    expect(await api(root, "/acp/action", { op: "presets_missing" }, false)).toEqual({ status: 403, body: { error: "forbidden" } });
  });

  test("ACP: o ramă nouă încărcată (recodată de GCS), aleasă de membru, apoi ștearsă", async () => {
    const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 80, b: 0, alpha: 0.6 } } }).png().toBuffer();
    const file = await services.plugins.uploadMedia(KEY, { bytes: png }, root);
    expect(file).toMatchObject({ kind: "image", mime: "image/webp", status: "pending" });
    const created = await api(root, "/acp/item", { kind: "frame", name: "Rama mea", file, scale: "140", x: "0", y: "-4", enabled: "1" }, true);
    expect(created.redirect).toMatch(/^\/admin\/plugins\/gcs\.vip_studio\/item\/\d+\?saved=1$/);
    expect((await services.pluginMedia.get(KEY, [file.id]))[0]?.status).toBe("kept");
    const list = html(await acpPage("/frames"));
    const key = /data-gcsp-item="(rama_mea_[a-z0-9]+)"/.exec(list)?.[1];
    expect(key).toBeDefined();

    // Formularul trimite mereu tot echipamentul.
    await api(member, "/save", { nameStyle: "neon", nameVariant: "neon:cyan", frame: key, banner: "gold_shine", quote: "Joc pentru echipă" });
    expect((await services.appearance.forUser(member.userId!))?.frame).toEqual({ image: file.url, scale: 140, x: 0, y: -4 });

    // Ștergerea: membrul revine la implicit, fișierul dispare.
    const id = /item\/(\d+)/.exec(created.redirect!)![1]!;
    expect((await api(root, "/acp/delete", { op: "item", id }, true)).redirect).toBe("/admin/plugins/gcs.vip_studio/frames?deleted=1");
    expect((await services.appearance.forUser(member.userId!))?.frame).toBeUndefined();
    expect(await services.pluginMedia.get(KEY, [file.id])).toEqual([]);
  });

  test("o ramă cu proporții greșite e refuzată, iar fișierul nu rămâne", async () => {
    const wide = await sharp({ create: { width: 600, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const file = await services.plugins.uploadMedia(KEY, { bytes: wide }, root);
    const r = await api(root, "/acp/item", { kind: "frame", name: "Lată", file, enabled: "1" }, true);
    expect(r).toMatchObject({ status: 422, redirect: "/admin/plugins/gcs.vip_studio/new/frame?error=frame_ratio" });
    expect(await services.pluginMedia.get(KEY, [file.id])).toEqual([]);
  });

  test("widget-ul VIP online și pagina beneficiilor", async () => {
    const w = await services.plugins.renderWidget(`plugin.${KEY}.roster`, { config: { limit: 12 }, actor: guest, locale: "ro", page: "index", zone: "sidebar" });
    expect(w?.html).toContain('data-gcsp-roster="1"');
    expect(w?.html).toContain(`data-user-id="${member.userId}"`);
    expect(w?.html).toContain("gcsp-fx-neon");
    expect(w?.scripts).toEqual([expect.stringMatching(/assets\/vip\.js/)]);
    const benefits = await page(guest, "/benefits");
    expect(html(benefits)).toContain("stiluri de nume");
  });

  test("ACP: resetarea echipamentului unui membru", async () => {
    expect(html(await acpPage("/members"))).toContain(`data-user-id="${member.userId}"`);
    await api(root, "/acp/action", { op: "reset_quote", userId: member.userId }, true);
    expect((await services.appearance.forUser(member.userId!))?.profile?.quote).toBeUndefined();
    expect((await services.appearance.forUser(member.userId!))?.name).toBeDefined();
  });

  test("VIP retras: aspectul dispare, alegerile rămân salvate", async () => {
    const sub = await services.vip.active(member.userId!);
    await services.vip.revoke(root, sub!.id);
    await services.plugins.idle();
    expect(await services.appearance.forUser(member.userId!)).toBeNull();
    expect(html(await page(member))).toContain('value="neon" checked name="nameStyle"');
  });

  test("dezinstalarea completă șterge aspectul și fișierele pluginului", async () => {
    await services.pluginAdmin.uninstall(root, KEY, { keepData: false });
    expect(await services.db.memberAppearance.count()).toBe(0);
    expect(await services.db.pluginMedia.count()).toBe(0);
  });
});
