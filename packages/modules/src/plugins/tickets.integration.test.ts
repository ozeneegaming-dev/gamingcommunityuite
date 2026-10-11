import { normalizeUsername, type GcsActor } from "@gcs/core";
import { buildTickets } from "@gcs/plugin-sdk/tickets";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closePluginServices, createPluginServices, resetPluginWorld } from "../../test/pluginWorld";
import type { GcsServices } from "../services";

const KEY = "gcs.tickets";

let services: GcsServices;
let configDir: string;
let root: GcsActor;
let member: GcsActor;
let other: GcsActor;
let mod: GcsActor;
let guest: GcsActor;

/** Un membru nou într-un grup (ca în `resetPluginWorld`). */
async function actor(name: string, groupKey: string, groups: Record<string, number>): Promise<GcsActor> {
  const user = await services.db.user.create({
    data: { name, nameNormalized: normalizeUsername(name), email: `${name.toLowerCase()}@mail.test`, primaryGroupId: groups[groupKey]! },
  });
  return { userId: user.id, groupIds: [groups[groupKey]!], primaryGroupId: groups[groupKey]!, isBanned: false, ip: "203.0.113.20" };
}

beforeAll(async () => {
  ({ services, configDir } = await createPluginServices());
  const world = await resetPluginWorld(services, [KEY]);
  ({ root, member, guest } = world);
  other = await actor("Altcineva", "member", world.groups);
  mod = await actor("Moderator", "moderator", world.groups);
  // Pachetul livrat e nesemnat: se instalează ca Root Admin, cu 2FA și cheia tastată (ca din ACP).
  const zip = await buildTickets();
  const { id, report } = await services.pluginAdmin.stage(root, { fileName: "gcs.tickets-1.0.0.zip", data: zip });
  expect(report.checks.filter((c) => c.level === "error")).toEqual([]);
  expect(report.signature?.status).toBe("unsigned");
  await services.pluginAdmin.install(root, id, { twoFactorVerified: true, typedKey: KEY });
}, 180_000);

afterAll(async () => {
  await closePluginServices(services, configDir, [KEY]);
});

const page = (a: GcsActor, path = "/", query: Record<string, string> = {}) => services.plugins.renderPage(KEY, path, { actor: a, locale: "ro", query, area: "site" });
const html = async (a: GcsActor, path = "/", query: Record<string, string> = {}) => {
  const r = await page(a, path, query);
  return r.status === 200 ? r.html : `STATUS ${r.status}`;
};
const api = (a: GcsActor, path: string, body: Record<string, unknown>) => services.plugins.handleApi(KEY, { method: "POST", path, query: {}, body, actor: a, locale: "ro", form: true });

describe("Tickete suport: instalat din arhivă (nesemnată)", () => {
  test("se încarcă: pagina, meniul contului, formularul de ticket nou", async () => {
    expect(services.plugins.loadedKeys()).toEqual([KEY]);
    expect(await html(guest)).toContain("Autentifică-te ca să deschizi un ticket");
    expect(await page(guest, "/new")).toEqual({ status: 403 });
    const menus = await services.plugins.menus("user", member, "ro");
    expect(menus.map((m) => m.href)).toContain(`/p/${KEY}`);
    const form = await html(member, "/new");
    expect(form).toContain(`<form class="gcsp-form" method="post" action="/api/plugins/${KEY}/create"`);
    expect(form).toContain('<option value="Cerere unban">Cerere unban</option>');
    // „Urgent” e doar al staff-ului.
    expect(form).not.toContain('value="urgent"');
  });

  test("membrul deschide un ticket; validarea întoarce pe formular cu eroarea", async () => {
    expect(await api(member, "/create", { category: "Inventat", subject: "Am primit ban", body: "Salut" })).toMatchObject({ status: 422, redirect: `/p/${KEY}/new?error=invalid_category` });
    expect(await api(guest, "/create", { category: "Cerere unban", subject: "x", body: "y" })).toMatchObject({ status: 403 });
    const created = await api(member, "/create", { category: "Cerere unban", priority: "urgent", subject: "Am primit ban pe <server>", body: "Salut,\nam primit ban degeaba.\n\nhttps://dovada.ro/poza" });
    expect(created).toEqual({ status: 200, redirect: `/p/${KEY}/t/1?done=created`, body: { ok: true, id: 1 } });
    const ticket = await page(member, "/t/1", { done: "created" });
    // Subiectul e titlul paginii (banda GCS, text simplu); în HTML-ul pluginului nu se repetă.
    expect(ticket).toMatchObject({ status: 200, title: "#1 Am primit ban pe <server>" });
    const view = await html(member, "/t/1", { done: "created" });
    expect(view).toContain("Ticketul a fost trimis");
    expect(view).not.toContain("<server>");
    expect(view).toContain('<a href="https://dovada.ro/poza" rel="noopener noreferrer nofollow ugc">https://dovada.ro/poza</a>');
    expect(view).toContain("gcsp-prio--high");
    expect(view).toContain("gcsp-status--open");
    // Membrul nu vede gestionarea staff-ului.
    expect(view).not.toContain("/t/1/manage");
    expect(await html(member)).toContain(`href="/p/${KEY}/t/1"`);
  });

  test("ticketul e privat: alt membru nu-l vede și nu poate răspunde", async () => {
    expect(await page(other, "/t/1")).toEqual({ status: 404 });
    expect(await api(other, "/t/1/reply", { body: "Hei" })).toMatchObject({ status: 404 });
    expect(await api(other, "/t/1/manage", { status: "closed" })).toMatchObject({ status: 403 });
    expect(await html(other)).not.toContain("/t/1");
  });

  test("staff-ul: coada, preluarea, nota internă (nevăzută de membru), răspunsul și istoricul", async () => {
    expect(await page(mod)).toMatchObject({ status: 200, title: "Coada de tickete" });
    expect(await page(member)).toMatchObject({ status: 200, title: "Ticketele mele" });
    const queue = await html(mod);
    expect(queue).toContain(`href="/p/${KEY}/t/1"`);
    expect(queue).toContain("gcsp-dot");
    expect(await html(mod, "/", { view: "queue", assignee: "none", q: "#1" })).toContain(`/t/1"`);
    expect(await html(mod, "/", { view: "queue", category: "Bug pe site" })).not.toContain(`/t/1"`);

    expect(await api(mod, "/t/1/manage", { status: "in_progress", priority: "urgent", category: "Cerere unban", assignee: "me" })).toMatchObject({ redirect: `/p/${KEY}/t/1?done=updated` });
    expect(await api(mod, "/t/1/reply", { body: "Verific demo-ul.", internal: "1" })).toMatchObject({ redirect: `/p/${KEY}/t/1?done=noted` });
    expect(await api(mod, "/t/1/reply", { body: "Am verificat: banul a fost scos." })).toMatchObject({ body: { ok: true, status: "answered" } });

    const staffView = await html(mod, "/t/1");
    expect(staffView).toContain("Verific demo-ul.");
    expect(staffView).toContain("gcsp-msg--internal");
    expect(staffView).toContain("a schimbat prioritatea în „Urgentă”");
    expect(staffView).toContain(`action="/api/plugins/${KEY}/t/1/manage"`);

    const memberView = await html(member, "/t/1");
    expect(memberView).not.toContain("Verific demo-ul.");
    expect(memberView).toContain("Am verificat: banul a fost scos.");
    expect(memberView).toContain("gcsp-status--answered");
    expect(memberView).toContain("Moderator");
    // Mesaj nou de la staff: marcajul „nou” în lista membrului (până deschide ticketul, ceea ce s-a întâmplat acum).
    expect(await html(member)).not.toContain("gcsp-dot");
  });

  test("membrul răspunde (înapoi „În lucru”), închide și redeschide ticketul", async () => {
    expect(await api(member, "/t/1/reply", { body: "Mulțumesc!" })).toMatchObject({ body: { ok: true, status: "open" } });
    expect(await api(member, "/t/1/status", { status: "closed" })).toMatchObject({ redirect: `/p/${KEY}/t/1?done=closed` });
    expect(await html(member, "/t/1")).toContain("Redeschide ticketul");
    expect(await api(member, "/t/1/status", { status: "open" })).toMatchObject({ redirect: `/p/${KEY}/t/1?done=reopened` });
    expect(await api(member, "/t/1/status", { status: "answered" })).toMatchObject({ status: 422 });
  });

  test("limita de tickete deschise și redeschiderea oprită din setări", async () => {
    await services.pluginAdmin.saveSettings(root, KEY, { maxOpen: 1, allowReopen: false });
    await services.plugins.reconcile();
    expect(await html(member, "/new")).toContain("Ai deja 1 tickete deschise");
    expect(await api(member, "/create", { category: "Suport general", subject: "Altă problemă", body: "Detalii" })).toMatchObject({ redirect: `/p/${KEY}/new?error=limit` });
    await api(member, "/t/1/status", { status: "closed" });
    expect(await api(member, "/t/1/reply", { body: "Încă ceva" })).toMatchObject({ status: 409 });
    expect(await html(member, "/t/1")).toContain("Ticketul e închis");
    await services.pluginAdmin.saveSettings(root, KEY, { maxOpen: 3, allowReopen: true });
    await services.plugins.reconcile();
  });

  test("widget-ul (staff și membru), pagina din ACP și închiderea automată", async () => {
    await api(member, "/create", { category: "Bug pe site", subject: "Butonul nu merge", body: "Nu pot salva profilul." });
    await api(mod, "/t/2/reply", { body: "Ce browser folosești?" });
    const staffWidget = await services.plugins.renderWidget(`plugin.${KEY}.tickets`, { config: { limit: 5 }, actor: mod, locale: "ro", page: "index", zone: "sidebar" });
    expect(staffWidget?.html).toContain("Deschide coada");
    expect(staffWidget?.html).toContain("Butonul nu merge");
    const memberWidget = await services.plugins.renderWidget(`plugin.${KEY}.tickets`, { config: {}, actor: member, locale: "ro", page: "index", zone: "sidebar" });
    expect(memberWidget?.html).toContain("Butonul nu merge");
    expect(memberWidget?.html).toContain("gcsp-dot");

    const acp = await services.plugins.renderPage(KEY, "/", { actor: root, locale: "ro", query: {}, area: "acp" });
    expect(acp.status).toBe(200);
    const acpHtml = acp.status === 200 ? acp.html : "";
    expect(acpHtml).toContain("Tickete în total");
    expect(acpHtml).toContain("Cerere unban");
    expect(acpHtml).toContain("Moderator");

    // Un ticket „Răspuns” vechi se închide automat.
    await services.db.$executeRawUnsafe(`UPDATE "plugin_gcs__tickets".tickets SET last_reply_at = now() - interval '10 days' WHERE id = 2`);
    await services.plugins.runJob({ plugin: KEY, job: "autoclose" });
    const view = await html(member, "/t/2");
    expect(view).toContain("gcsp-status--closed");
    expect(view).toContain("s-a închis automat");
  });
});
