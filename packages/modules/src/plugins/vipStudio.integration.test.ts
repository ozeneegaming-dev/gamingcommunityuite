import { crc32, deflateSync } from "node:zlib";
import { buildVipStudio } from "@gcs/plugin-sdk/vip-studio";
import { parseMemberAppearance, pluginSchema, type GcsActor } from "@gcs/core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { nameStyleData, V2_NAME_STYLES } from "../../../plugin-sdk/plugins/vip-studio/src/presets";
import PLUGIN_MANIFEST from "../../../plugin-sdk/plugins/vip-studio/plugin.json";
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
  // Versiunea instalată întâi e „1.0.0”; un test de la final o actualizează la versiunea curentă (plugin.json).
  const zip = await buildVipStudio({ sign: TEST_SIGN, version: "1.0.0" });
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

/** Un APNG mic, construit în test: cadre pline de culorile date, fiecare 100 ms, în buclă. */
function apng(w: number, h: number, colors: string[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const u32 = (...v: number[]) => Buffer.concat(v.map((x) => Buffer.from([(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255])));
  const pixels = (hex: string) => {
    const rgba = Buffer.from([Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16), 255]);
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 4).fill(rgba)]);
    return deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  };
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.concat([u32(w, h), Buffer.from([8, 6, 0, 0, 0])])), chunk("acTL", u32(colors.length, 0))];
  let seq = 0;
  colors.forEach((c, i) => {
    parts.push(chunk("fcTL", Buffer.concat([u32(seq++, w, h, 0, 0), Buffer.from([0, 1, 0, 10, 0, 0])])));
    parts.push(i === 0 ? chunk("IDAT", pixels(c)) : chunk("fdAT", Buffer.concat([u32(seq++), pixels(c)])));
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

describe("Studio VIP: instalat ca plugin semnat", () => {
  test("se încarcă: paginile, ACP-ul, JS-ul (semnat) și catalogul implicit", async () => {
    expect(services.plugins.loadedKeys()).toEqual([KEY]);
    const studio = await page(member);
    expect(studio).toMatchObject({ status: 200, title: "Studio VIP", scripts: [expect.stringMatching(/^\/plugins\/gcs\.vip_studio\/assets\/vip\.js\?v=/)] });
    const h = html(studio);
    expect(h).toContain('<form class="gcsp-form" method="post" action="/api/plugins/gcs.vip_studio/save"');
    expect(h).toContain('value="neon_tub" name="nameStyle"');
    expect(h).toMatch(/value="neon_tub:cyan"[^>]*name="nameVariant"/);
    // Plăcile arată efectele cu clasele GCS (aceleași reguli ca pe site), pe numele membrului, pe categorii.
    expect(h).toContain("gcs-nfx gcs-nfx--inferno");
    expect(h).toContain('data-text="Membru"');
    expect(h).toContain("data-gcsp-filter");
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
    const r = await api(member, "/save", { nameStyle: "neon_tub", nameVariant: "neon_tub:red" });
    expect(r).toMatchObject({ status: 403, body: { ok: false, error: "vip_required" }, redirect: expect.stringContaining("error=vip_required") });
  });

  test("VIP: salvarea publică aspectul validat de GCS; CSS-ul numelor îl include", async () => {
    await services.vip.grant(root, { userId: member.userId!, groupId: groups.vip_gold!, days: 30 });
    const r = await api(member, "/save", {
      nameStyle: "neon_tub",
      nameVariant: ["gradient_duo:red", "neon_tub:cyan"],
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
      name: { effect: "neon", fill: { colors: ["#22D3EE"] } },
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
    await api(member, "/save", { nameStyle: "neon_tub", nameVariant: "neon_tub:cyan", frame: key, banner: "gold_shine", quote: "Joc pentru echipă" });
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
    // Numele are stilul publicat în GCS (după `data-user-id`), cu textul pentru straturile efectelor.
    expect(w?.html).toContain('data-text="Membru"');
    expect(w?.scripts).toEqual([expect.stringMatching(/assets\/vip\.js/)]);
    const benefits = await page(guest, "/benefits");
    expect(html(benefits)).toContain("stiluri de nume");
  });

  test("meniul principal: „Studio VIP” apare în bara site-ului (și în meniul userului)", async () => {
    expect(await services.plugins.menus("site", member, "ro")).toEqual([expect.objectContaining({ key: "gcs.vip_studio.studio", label: "Studio VIP", href: "/p/gcs.vip_studio", icon: "fa-solid fa-crown" })]);
    expect(await services.plugins.menus("user", member, "ro")).toEqual([expect.objectContaining({ href: "/p/gcs.vip_studio" })]);
  });

  test("ACP: încărcarea în bloc — APNG animat, duplicatul sărit, fișierele greșite respinse cu motivul", async () => {
    const anim = apng(160, 160, ["#FF3B4E", "#22D3EE", "#FFD34D"]);
    const upload = (bytes: Buffer, name: string) => services.plugins.uploadMedia(KEY, { bytes, name }, root, { acp: true });
    const first = await upload(anim, "rama-animata.png");
    expect(first).toMatchObject({ kind: "image", mime: "image/webp", frames: 3, originalName: "rama-animata.png" });
    const copy = await upload(anim, "rama-animata - Copie.png");
    const small = await upload(await sharp({ create: { width: 64, height: 64, channels: 4, background: "#000000" } }).png().toBuffer(), "mica.png");
    const r = await api(root, "/acp/bulk", { kind: "frame", files: [first, copy, small, { error: "invalid_image", originalName: "stricata.png" }], scale: "132", enabled: "1" }, true);
    expect(r.redirect).toMatch(/^\/admin\/plugins\/gcs\.vip_studio\/upload\/[a-z0-9]+$/);
    expect(r.body).toEqual({ ok: true, added: 1, skipped: 1, rejected: 2 });
    const report = html(await acpPage(r.redirect!.replace("/admin/plugins/gcs.vip_studio", "")));
    expect(report).toContain("Adăugate: 1 · omise (duplicate): 1 · respinse: 2.");
    expect(report).toContain("animată, 3 cadre");
    expect(report).toContain("la fel ca „Rama animata”");
    expect(report).toContain("Rama trebuie să aibă cel puțin 128 px pe latură.");
    expect(report).toContain("Imaginea e deteriorată.");
    // Fișierele sărite sau respinse nu rămân; cel adăugat e păstrat și servit ca WebP animat.
    expect(await services.pluginMedia.get(KEY, [copy.id, small.id])).toEqual([]);
    const opened = await services.plugins.mediaFile(KEY, `${first.id}.webp`);
    const bytes = Buffer.from(await new Response(opened!.body).arrayBuffer());
    expect([bytes.toString("latin1", 0, 4), bytes.toString("latin1", 8, 12), bytes.includes(Buffer.from("ANIM"))]).toEqual(["RIFF", "WEBP", true]);
    // A doua încărcare a aceluiași fișier: sărită, ca duplicat al ramei din catalog.
    const again = await upload(anim, "din-nou.png");
    expect((await api(root, "/acp/bulk", { kind: "frame", files: [again] }, true)).body).toEqual({ ok: true, added: 0, skipped: 1, rejected: 0 });
  });

  test("ACP: arme în bloc — iconițele late (110×30) acceptate, numele din fișier", async () => {
    const line = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 0.9 } } }).png().toBuffer();
    const ak = await services.plugins.uploadMedia(KEY, { bytes: await line(110, 30), name: "ak47.png" }, root, { acp: true });
    const knife = await services.plugins.uploadMedia(KEY, { bytes: await line(54, 54), name: "knife.png" }, root, { acp: true });
    const r = await api(root, "/acp/bulk", { kind: "weapon", files: [ak, knife] }, true);
    expect(r.body).toEqual({ ok: true, added: 2, skipped: 0, rejected: 0 });
    const list = html(await acpPage("/weapons"));
    expect(list).toContain("<strong>AK47</strong>");
    expect(list).toContain("<strong>Knife</strong>");
  });

  test("ACP: un stil de nume scris în CSS — erori pe linii, previzualizare, salvare, aplicat membrului", async () => {
    const bad = await api(root, "/acp/css", { kind: "name_style", op: "preview", name: "Foc", css: "color: red;\n}body{display:none}" }, true);
    expect(bad.redirect).toBe("/admin/plugins/gcs.vip_studio/css/name_style?draft=1&error=css_invalid");
    const form = html(await acpPage("/css/name_style", { draft: "1", error: "css_invalid" }));
    expect(form).toContain("Linia 2");
    expect(form).toContain("selectorii nu sunt permiși");
    const css = "position: relative;\ncolor: #ffd166;\nanimation: palpaie 1.6s infinite alternate;\n@keyframes palpaie { to { opacity: .7; } }";
    const preview = await api(root, "/acp/css", { kind: "name_style", op: "preview", name: "Foc viu", css }, true);
    expect(preview.redirect).toBe("/admin/plugins/gcs.vip_studio/css/name_style?draft=1");
    expect(html(await acpPage("/css/name_style", { draft: "1" }))).toMatch(/class="gcsp-ns gcs-nfx gcs-nfx--none gcs-nfx--n1 gcs-nameStyle--gcs-vip_studio--pv_[a-z0-9_]+"/);
    const saved = await api(root, "/acp/css", { kind: "name_style", op: "save", name: "Foc viu", css, color: "#ffd166", enabled: "1" }, true);
    expect(saved.redirect).toMatch(/^\/admin\/plugins\/gcs\.vip_studio\/item\/\d+\?saved=1$/);
    const key = /data-gcsp-item="(foc_viu_[a-z0-9]+)"/.exec(html(await acpPage("/name-styles")))?.[1];
    expect(key).toBeDefined();
    expect(await services.db.auditLog.count({ where: { action: "plugin.appearance_style.create", actorId: root.userId } })).toBeGreaterThan(0);
    // Membrul VIP îl alege: GCS pune regulile adminului pe numele lui.
    await api(member, "/save", { nameStyle: key, nameVariant: `${key}:default` });
    expect((await services.appearance.forUser(member.userId!))?.name).toMatchObject({ style: key, styleClass: `gcs-nameStyle--gcs-vip_studio--${key}` });
    const names = await services.appearance.css();
    expect(names).toContain(`:is(.gcs-root,#gcs-names) :is(.gcs-userLink[data-user-id="${member.userId}"]`);
    expect(await services.appearance.css({ previews: true })).toContain(`:is(.gcs-root,#gcs-names) .gcs-nameStyle--gcs-vip_studio--${key}{`);
    expect(names).toContain(`@keyframes gcsu-gcs_vip_studio-name-${key}-palpaie{`);
    // Înapoi la alegerile de dinainte (testele următoare le folosesc).
    await api(member, "/save", { nameStyle: "neon_tub", nameVariant: "neon_tub:cyan", banner: "gold_shine", quote: "Joc pentru echipă" });
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
    expect(html(await page(member))).toContain('value="neon_tub" checked name="nameStyle"');
  });

  test("actualizarea 1.0.0 → versiunea curentă: stilurile vechi fac loc catalogului nou, cele neschimbate primesc variantele noi", async () => {
    const schema = pluginSchema(KEY);
    // Două stiluri din catalogul 1: „Rubin” neschimbat și „Puls”, redenumit de admin.
    const v1 = (effect: string, colors: string[]) => JSON.stringify({ effect, variants: [{ key: "default", colors }], angle: 90, animation: "none", speed: "normal", bold: true, italic: false });
    await services.db.$executeRawUnsafe(
      `INSERT INTO "${schema}".items (kind, key, name, data) VALUES ('name_style', 'ruby', 'Rubin', $1::jsonb), ('name_style', 'pulse', 'Puls schimbat', $2::jsonb)`,
      v1("pulse", ["#FF4D6D", "#C9184A"]),
      v1("pulse", ["#FF0000"]),
    );
    await services.db.$executeRawUnsafe(`INSERT INTO "${schema}".loadouts (user_id, data) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`, root.userId, JSON.stringify({ nameStyle: "ruby" }));
    // Catalogul 2: „Scanare” cu variantele de atunci (neschimbat de admin) și „Glitch RGB” redenumit de admin.
    const v2 = (key: string) => JSON.stringify(nameStyleData(V2_NAME_STYLES.get(key)!));
    await services.db.$executeRawUnsafe(`UPDATE "${schema}".items SET data = $1::jsonb WHERE kind = 'name_style' AND key = 'scanare'`, v2("scanare"));
    await services.db.$executeRawUnsafe(`UPDATE "${schema}".items SET data = $1::jsonb, name = 'Glitch-ul meu' WHERE kind = 'name_style' AND key = 'glitch_rgb'`, v2("glitch_rgb"));
    await services.db.$executeRawUnsafe(`DELETE FROM "${schema}".items WHERE kind = 'name_style' AND key LIKE 'tx\\_%'`);
    await services.db.$executeRawUnsafe(`UPDATE "${schema}".meta SET value = '1'::jsonb WHERE key = 'presets_version'`);
    const zip = await buildVipStudio({ sign: TEST_SIGN });
    const { id } = await services.pluginAdmin.stage(root, { fileName: `gcs.vip_studio-${PLUGIN_MANIFEST.version}.zip`, data: zip });
    expect(await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY })).toEqual({ key: KEY, mode: "update" });
    await services.plugins.reconcile();
    expect((await services.pluginAdmin.get(KEY))?.version).toBe(PLUGIN_MANIFEST.version);
    // Prima pagină după actualizare face trecerea.
    const list = html(await acpPage("/name-styles"));
    expect(list).not.toContain('data-gcsp-item="ruby"');
    // Stilul vechi schimbat de admin („Puls schimbat”) rămâne.
    expect(list).toContain('data-gcsp-item="pulse"');
    const [row] = await services.db.$queryRawUnsafe<{ data: { nameStyle: string; nameVariant: string } }[]>(`SELECT data FROM "${schema}".loadouts WHERE user_id = $1`, root.userId);
    expect(row?.data).toMatchObject({ nameStyle: "stacojiu", nameVariant: "default" });
    // Datele de dinainte (ramele încărcate, echipamentele) rămân.
    expect(list).toContain("Foc viu");
    // Catalogul 3: categoria „Efecte text” e adăugată, „Scanare” are variantele noi, „Glitch RGB” (schimbat) nu.
    const variants = async (key: string) =>
      (await services.db.$queryRawUnsafe<{ data: { variants: { key: string }[] } }[]>(`SELECT data FROM "${schema}".items WHERE kind = 'name_style' AND key = $1`, key))[0]?.data.variants.map((x) => x.key);
    expect(await variants("scanare")).toEqual(expect.arrayContaining(["cyan", "green", "red", "purple", "gold", "white", "rainbow"]));
    expect(await variants("glitch_rgb")).toEqual(["white", "green", "orange"]);
    expect(list).toContain('data-gcsp-item="tx_obsidian"');
    expect(list).toContain("Efecte text");
  });

  test("dezinstalarea completă șterge aspectul și fișierele pluginului", async () => {
    await services.pluginAdmin.uninstall(root, KEY, { keepData: false });
    expect(await services.db.memberAppearance.count()).toBe(0);
    expect(await services.db.pluginMedia.count()).toBe(0);
  });
});
