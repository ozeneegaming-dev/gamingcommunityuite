import { createHmac } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, login, PASSWORD, sql, useFreshIp } from "./helpers";

/**
 * Ștergerea și unirea conturilor (specul 2026-10-09-stergere-unire-membri): staff-ul șterge un membru păstrând conținutul,
 * unește un cont doar-Steam cu contul principal, iar un membru își cere ștergerea și o anulează.
 */

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "192.0.2");
});

/** Login-ul cu Steam, prin verificatorul OpenID fals al E2E (`e2e/run.mts`): același callback ca în producție. */
async function steamLogin(page: Page, steamId: string): Promise<void> {
  const claimed = `https://steamcommunity.com/openid/id/${steamId}`;
  const base = new URL(page.url() === "about:blank" ? (process.env.GCS_E2E_BASE_URL ?? "http://localhost:3100") : page.url()).origin;
  const sig = createHmac("sha256", process.env.GCS_E2E_STEAM_SECRET ?? "").update(claimed).digest("base64url");
  const params = new URLSearchParams({
    callbackURL: "/",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": claimed,
    "openid.identity": claimed,
    "openid.return_to": `${base}/api/auth/steam/callback?callbackURL=%2F`,
    "openid.response_nonce": `${new Date().toISOString().slice(0, 19)}Z${uid()}`,
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": sig,
  });
  await page.goto(`/api/auth/steam/callback?${params}`);
}

async function newPage(browser: Browser, ipPrefix: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ipPrefix);
  return context.newPage();
}

test("staff-ul șterge un membru păstrând conținutul: postarea arată „Membru șters”, membrul nu mai poate intra", async ({ page, browser, request }) => {
  const id = uid();
  const leaving = await newPage(browser, "198.51.100");
  await member(leaving, `Plecat${id}`, `plecat-${id}@example.com`);
  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, `plecat-${id}@example.com`, `Topicul lui Plecat ${id}`, 1);
  const memberId = (await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`plecat-${id}@example.com`]))[0]!.id;

  await enterAcpAsRoot(page, `RootDel${id}`, `root-del-${id}@example.com`);

  await test.step("fișa membrului: zona periculoasă → ecranul de confirmare cu ce are membrul", async () => {
    await page.goto(`/admin/members/${memberId}`);
    const danger = page.getByTestId("gcs-member-danger");
    await expect(danger).toBeVisible();
    await danger.getByTestId("gcs-member-delete").click();
    await expect(page).toHaveURL(new RegExp(`/admin/members/${memberId}/delete$`));
    const has = page.getByTestId("gcs-removal-has");
    await expect(has.locator('[data-key="forums.posts"] .gcs-removalItem__count')).toHaveText("2");
    await expect(has.locator('[data-key="forums.topics"] .gcs-removalItem__count')).toHaveText("1");
    // „Păstrează conținutul” e modul implicit.
    await expect(page.getByRole("radio", { name: /Păstrează conținutul/ })).toBeChecked();
  });

  await test.step("numele greșit e refuzat; cu numele corect ștergerea rulează și se termină", async () => {
    const form = page.getByTestId("gcs-removal-delete-form");
    await form.getByLabel(/Scrie numele membrului/).fill("altcineva");
    await form.getByRole("button", { name: "Șterge definitiv" }).click();
    await expect(form.getByRole("alert")).toHaveText("Numele scris nu se potrivește.");
    await form.getByLabel(/Scrie numele membrului/).fill(`Plecat${id}`);
    await form.getByRole("button", { name: "Șterge definitiv" }).click();
    await expect(page).toHaveURL(/\/admin\/members\/removals\/[a-z0-9]+$/);
    await expect(page.getByTestId("gcs-removal-status")).toHaveAttribute("data-status", "DONE");
    await expect(page.getByTestId("gcs-removal-done")).toHaveText(/Contul a fost șters/);
  });

  await test.step("postările rămân, semnate „Membru șters”, fără link spre profil", async () => {
    await page.goto(topic.url);
    const posts = page.getByTestId("gcs-post");
    await expect(posts).toHaveCount(2);
    await expect(posts.first().getByTestId("gcs-postbit-deleted")).toHaveText(/Membru șters/);
    await expect(page.locator(`a[href^="/members/${memberId}"]`)).toHaveCount(0);
  });

  await test.step("membrul a ieșit din cont și nu mai poate intra cu parola", async () => {
    await leaving.goto("/");
    await expect(leaving.getByTestId("gcs-header-user")).toHaveCount(0);
    await leaving.goto("/login");
    await login(leaving, `plecat-${id}@example.com`, PASSWORD);
    await expect(leaving.locator("form [role=alert]")).toBeVisible();
    await expect(leaving.getByTestId("gcs-header-user")).toHaveCount(0);
    expect(await sql(`SELECT id FROM users WHERE id = $1`, [memberId])).toHaveLength(0);
  });
});

test("unirea: un cont doar-Steam se mută în contul principal, care intră apoi cu acel Steam", async ({ page, browser, request }) => {
  const id = uid();
  const steamId = `7656119${String(Date.now()).slice(-10)}`;
  const main = await newPage(browser, "198.51.101");
  await member(main, `Principal${id}`, `principal-${id}@example.com`);
  const { forum } = await forumTree(request);

  const steam = await newPage(browser, "198.51.102");
  await steamLogin(steam, steamId);
  await expect(steam.getByTestId("gcs-header-user")).toBeVisible();
  const steamUser = (
    await sql<{ id: string; name: string }>(`SELECT u.id, u.name FROM users u JOIN accounts a ON a."userId" = u.id WHERE a."providerId" = 'steam' AND a."accountId" = $1`, [steamId])
  )[0]!;
  const { id: steamUserId, name: steamName } = steamUser;
  await sql(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = 'member') WHERE id = $1`, [steamUserId]);
  await sql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
  const topic = await topicWithReplies(request, forum.id, `${steamId}@steam.invalid`, `Topic din contul Steam ${id}`);

  await enterAcpAsRoot(page, `RootMerge${id}`, `root-merge-${id}@example.com`);

  await test.step("previzualizarea: sursa, ținta, Steam trece în țintă, ce se mută", async () => {
    await page.goto(`/admin/members/${steamUserId}`);
    await page.getByTestId("gcs-member-merge").click();
    await page.getByLabel("Contul care rămâne (ținta)").fill(`principal-${id}@example.com`);
    await page.getByRole("button", { name: "Caută" }).click();
    await expect(page.getByTestId("gcs-merge-source")).toContainText(steamName);
    await expect(page.getByTestId("gcs-merge-target")).toContainText(`Principal${id}`);
    await expect(page.getByTestId("gcs-merge-logins").locator('[data-provider="steam"]')).toHaveAttribute("data-action", "move");
    await expect(page.getByTestId("gcs-merge-moves").locator('[data-key="forums.posts"] .gcs-removalItem__count')).toHaveText("1");
  });

  await test.step("confirmarea cu numele sursei: unirea rulează și se termină", async () => {
    const form = page.getByTestId("gcs-merge-form");
    await form.getByLabel(/Scrie numele contului sursă/).fill(steamName);
    await form.getByRole("button", { name: "Unește conturile" }).click();
    await expect(page).toHaveURL(/\/admin\/members\/removals\/[a-z0-9]+$/);
    await expect(page.getByTestId("gcs-removal-status")).toHaveAttribute("data-status", "DONE");
    await expect(page.getByTestId("gcs-removal-done")).toHaveText(/Conturile au fost unite/);
  });

  await test.step("postarea contului Steam e acum a contului principal", async () => {
    await page.goto(topic.url);
    await expect(page.getByTestId("gcs-post").first().getByTestId("gcs-postbit")).toContainText(`Principal${id}`);
  });

  await test.step("login-ul cu acel Steam intră acum în contul principal", async () => {
    const again = await newPage(browser, "198.51.103");
    await steamLogin(again, steamId);
    await expect(again.getByTestId("gcs-header-user")).toHaveText(`Principal${id}`);
    await again.goto("/settings/account");
    await expect(again.getByText(/Steam/).first()).toBeVisible();
  });
});

/** Capturile ecranelor noi (doar cu `GCS_E2E_SHOTS=<folder>`): ACP-ul în tema închisă și deschisă, pe desktop și la 375 px. */
test("capturi: ecranele ștergerii și unirii (dark / light, 375 px)", async ({ page, browser, request }) => {
  const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
  test.skip(!SHOTS, "doar cu GCS_E2E_SHOTS");
  test.setTimeout(300_000);
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  mkdirSync(SHOTS, { recursive: true });
  const id = uid();
  const target = await newPage(browser, "198.51.110");
  await member(target, `Victor${id}`, `victor-${id}@example.com`);
  const dup = await newPage(browser, "198.51.111");
  await member(dup, `Victor${id}x`, `victor-dup-${id}@example.com`);
  const { forum } = await forumTree(request);
  await topicWithReplies(request, forum.id, `victor-dup-${id}@example.com`, `Topic ${id}`, 2);
  await enterAcpAsRoot(page, `RootShot${id}`, `root-shot-${id}@example.com`);
  const dupId = (await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`victor-dup-${id}@example.com`]))[0]!.id;
  // O operație terminată, pentru pagina de progres și lista GDPR.
  const done = await newPage(browser, "198.51.112");
  await member(done, `Gata${id}`, `gata-${id}@example.com`);
  await dup.goto("/settings/account");
  await dup.getByTestId("gcs-delete-account").getByLabel("Parola contului").fill(PASSWORD);
  await dup.getByTestId("gcs-delete-account").getByRole("checkbox").check();
  await dup.getByTestId("gcs-delete-account").getByRole("button", { name: "Cere ștergerea contului" }).click();
  await expect(dup.getByTestId("gcs-delete-account-pending")).toBeVisible();
  const goneId = (await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`gata-${id}@example.com`]))[0]!.id;
  await page.goto(`/admin/members/${goneId}/delete`);
  await page.getByTestId("gcs-removal-delete-form").getByLabel(/Scrie numele membrului/).fill(`Gata${id}`);
  await page.getByTestId("gcs-removal-delete-form").getByRole("button", { name: "Șterge definitiv" }).click();
  await expect(page.getByTestId("gcs-removal-status")).toHaveAttribute("data-status", "DONE");
  const progressUrl = page.url();

  const screens: [string, string][] = [
    ["member", `/admin/members/${dupId}`],
    ["delete", `/admin/members/${dupId}/delete`],
    ["merge", `/admin/members/${dupId}/merge?target=${encodeURIComponent(`victor-${id}@example.com`)}`],
    ["progress", progressUrl],
    ["gdpr", "/admin/members/gdpr"],
  ];
  for (const theme of ["dark", "light"] as const) {
    await page.context().addCookies([{ name: "gcs-acp-theme", value: theme, url: `${new URL(page.url()).origin}/` }]);
    for (const [w, h, size] of [[1280, 900, "desktop"], [375, 812, "375"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const [name, url] of screens) {
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(300);
        if (name === "member") await page.getByTestId("gcs-member-danger").scrollIntoViewIfNeeded();
        // Fără bara orizontală de defilare la 375 px.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} ${theme} ${size}`).toBe(true);
        await page.screenshot({ path: path.join(SHOTS, `removal-${name}-${theme}-${size}.png`), fullPage: name !== "member" });
      }
    }
  }
  for (const theme of ["dark", "light"] as const) {
    await dup.context().addCookies([{ name: "gcs-theme", value: theme, url: `${new URL(dup.url()).origin}/` }]);
    await dup.setViewportSize({ width: 375, height: 812 });
    await dup.goto("/settings/account");
    await dup.getByTestId("gcs-delete-account").scrollIntoViewIfNeeded();
    await dup.screenshot({ path: path.join(SHOTS, `removal-settings-${theme}-375.png`) });
  }
});

test("un membru își cere ștergerea contului și o anulează; staff-ul vede cererea în Cereri GDPR", async ({ page, browser }) => {
  const id = uid();
  await member(page, `Razgandit${id}`, `razgandit-${id}@example.com`);

  await test.step("Setări → Cont → „Șterge contul”: parola și confirmarea creează cererea", async () => {
    await page.goto("/settings/account");
    const box = page.getByTestId("gcs-delete-account");
    await box.getByLabel("Parola contului").fill(PASSWORD);
    await box.getByRole("checkbox").check();
    await box.getByRole("button", { name: "Cere ștergerea contului" }).click();
    await expect(box.getByTestId("gcs-delete-account-pending")).toHaveText(/Contul tău va fi șters pe/);
    await page.goto("/");
    await expect(page.getByTestId("gcs-deletion-banner")).toBeVisible();
  });

  await test.step("staff-ul vede cererea programată în ACP → Cereri GDPR", async () => {
    const admin = await newPage(browser, "198.51.104");
    await enterAcpAsRoot(admin, `RootGdpr${id}`, `root-gdpr-${id}@example.com`);
    await admin.goto("/admin/members/gdpr?status=SCHEDULED");
    const row = admin.getByRole("row", { name: new RegExp(`Razgandit${id}`) });
    await expect(row.getByTestId("gcs-removal-status")).toHaveAttribute("data-status", "SCHEDULED");
    await expect(row.getByRole("button", { name: "Rulează acum" })).toBeVisible();
  });

  await test.step("banda duce la anulare; după anulare banda dispare", async () => {
    await page.getByTestId("gcs-deletion-banner").getByRole("link").click();
    await expect(page).toHaveURL(/\/settings\/account/);
    const box = page.getByTestId("gcs-delete-account");
    await box.getByRole("button", { name: "Anulează ștergerea" }).click();
    await expect(box.getByTestId("gcs-settings-status")).toHaveText("Cererea a fost anulată. Contul rămâne.");
    await expect(box.getByTestId("gcs-delete-account-pending")).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByTestId("gcs-deletion-banner")).toHaveCount(0);
    expect(await sql(`SELECT status FROM member_removals WHERE "userName" = $1`, [`Razgandit${id}`])).toEqual([{ status: "CANCELLED" }]);
  });
});
