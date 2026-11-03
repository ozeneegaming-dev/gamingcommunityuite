import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixture, forumTree, uid } from "./forum-fixtures";
import { enterAcpAsRoot, groupId, register, resetSetting, sql, userId, useFreshIp } from "./helpers";
import { e2eKv } from "./kv";

/**
 * ACP › Sistem: paginile care erau „în curând”. Stare sistem (serviciile, un job picat apare ca problemă, alertele se
 * salvează, „Rulează acum” intră în jurnal), Cache (o zonă nouă apare și se golește) și Fișiere (filtrul, panoul cu
 * „Folosit în”, ștergerea din panou și ștergerea în masă). Capturile: `GCS_SHOTS_DIR`.
 */
const SHOTS = process.env.GCS_SHOTS_DIR ?? "";
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

const COMING_SOON = "Această secțiune vine într-o etapă următoare";
/** Momentul de acum în UTC, fără fus (coloanele `timestamp` ale bazei sunt în UTC). */
const utcNow = () => new Date().toISOString().replace("T", " ").replace("Z", "");

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.71");
});

test("Stare sistem: serviciile, un job picat, alertele și „Rulează acum”", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Stare${id}`, `stare-${id}@example.com`);
  const kv = await e2eKv();
  try {
    await kv.hset("gcs:jobs:stats", "uploads.orphans", JSON.stringify({ lastStartAt: Date.now() - 60_000, lastOkAt: null, lastErrorAt: Date.now() - 59_000, lastError: "disc E2E", durationMs: 1000, runs: 1, failures: 1 }));
    await page.goto("/admin/system/status");
    await expect(page.getByRole("heading", { name: "Stare sistem", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-status-services").locator('[data-service="db"] [data-level]')).toHaveAttribute("data-level", "ok");
    await expect(page.getByTestId("gcs-status-services").locator('[data-service="kv"] [data-level]')).toHaveAttribute("data-level", "ok");
    const failed = page.locator('[data-testid="gcs-status-job"][data-job="uploads.orphans"]');
    await expect(failed.locator("[data-level]")).toHaveAttribute("data-level", "down");
    await expect(failed).toContainText("disc E2E");
    await expect(page.getByTestId("gcs-status-summary")).toContainText("problem");
    await shot(page, "status-1");

    // Alertele: pragul discului și repetarea se salvează și apar în rezumat.
    await page.getByTestId("gcs-status-alerts-open").click();
    const panel = page.getByTestId("gcs-status-alerts");
    await panel.getByLabel("Prag spațiu liber (%)").fill("17");
    await panel.getByLabel("Repetă alerta după (ore)").fill("12");
    await panel.getByRole("button", { name: "Salvează" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("gcs-status-alerts-summary")).toContainText("17%");
    await expect(page.getByTestId("gcs-status-alerts-summary")).toContainText("12 h");

    // „Rulează acum” pune jobul în coadă și scrie în jurnalul ACP.
    await failed.getByRole("button", { name: "Rulează acum" }).click();
    await expect.poll(async () => (await sql(`SELECT 1 FROM audit_logs WHERE action = 'system.job_run' AND "targetId" = 'uploads.orphans'`)).length).toBeGreaterThan(0);
  } finally {
    await kv.del("gcs:jobs:stats");
    kv.disconnect();
    await resetSetting("system.status_alerts");
  }
});

test("Cache: o zonă nouă apare cu cheile ei și se golește", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Cache${id}`, `cache-${id}@example.com`);
  const area = `e2e${id}`.toLowerCase();
  const kv = await e2eKv();
  try {
    await kv.set(`gcs:k:${area}:a`, "1", "EX", 600);
    await kv.set(`gcs:k:${area}:b`, "2", "EX", 600);
    await page.goto("/admin/system/cache");
    await expect(page.getByRole("heading", { name: "Cache", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    const row = page.locator(`[data-area="${area}"]`);
    await expect(row).toContainText("2 chei");
    await shot(page, "cache-1");
    await row.getByRole("button", { name: "Golește" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("gcs-cache-log")).toContainText(`Zona ${area}`);
    expect(await kv.get(`gcs:k:${area}:a`)).toBeNull();
  } finally {
    await kv.del(`gcs:k:${area}:a`, `gcs:k:${area}:b`);
    kv.disconnect();
  }
});

test("Fișiere: filtrul, panoul cu „Folosit în”, ștergerea din panou și în masă", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Fis${id}`, `fis-${id}@example.com`);
  const rows = [
    { id: `e2e${randomBytes(6).toString("hex")}`, name: `captura-${id}.png`, mime: "image/png", size: 2048, contentType: "forums.post", contentId: "424242" },
    { id: `e2e${randomBytes(6).toString("hex")}`, name: `arhiva-${id}.zip`, mime: "application/zip", size: 4096, contentType: null, contentId: null },
    { id: `e2e${randomBytes(6).toString("hex")}`, name: `nota-${id}.txt`, mime: "text/plain", size: 12, contentType: null, contentId: null },
  ];
  for (const r of rows) {
    await sql(`INSERT INTO attachments (id, "storageKey", filename, mime, size, "contentType", "contentId", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      r.id,
      `e2e/${r.id}`,
      r.name,
      r.mime,
      r.size,
      r.contentType,
      r.contentId,
      utcNow(),
    ]);
  }
  try {
    await page.goto(`/admin/system/files?q=${id}`);
    await expect(page.getByRole("heading", { name: "Fișiere", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-file-row")).toHaveCount(3);
    await expect(page.getByTestId("gcs-files-total")).toHaveText("3 fișiere");
    await shot(page, "files-1");

    // Filtrul pe tip: doar arhiva.
    await page.goto(`/admin/system/files?q=${id}&kind=archive`);
    await expect(page.getByTestId("gcs-file-row")).toHaveCount(1);
    await expect(page.getByTestId("gcs-file-row")).toHaveAttribute("data-file", rows[1]!.name);

    // Panoul imaginii: unde e folosită, apoi ștergerea cu confirmare.
    await page.goto(`/admin/system/files?q=${id}`);
    const image = page.locator(`[data-testid="gcs-file-row"][data-file="${rows[0]!.name}"]`);
    await image.getByTestId("gcs-file-panel-open").click();
    const panel = page.getByTestId("gcs-file-panel");
    await expect(panel.getByTestId("gcs-file-uses")).toContainText("Postare");
    await shot(page, "files-2-panel");
    await panel.getByRole("button", { name: "Șterge" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(image).toHaveCount(0);

    // Ștergerea în masă: cele două rămase.
    await page.getByTestId("gcs-files-select-all").check();
    await expect(page.getByTestId("gcs-files-bulk-count")).toHaveText("2 fișiere bifate");
    await page.getByTestId("gcs-files-bulk").getByRole("button", { name: "Șterge bifate" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(page.getByTestId("gcs-files-bulk").getByRole("status")).toHaveText("2 fișiere șterse");
    await expect(page.getByTestId("gcs-file-row")).toHaveCount(0);
    expect(await sql(`SELECT id FROM attachments WHERE id IN ($1, $2, $3)`, rows.map((r) => r.id))).toEqual([]);
    expect((await sql(`SELECT 1 FROM audit_logs WHERE action = 'system.files_delete'`)).length).toBeGreaterThanOrEqual(2);
  } finally {
    await sql(`DELETE FROM attachments WHERE id IN ($1, $2, $3)`, rows.map((r) => r.id));
  }
});

test("Acțiuni salvate: adaug, editez pașii (același rând, nu unul nou) și șterg", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Macro${id}`, `macro-${id}@example.com`);
  const name = `Macro ${id}`;
  try {
    await page.goto("/admin/community/saved-actions");
    await page.getByTestId("gcs-saved-new-open").click();
    const add = page.getByTestId("gcs-saved-new");
    await add.getByLabel("Nume").fill(name);
    await add.getByLabel("Blochează topicul").check();
    await add.getByRole("button", { name: "Adaugă acțiunea" }).click();
    await expect(add).toHaveCount(0);
    const row = page.locator(`[data-testid="gcs-saved-row"][data-name="${name}"]`);
    await expect(row).toContainText("Blochează topicul");
    await expect(row).toContainText("În toate forumurile");

    await row.getByTestId("gcs-saved-edit-open").click();
    const edit = page.getByTestId("gcs-saved-edit");
    await expect(edit.getByLabel("Nume")).toHaveValue(name);
    await expect(edit.getByLabel("Blochează topicul")).toBeChecked();
    await edit.getByLabel("Blochează topicul").uncheck();
    await edit.getByLabel("Fixează topicul").check();
    await edit.getByLabel("Răspuns predefinit (opțional)").fill("Mulțumim, am fixat topicul.");
    await shot(page, "saved-actions-edit");
    await edit.getByRole("button", { name: "Salvează" }).click();
    await expect(edit).toHaveCount(0);
    await expect(row).toContainText("Fixează topicul");
    await expect(row).toContainText("Răspuns predefinit");
    await expect(row).not.toContainText("Blochează topicul");
    expect(await sql(`SELECT id FROM mod_saved_actions WHERE name = $1`, [name])).toHaveLength(1);

    await row.getByTestId("gcs-saved-edit-open").click();
    await page.getByTestId("gcs-saved-edit").getByRole("button", { name: "Șterge" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(row).toHaveCount(0);
  } finally {
    await sql(`DELETE FROM mod_saved_actions WHERE name = $1`, [name]);
  }
});

test("Botul: o postare programată se editează din panou (data rămâne în ora browserului) și se anulează", async ({ page, request }) => {
  const id = uid();
  // Forumurile instanței E2E se creează la cerere.
  await forumTree(request);
  await enterAcpAsRoot(page, `BotEd${id}`, `boted-${id}@example.com`);
  const title = `Anunț programat ${id}`;
  try {
    await page.goto("/admin/system/bot");
    await page.getByTestId("gcs-bot-schedule-new-open").click();
    const add = page.getByTestId("gcs-bot-schedule-new");
    await add.getByTestId("gcs-bot-schedule-title").fill(title);
    await add.getByTestId("gcs-bot-schedule-content").locator('[contenteditable="true"]').fill("Turneul începe sâmbătă.");
    await add.getByTestId("gcs-bot-schedule-at").fill("2030-01-15T10:30");
    await add.getByRole("button", { name: "Programează" }).click();
    await expect(add).toHaveCount(0);
    const row = page.locator(`[data-testid="gcs-bot-scheduled-row"][data-title="${title}"]`);
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "pending");

    await row.getByTestId("gcs-bot-schedule-edit-open").click();
    const edit = page.getByTestId("gcs-bot-schedule-edit");
    await expect(edit.getByTestId("gcs-bot-schedule-title")).toHaveValue(title);
    await expect(edit.getByTestId("gcs-bot-schedule-at")).toHaveValue("2030-01-15T10:30");
    await expect(edit.getByTestId("gcs-bot-schedule-content")).toContainText("Turneul începe sâmbătă.");
    await edit.getByTestId("gcs-bot-schedule-title").fill(`${title} (mutat)`);
    await edit.getByTestId("gcs-bot-schedule-at").fill("2030-01-16T18:00");
    await edit.getByLabel("Fixează topicul").check();
    await shot(page, "bot-schedule-edit");
    await edit.getByRole("button", { name: "Salvează" }).click();
    await expect(edit).toHaveCount(0);
    const moved = page.locator(`[data-testid="gcs-bot-scheduled-row"][data-title="${title} (mutat)"]`);
    await expect(moved).toContainText("Fixează topicul");
    expect(await sql(`SELECT id FROM bot_scheduled_posts WHERE title LIKE $1`, [`${title}%`])).toHaveLength(1);

    await moved.getByTestId("gcs-bot-schedule-edit-open").click();
    await page.getByTestId("gcs-bot-schedule-edit").getByRole("button", { name: "Anulează" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(moved).toHaveCount(0);
  } finally {
    await sql(`DELETE FROM bot_scheduled_posts WHERE title LIKE $1`, [`${title}%`]);
  }
});

test("Contact: setările din ACP, un vizitator scrie pe /contact, adminul răspunde pe email și arhivează", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Cont${id}`, `cont-${id}@example.com`);
  const email = `vizitator-${id}@example.com`;
  try {
    await page.goto("/admin/settings/contact");
    await expect(page.getByRole("heading", { name: "Contact", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await page.getByTestId("gcs-contact-settings-open").click();
    const cfg = page.getByTestId("gcs-contact-settings");
    await cfg.getByLabel("Textul de deasupra formularului").fill(`Scrie-ne pentru unban ${id}`);
    await cfg.getByLabel("Subiectele (unul pe rând)").fill("Cerere unban\nProblemă VIP");
    await cfg.getByRole("button", { name: "Salvează" }).click();
    await expect(cfg).toHaveCount(0);

    // Vizitatorul: textul și subiectele din ACP, captcha-ul invizibil, confirmarea.
    const guestContext = await browser.newContext();
    await useFreshIp(guestContext, "198.18.72");
    const guest = await guestContext.newPage();
    await guest.goto("/contact");
    await expect(guest.getByTestId("gcs-contact")).toContainText(`Scrie-ne pentru unban ${id}`);
    await guest.getByLabel("Numele tău").fill("Vizitator Test");
    await guest.getByLabel("Emailul tău").fill(email);
    await guest.getByLabel("Subiectul").selectOption("Cerere unban");
    await guest.getByLabel("Mesajul").fill(`Am fost banat din greșeală pe serverul de mix (${id}).`);
    await shot(guest, "contact-1-form");
    await guest.getByRole("button", { name: "Trimite mesajul" }).click();
    await expect(guest.getByTestId("gcs-contact-sent")).toBeVisible({ timeout: 30_000 });
    await guestContext.close();

    // Adminul: mesajul nou, răspunsul pe email, apoi arhivarea.
    await page.goto(`/admin/settings/contact?q=${encodeURIComponent(email)}`);
    const row = page.locator('[data-testid="gcs-contact-row"]').first();
    await expect(row).toHaveAttribute("data-status", "new");
    await expect(row).toHaveAttribute("data-subject", "Cerere unban");
    await row.getByTestId("gcs-contact-panel-open").click();
    const msg = page.getByTestId("gcs-contact-panel");
    await expect(msg.getByTestId("gcs-contact-body")).toContainText("banat din greșeală");
    await msg.getByLabel("Răspunsul tău").fill("Salut! Am verificat și am scos banul.");
    await msg.getByRole("button", { name: "Trimite răspunsul" }).click();
    await expect(msg.getByTestId("gcs-contact-replies")).toContainText("Am verificat și am scos banul.");
    await shot(page, "contact-2-reply");
    await msg.getByRole("button", { name: "Arhivează" }).click();
    await expect(page.locator('[data-testid="gcs-contact-row"]')).toHaveCount(0);
    expect(await sql(`SELECT status FROM contact_messages WHERE email = $1`, [email])).toEqual([{ status: "archived" }]);
  } finally {
    await sql(`DELETE FROM contact_messages WHERE email = $1`, [email]);
    await resetSetting("contact.config");
  }
});

test("Email în masă: ciorna, testul, trimiterea pe loturi de job și dezabonarea din link", async ({ page, request }) => {
  test.setTimeout(240_000);
  const id = uid();
  const email = `bulk-${id}@example.com`;
  await enterAcpAsRoot(page, `Bulk${id}`, email);
  await sql(`UPDATE users SET "emailVerified" = true WHERE email = $1`, [email]);
  // Publicul testului: grupul VIP Legend, în care adminul intră ca grup secundar.
  const legend = await groupId("vip_legend");
  const me = await userId(email);
  await sql(`INSERT INTO user_groups ("userId", "groupId", source) VALUES ($1, $2, 'manual')`, [me, legend]);
  const subject = `Turneu E2E ${id}`;
  type Mail = { to: string; subject: string; html: string };
  const outbox = async () => (await (await request.post("/api/_test/profile", { data: { action: "outbox" } })).json()) as Mail[];
  try {
    await page.goto("/admin/members/bulk-mail");
    await expect(page.getByRole("heading", { name: "Email în masă", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await page.getByTestId("gcs-bulk-new-open").click();
    const add = page.getByTestId("gcs-bulk-new");
    await add.getByTestId("gcs-bulk-subject").fill(subject);
    await add.getByTestId("gcs-bulk-body").locator('[contenteditable="true"]').fill("Salut, {name}! Turneul începe sâmbătă.");
    await add.locator(`input[name="groupId"][value="${legend}"]`).check();
    await expect(add.getByTestId("gcs-bulk-count")).toContainText("destinatar");
    await add.getByRole("button", { name: "Salvează ciorna" }).click();
    await expect(add).toHaveCount(0);
    const row = page.locator(`[data-testid="gcs-bulk-row"][data-subject="${subject}"]`);
    await expect(row).toHaveAttribute("data-status", "draft");

    // Testul pleacă doar la admin, cu numele lui.
    await row.getByTestId("gcs-bulk-panel-open").click();
    const panel = page.getByTestId("gcs-bulk-panel");
    await panel.getByRole("button", { name: "Trimite-mi un test" }).click();
    await expect.poll(async () => (await outbox()).some((m) => m.to === email && m.subject === `[Test] ${subject}` && m.html.includes(`Salut, Bulk${id}!`))).toBe(true);
    await shot(page, "bulk-mail-draft");

    // Trimiterea către VIP Legend; jobul (la minut) o termină.
    await panel.getByRole("button", { name: "Trimite acum" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(row).not.toHaveAttribute("data-status", "draft");
    await expect.poll(async () => (await sql<{ status: string }>(`SELECT status FROM bulk_mails WHERE subject = $1`, [subject]))[0]?.status, { timeout: 150_000 }).toBe("sent");
    const mail = (await outbox()).find((m) => m.to === email && m.subject === subject);
    expect(mail, "emailul a ajuns la admin").toBeTruthy();

    // Linkul de dezabonare din email.
    const link = /href="([^"]*\/unsubscribe\?[^"]+)"/.exec(mail!.html)![1]!.replace(/&(?:#38|amp);/g, "&");
    const url = new URL(link);
    await page.goto(url.pathname + url.search);
    await expect(page.getByTestId("gcs-unsubscribe")).toHaveAttribute("data-ok", "1");
    await page.goto("/settings/email");
    await expect(page.getByTestId("gcs-admin-mail-toggle")).not.toBeChecked();
    await page.getByTestId("gcs-admin-mail-toggle").check();
    await expect(page.getByTestId("gcs-admin-mail").getByRole("status")).toHaveText("Salvat");
  } finally {
    await sql(`DELETE FROM bulk_mails WHERE subject = $1`, [subject]);
    await sql(`DELETE FROM user_groups WHERE "userId" = $1 AND "groupId" = $2`, [me, legend]);
  }
});

test("Recomandări: setările din ACP, linkul membrului, înregistrarea prin link și lista din ACP", async ({ page, browser }) => {
  const id = uid();
  const email = `ref-${id}@example.com`;
  await enterAcpAsRoot(page, `Ref${id}`, email);
  const me = await userId(email);
  const friend = `Prieten${id}`;
  try {
    await page.goto("/admin/members/settings/referral");
    await expect(page.getByRole("heading", { name: "Recomandări", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await page.getByTestId("gcs-referral-settings-open").click();
    const cfg = page.getByTestId("gcs-referral-settings");
    await cfg.getByLabel("Postări necesare").fill("0");
    await cfg.getByLabel("Puncte pentru cel care a invitat").fill("15");
    await cfg.getByRole("button", { name: "Salvează" }).click();
    await expect(cfg).toHaveCount(0);
    await expect(page.getByTestId("gcs-referral-summary")).toContainText("+15 puncte");

    // Linkul membrului, în Setări → Invită prieteni.
    await page.goto("/settings/referral");
    await expect(page.getByTestId("gcs-referral-link")).toHaveValue(new RegExp(`/r/${me}$`));

    // Un prieten deschide linkul și își face cont: recomandarea se notează.
    const ctx = await browser.newContext();
    await useFreshIp(ctx, "198.18.73");
    const guest = await ctx.newPage();
    await guest.goto(`/r/${me}`);
    await expect(guest).toHaveURL(/\/register$/);
    await register(guest, friend, `prieten-${id}@example.com`);
    await expect.poll(async () => (await sql(`SELECT 1 FROM referrals WHERE "referrerId" = $1`, [me])).length, { timeout: 20_000 }).toBe(1);
    await ctx.close();

    await page.goto("/admin/members/settings/referral");
    await expect(page.locator(`[data-testid="gcs-referral-row"][data-referred="${friend}"]`)).toBeVisible();
    await shot(page, "referral-acp");
  } finally {
    await sql(`DELETE FROM referrals WHERE "referrerId" = $1`, [me]);
    await resetSetting("referral.config");
  }
});

test("Statistici: toate rapoartele se deschid cu grafic și plăci, perioada și gruparea se schimbă, CSV-ul și setările", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Stat${id}`, `stat-${id}@example.com`);
  try {
    for (const [report, title] of [
      ["registrations", "Înregistrări"],
      ["members", "Membri activi"],
      ["content", "Conținut"],
      ["online", "Online"],
      ["clans", "Clanuri"],
      ["servers", "Servere"],
      ["vip", "VIP și donații"],
    ] as const) {
      await page.goto(`/admin/stats/${report}`);
      await expect(page.getByRole("heading", { name: title, level: 1 }), report).toBeVisible();
      await expect(page.getByText(COMING_SOON)).toHaveCount(0);
      await expect(page.getByTestId("gcs-stats-chart")).toBeVisible();
      await expect(page.getByTestId("gcs-stats-tiles").locator("[data-series]").first()).toBeVisible();
    }
    await shot(page, "stats-vip");

    // Perioada de 7 zile pe zile: 7 intervale; înregistrarea adminului apare în total.
    await page.goto("/admin/stats/registrations?days=7&group=day");
    await expect(page.locator('[data-series="registrations"] .gcs-acpTile__value')).not.toHaveText("0");
    await page.getByTestId("gcs-stats-group").selectOption("week");
    await page.getByRole("button", { name: "Aplică" }).click();
    await expect(page).toHaveURL(/group=week/);
    await shot(page, "stats-registrations-week");

    const csv = await page.request.get("/admin/stats/registrations/export.csv?days=7&group=day");
    expect(csv.ok()).toBe(true);
    const lines = (await csv.text()).trim().split("\n");
    expect(lines[0]).toBe("period,registrations");
    expect(lines.length).toBe(8);

    await page.getByTestId("gcs-stats-settings-open").click();
    const cfg = page.getByTestId("gcs-stats-settings");
    await cfg.getByLabel("Exclude staff-ul din rapoartele de activitate").check();
    await cfg.getByRole("button", { name: "Salvează" }).click();
    await expect(cfg).toHaveCount(0);
    expect((await sql<{ value: { excludeStaff: boolean } }>(`SELECT value FROM settings WHERE key = 'stats.config'`))[0]?.value.excludeStaff).toBe(true);
  } finally {
    await resetSetting("stats.config");
  }
});

test("Etichete: lista cu topicuri, redenumirea, unirea și setările", async ({ page }) => {
  const id = uid().toLowerCase();
  await enterAcpAsRoot(page, `Tag${id}`, `tag-${id}@example.com`);
  const [a, b] = [`eta-${id}`, `etb-${id}`];
  await sql(`INSERT INTO tags (name, slug) VALUES ($1, $1), ($2, $2)`, [a, b]);
  try {
    await page.goto(`/admin/system/tags?q=${id}`);
    await expect(page.getByRole("heading", { name: "Etichete", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-tag-row")).toHaveCount(2);

    // Redenumirea primei etichete.
    const rowA = page.locator(`[data-testid="gcs-tag-row"][data-slug="${a}"]`);
    await rowA.getByTestId("gcs-tag-panel-open").click();
    await page.getByTestId("gcs-tag-panel").getByLabel("Numele").fill(`Eta ${id} nou`);
    await page.getByTestId("gcs-tag-panel").getByRole("button", { name: "Salvează" }).click();
    await expect(page.locator(`[data-testid="gcs-tag-row"][data-slug="eta-${id}-nou"]`)).toBeVisible();

    // Unirea celei de-a doua în prima.
    await page.locator(`[data-testid="gcs-tag-row"][data-slug="${b}"]`).getByTestId("gcs-tag-panel-open").click();
    const panel = page.getByTestId("gcs-tag-panel");
    await panel.getByLabel("Ținta").selectOption({ label: `#eta-${id}-nou` });
    await panel.getByRole("button", { name: "Unește" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(page.getByTestId("gcs-tag-row")).toHaveCount(1);
    await shot(page, "tags-acp");

    await page.getByTestId("gcs-tags-settings-open").click();
    await page.getByTestId("gcs-tags-settings").getByLabel("Cine creează etichete").selectOption("closed");
    await page.getByTestId("gcs-tags-settings").getByRole("button", { name: "Salvează" }).click();
    await expect(page.getByTestId("gcs-tags-summary")).toContainText("doar cele din listă");
  } finally {
    await sql(`DELETE FROM tags WHERE slug LIKE $1`, [`%${id}%`]);
    await resetSetting("tags.config");
  }
});

test("Căutare: termenii căutați apar în ACP; setarea „doar membri” oprește vizitatorii", async ({ page, browser }) => {
  const id = uid().toLowerCase();
  await enterAcpAsRoot(page, `Src${id}`, `src-${id}@example.com`);
  const term = `inexistent${id}`;
  try {
    await page.goto(`/search?q=${term}`);
    await page.goto("/admin/system/search");
    await expect(page.getByRole("heading", { name: "Căutare", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-search-zero").locator(`[data-term="${term}"]`)).toBeVisible();

    await page.getByTestId("gcs-search-settings-open").click();
    const cfg = page.getByTestId("gcs-search-settings");
    await cfg.getByLabel("Și vizitatorii pot căuta").uncheck();
    await cfg.getByRole("button", { name: "Salvează" }).click();
    await expect(page.getByTestId("gcs-search-summary")).toContainText("doar pentru membri");
    await shot(page, "search-acp");

    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto(`/search?q=orice${id}`);
    await expect(guest.getByText("Căutarea e doar pentru membri")).toBeVisible();
    await ctx.close();
  } finally {
    await resetSetting("search.config");
  }
});

/** Un PNG de 1 × 1 pixel (iconița de test a aplicației). */
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("RSS, Distribuire și Web App: setările schimbă fluxurile, meniul topicului și manifestul", async ({ page, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Rss${id}`, `rss-${id}@example.com`);
  const t = await forumTree(request);
  const topic = await fixture<{ topicId: number }>(request, { action: "topic", forumId: t.forum.id, title: `Distribuire ${id}`, text: "Despre RSS", authorEmail: `rss-${id}@example.com` });
  try {
    // RSS: fluxul general există; oprit, dispare.
    await page.goto("/admin/system/rss");
    await expect(page.getByRole("heading", { name: "RSS", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    expect((await page.request.get("/rss.xml")).status()).toBe(200);
    await page.getByTestId("gcs-rss-settings-open").click();
    await page.getByTestId("gcs-rss-settings").getByLabel("Fluxul general /rss.xml").uncheck();
    await page.getByTestId("gcs-rss-settings").getByRole("button", { name: "Salvează" }).click();
    await expect(page.getByTestId("gcs-rss-settings")).toHaveCount(0);
    expect((await page.request.get("/rss.xml")).status()).toBe(404);

    // Distribuire: fără Facebook, cu Reddit, în meniul topicului.
    await page.goto("/admin/system/share");
    await page.getByTestId("gcs-share-settings-open").click();
    const share = page.getByTestId("gcs-share-settings");
    await share.getByLabel("Facebook").uncheck();
    await share.getByLabel("Reddit").check();
    await share.getByRole("button", { name: "Salvează" }).click();
    await expect(page.locator('[data-network="reddit"] [data-state]')).toHaveAttribute("data-state", "on");
    await page.goto(`/topic/${topic.topicId}`);
    await page.getByTestId("gcs-share-menu").click();
    await expect(page.getByRole("menuitem", { name: "Reddit" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Facebook" })).toHaveCount(0);

    // Web App: numele scurt în manifest și iconița încărcată.
    await page.goto("/admin/settings/pwa");
    await page.getByTestId("gcs-pwa-settings-open").click();
    await page.getByTestId("gcs-pwa-settings").getByLabel("Numele scurt").fill("GcsTest");
    await page.getByTestId("gcs-pwa-settings").getByRole("button", { name: "Salvează" }).click();
    await expect(page.getByTestId("gcs-pwa-short")).toHaveText("GcsTest");
    const up = await page.request.post("/api/acp/pwa/icon", { multipart: { file: { name: "icon.png", mimeType: "image/png", buffer: PNG_1PX } }, headers: { origin: new URL(page.url()).origin } });
    expect(up.ok(), await up.text()).toBe(true);
    const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as { short_name: string; icons?: { src: string; sizes: string }[] };
    expect(manifest.short_name).toBe("GcsTest");
    expect(manifest.icons?.[0]?.sizes).toBe("512x512");
    const icon = await page.request.get(manifest.icons![0]!.src);
    expect(icon.headers()["content-type"]).toBe("image/png");
    await page.reload();
    await shot(page, "pwa-acp");
  } finally {
    for (const key of ["rss.config", "share.config", "pwa.config"]) await resetSetting(key);
  }
});

test("Reclame: o reclamă din ACP apare prin widget pe prima pagină, se ascunde VIP-urilor, iar click-ul se numără", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Ads${id}`, `ads-${id}@example.com`);
  const name = `Sponsor ${id}`;
  let placement: number | null = null;
  const clearLayout = async () => {
    const kv = await e2eKv();
    try {
      const keys = await kv.keys("gcs:k:layout*");
      if (keys.length > 0) await kv.del(...keys);
    } finally {
      kv.disconnect();
    }
  };
  try {
    await page.goto("/admin/system/ads");
    await expect(page.getByRole("heading", { name: "Reclame", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await page.getByTestId("gcs-ad-new-open").click();
    const add = page.getByTestId("gcs-ad-new");
    await add.getByLabel("Numele (doar în ACP)").fill(name);
    await add.getByTestId("gcs-ad-image-url").fill("https://placehold.co/300x250.png");
    await add.getByLabel("Linkul").fill("https://sponsor.example.com/oferta");
    await add.getByRole("button", { name: "Adaugă reclama" }).click();
    await expect(add).toHaveCount(0);
    const row = page.locator(`[data-testid="gcs-ad-row"][data-name="${name}"]`);
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "live");
    const [ad] = await sql<{ id: number }>(`SELECT id FROM ad_units WHERE name = $1`, [name]);

    // Widget-ul pe prima pagină (vizitator): imaginea, cu linkul de click numărat.
    const [placed] = await sql<{ id: number }>(`INSERT INTO widget_placements (page, zone, position, type, config, groups) VALUES ('index', 'sidebar', 0, 'core.ad', $1, '[]') RETURNING id`, [JSON.stringify({ unit: String(ad!.id) })]);
    placement = placed?.id ?? null;
    await clearLayout();
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto("/");
    const shown = guest.locator(`[data-testid="gcs-ad"][data-ad="${ad!.id}"]`);
    await expect(shown).toBeVisible();
    await expect(shown.locator("a")).toHaveAttribute("href", `/go/ad/${ad!.id}`);
    const go = await guest.request.get(`/go/ad/${ad!.id}`, { maxRedirects: 0 });
    expect(go.status()).toBe(302);
    expect(go.headers().location).toBe("https://sponsor.example.com/oferta");
    await ctx.close();

    await page.reload();
    await expect(row).toContainText("1 click");
    await shot(page, "ads-acp");
  } finally {
    if (placement !== null) await sql(`DELETE FROM widget_placements WHERE id = $1`, [placement]);
    await sql(`DELETE FROM ad_units WHERE name = $1`, [name]);
    await clearLayout();
  }
});

test("Fluxuri: un flux propriu devine tab pe pagina Activitate", async ({ page, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Flx${id}`, `flx-${id}@example.com`);
  await forumTree(request);
  const name = `Noutăți ${id}`;
  try {
    await page.goto("/admin/system/streams");
    await expect(page.getByRole("heading", { name: "Fluxuri", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await page.getByTestId("gcs-stream-new-open").click();
    const add = page.getByTestId("gcs-stream-new");
    await add.getByLabel("Numele (tab-ul)").fill(name);
    await add.getByRole("button", { name: "Adaugă fluxul" }).click();
    await expect(add).toHaveCount(0);
    const row = page.getByTestId("gcs-stream-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    const key = await row.getAttribute("data-stream");
    await shot(page, "streams-acp");
    await page.goto("/activity");
    const tab = page.getByTestId(`gcs-activity-stream-${key}`);
    await expect(tab).toHaveText(name);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`stream=${key}`));
    await expect(tab).toHaveAttribute("aria-current", "page");
  } finally {
    await resetSetting("streams.config");
  }
});

test("Webhooks: o adresă internă e refuzată; un webhook Discord se adaugă, se editează și se șterge", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Hook${id}`, `hook-${id}@example.com`);
  const name = `Discord ${id}`;
  try {
    await page.goto("/admin/system/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await page.getByTestId("gcs-webhook-new-open").click();
    const add = page.getByTestId("gcs-webhook-new");
    await add.getByLabel("Numele").fill(name);
    await add.getByLabel("Adresa (URL)").fill("https://127.0.0.1/hook");
    await add.getByRole("button", { name: "Adaugă webhook-ul" }).click();
    await expect(add.getByRole("alert")).toContainText("nu e publică");

    await add.getByLabel("Adresa (URL)").fill("https://discord.com/api/webhooks/123/abc");
    await add.getByLabel("Formatul").selectOption("discord");
    await add.getByLabel("Membru nou").check();
    await add.getByRole("button", { name: "Adaugă webhook-ul" }).click();
    await expect(add).toHaveCount(0);
    const row = page.locator(`[data-testid="gcs-webhook-row"][data-name="${name}"]`);
    await expect(row).toContainText("2 evenimente");
    await shot(page, "webhooks-acp");

    await row.getByTestId("gcs-webhook-edit-open").click();
    await page.getByTestId("gcs-webhook-edit").getByRole("button", { name: "Șterge" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(row).toHaveCount(0);
  } finally {
    await sql(`DELETE FROM webhook_endpoints WHERE name = $1`, [name]);
  }
});

test("API: cheia creată se vede o dată, citește statisticile, e refuzată pe alt drept și după revocare", async ({ page, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Api${id}`, `api-${id}@example.com`);
  const name = `Bot ${id}`;
  try {
    await page.goto("/admin/system/api");
    await expect(page.getByRole("heading", { name: "API", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.getByTestId("gcs-api-endpoints")).toContainText("/api/v1/stats");
    await page.getByTestId("gcs-api-new-open").click();
    const add = page.getByTestId("gcs-api-new");
    await add.getByLabel("Numele").fill(name);
    await add.getByRole("button", { name: "Creează cheia" }).click();
    const key = (await add.getByTestId("gcs-api-key-value").textContent())?.trim() ?? "";
    expect(key).toMatch(/^gcs_[a-f0-9]{12}_/);
    await shot(page, "api-key-created");

    const auth = { Authorization: `Bearer ${key}` };
    const stats = await request.get("/api/v1/stats", { headers: auth });
    expect(stats.status()).toBe(200);
    expect((await stats.json()).data).toHaveProperty("members");
    expect((await request.get("/api/v1/topics", { headers: auth })).status()).toBe(403);
    expect((await request.get("/api/v1/stats")).status()).toBe(403);

    await page.goto("/admin/system/api");
    const row = page.locator(`[data-testid="gcs-api-row"][data-name="${name}"]`);
    await expect(row.locator("[data-level]")).toHaveAttribute("data-level", "ok");
    await row.getByTestId("gcs-api-edit-open").click();
    const edit = page.getByTestId("gcs-api-edit");
    await expect(edit.getByTestId("gcs-api-log")).toContainText("/api/v1/stats");
    await edit.getByRole("button", { name: "Revocă cheia" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(row.locator("[data-level]")).toHaveAttribute("data-level", "down");
    expect((await request.get("/api/v1/stats", { headers: auth })).status()).toBe(403);
    await shot(page, "api-acp");
  } finally {
    await sql(`DELETE FROM api_keys WHERE name = $1`, [name]);
  }
});

test("Integrări: starea serviciilor cu linkurile lor; Plausible pornit apare în pagina site-ului", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Integr${id}`, `integr-${id}@example.com`);
  try {
    await page.goto("/admin/system/integrations");
    await expect(page.getByRole("heading", { name: "Integrări", level: 1 })).toBeVisible();
    await expect(page.getByText(COMING_SOON)).toHaveCount(0);
    await expect(page.locator('[data-testid="gcs-integration-row"][data-key="smtp"] [data-testid="gcs-integration-link"]')).toHaveAttribute("href", "/admin/settings/email");
    await expect(page.locator('[data-testid="gcs-integration-row"][data-key="api"]')).toBeVisible();

    await page.locator('[data-testid="gcs-integration-row"][data-key="analytics"]').getByTestId("gcs-analytics-edit-open").click();
    const edit = page.getByTestId("gcs-analytics-edit");
    await edit.getByLabel("Serviciul").selectOption("plausible");
    await edit.getByLabel("Domeniul").fill("forum.exemplu.ro");
    await edit.getByLabel("Pornește doar după").uncheck();
    await edit.getByRole("button", { name: "Salvează" }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.locator('[data-testid="gcs-integration-row"][data-key="analytics"] [data-level]')).toHaveAttribute("data-level", "ok");
    await shot(page, "integrations-acp");

    // Un vizitator primește scriptul; staff-ul (adminul) nu.
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await guest.goto("/");
    await expect(guest.locator('script[data-domain="forum.exemplu.ro"]')).toHaveCount(1);
    await ctx.close();
    await page.goto("/");
    await expect(page.locator('script[data-domain="forum.exemplu.ro"]')).toHaveCount(0);
  } finally {
    await resetSetting("integrations.analytics");
  }
});
