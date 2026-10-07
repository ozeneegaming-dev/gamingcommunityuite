import { GcsConflict, GcsForbidden, GcsValidationError, readPluginZip, type GcsActor } from "@gcs/core";
import { writeZip } from "@gcs/plugin-sdk/zip";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { closePluginServices, createPluginServices, resetPluginWorld } from "../../test/pluginWorld";
import type { GcsServices } from "../services";
import { PORT_SOURCE_LIMITS } from "./archive";
import { addonJsonFixture, pluginXmlFixture } from "./fixtures";

const KEYS = ["acme.demo"];
let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
});

afterAll(async () => {
  await closePluginServices(services, configDir, KEYS);
});

beforeEach(async () => {
  ({ root, member } = await resetPluginWorld(services, KEYS));
});

const audit = async () =>
  (await services.db.auditLog.findMany({ where: { action: { startsWith: "porting." } }, orderBy: { createdAt: "asc" } })).map((a) => ({ action: a.action, after: a.after, before: a.before }));

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

describe("asistentul de portare (serviciul)", () => {
  test("doar secțiunea ACP `system.porting`; arhivele ostile sau necunoscute sunt refuzate cu codul lor", async () => {
    expect(await rejected(services.porting.analyze(member, { fileName: "demo.zip", data: addonJsonFixture() }))).toBeInstanceOf(GcsForbidden);
    const unsafe = (await rejected(services.porting.analyze(root, { fileName: "x.zip", data: writeZip([{ name: "../evil.php", data: "<?php" }]) }))) as GcsValidationError;
    expect(unsafe).toBeInstanceOf(GcsValidationError);
    expect(unsafe.fields).toEqual({ file: "path_unsafe" });
    expect(unsafe.params).toEqual({ path: "../evil.php" });
    const unknown = (await rejected(services.porting.analyze(root, { fileName: "x.zip", data: writeZip([{ name: "readme.txt", data: "x" }]) }))) as GcsValidationError;
    expect(unknown.fields).toEqual({ file: "unknown_format" });
    expect(((await rejected(services.porting.analyze(root, { fileName: "x.zip", data: Buffer.alloc(0) }))) as GcsValidationError).fields).toEqual({ file: "required" });
    expect(await services.db.pluginPort.count()).toBe(0);
  });

  test("încărcare → confirmarea dreptului (obligatorie) → conversie → descărcare → predare la instalator, fără instalare automată", async () => {
    const analyzed = await services.porting.analyze(root, { fileName: "Demo 1.2.zip", data: addonJsonFixture() });
    expect(analyzed).toMatchObject({ status: "analyzed", fileName: "Demo 1.2.zip", format: "addon-json", sourceName: "Demo Tools", pluginKey: null, report: null, canHandoff: false });
    expect(analyzed.analysis).toMatchObject({ suggestedKey: "acme.demo", license: { gpl: false }, counts: { settings: 5, tables: 1, templates: 3 } });

    // Fără bifă sau cu un temei necunoscut: nimic nu se convertește.
    const noRights = (await rejected(services.porting.convert(root, analyzed.id, { basis: "author", confirmed: false }))) as GcsValidationError;
    expect(noRights.fields).toEqual({ rights: "required" });
    expect(((await rejected(services.porting.convert(root, analyzed.id, { basis: "maybe" as "author", confirmed: true }))) as GcsValidationError).fields).toEqual({ rights: "required" });
    expect(((await rejected(services.porting.convert(root, analyzed.id, { basis: "author", confirmed: true, key: "Bad Key" }))) as GcsValidationError).fields).toEqual({ key: "invalid" });
    expect(await rejected(services.porting.handoff(root, analyzed.id))).toBeInstanceOf(GcsConflict);

    const converted = await services.porting.convert(root, analyzed.id, { basis: "consent", confirmed: true });
    expect(converted).toMatchObject({ status: "converted", pluginKey: "acme.demo", rights: { basis: "consent" }, canHandoff: true });
    expect(converted.report!.validation.ok).toBe(true);
    expect(converted.report!.automatedPercent).toBeGreaterThan(0);
    expect((await services.db.pluginPort.findUnique({ where: { id: analyzed.id } }))!.source).toBeNull();
    expect(await rejected(services.porting.convert(root, analyzed.id, { basis: "consent", confirmed: true }))).toBeInstanceOf(GcsConflict);

    const download = await services.porting.download(root, analyzed.id);
    expect(download.fileName).toBe("acme.demo-port.zip");
    expect(readPluginZip(download.data, PORT_SOURCE_LIMITS).get("PORTING.md")!.toString()).toContain("am acordul scris al autorului");

    const { uploadId } = await services.porting.handoff(root, analyzed.id);
    expect(await services.db.pluginUpload.findUnique({ where: { id: uploadId }, select: { fileName: true } })).toEqual({ fileName: "acme.demo-1.2.0.zip" });
    expect(await services.db.plugin.count()).toBe(0);

    // Jurnalul: încărcarea, confirmarea (cu numele pluginului și temeiul), predarea.
    const log = await audit();
    expect(log).toHaveLength(3);
    expect(log).toEqual(expect.arrayContaining([
      { action: "porting.upload", before: null, after: expect.objectContaining({ plugin: "Demo Tools", format: "addon-json", gpl: false }) },
      { action: "porting.convert", before: null, after: expect.objectContaining({ plugin: "Demo Tools", rights: "consent", confirmed: true, key: "acme.demo", gpl: false, valid: true }) },
      { action: "porting.handoff", before: null, after: { key: "acme.demo", uploadId } },
    ]));

    // Adminul instalează din ecranul instalatorului: pluginul generat rulează, iar paginile randează șabloanele convertite.
    expect(await services.pluginAdmin.install(root, uploadId, { twoFactorVerified: true, typedKey: "acme.demo" })).toEqual({ key: "acme.demo", mode: "install" });
    const page = await services.plugins.renderPage("acme.demo", "/demo/7", { actor: member, locale: "en", query: {}, area: "site" });
    expect(page).toMatchObject({ status: 200, title: "Demo Tools" });
    expect(page.status === 200 && page.html).toContain('<h2 class="gcsp-title">Demo items</h2>');
    expect(page.status === 200 && page.html).toContain("There are no items yet.");
    const acp = await services.plugins.renderPage("acme.demo", "/demo-items", { actor: root, locale: "en", query: {}, area: "acp" });
    expect(acp).toMatchObject({ status: 200, title: "Demo items" });
    expect(await services.plugins.handleApi("acme.demo", { method: "GET", path: "/demo-items", query: {}, body: null, actor: root, locale: "en" })).toEqual({ status: 501, body: { error: "not_ported" } });
  });

  test("lista, avertismentul GPL din analiză, ștergerea (în jurnal)", async () => {
    const xml = await services.porting.analyze(root, { fileName: "shoutbox.xml", data: pluginXmlFixture() });
    expect(xml.analysis.license).toMatchObject({ gpl: true, spdx: "GPL-2.0-or-later" });
    expect(await services.porting.list(root)).toEqual([expect.objectContaining({ id: xml.id, status: "analyzed", format: "plugin-xml", sourceName: "Shoutbox Lite", automatedPercent: null })]);
    expect(await rejected(services.porting.delete(member, xml.id))).toBeInstanceOf(GcsForbidden);
    await services.porting.delete(root, xml.id);
    expect(await services.porting.list(root)).toEqual([]);
    expect((await audit()).map((a) => a.action).sort()).toEqual(["porting.delete", "porting.upload"]);
  });
});
