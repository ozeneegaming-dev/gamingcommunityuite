import { e2eKv } from "./kv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, groupId, setPrimaryGroup, sql, useFreshIp, userId } from "./helpers";

/**
 * Membri v2: lista ACP (filtre, căutare, acțiuni în masă), grupurile secundare temporare și publice, fișa membrului ca
 * dashboard (taburi, acțiuni, panoul unei aplicații, exportul GDPR), pagina Staff v2, /online și managerul de meniu v2.
 * Cu `GCS_E2E_SHOTS=<folder>`, salvează capturi.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

async function shot(target: Page | Locator, name: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), ...("url" in target && opts.fullPage ? { fullPage: true } : {}) });
}

async function redisDel(keys: string[], pattern?: string): Promise<void> {
  const redis = await e2eKv();
  try {
    if (keys.length) await redis.del(...keys);
    if (pattern) {
      const found = await redis.keys(pattern);
      if (found.length) await redis.del(...found);
    }
  } finally {
    redis.disconnect();
  }
}

async function setApp(key: string, enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [key, enabled]);
  await redisDel(["gcs:k:apps:enabled"], "gcs:k:groups-pro:*");
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** „Membru nou” din ACP (dialogul de pe listă); întoarce id-ul membrului creat. */
async function createInAcp(page: Page, name: string, email: string): Promise<string> {
  await page.goto("/admin/members");
  await page.getByTestId("gcs-member-create-open").click();
  const form = page.getByTestId("gcs-member-create");
  await form.getByLabel("Nume", { exact: true }).fill(name);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel(/Parolă/).fill("parola-sigura-123");
  await form.getByRole("button", { name: "Creează membrul" }).click();
  await expect(page).toHaveURL(/\/admin\/members\/[a-z0-9]+$/);
  return userId(email);
}

test("ACP → Membri: membru nou, filtrele rapide, căutarea și un grup secundar temporar dat în masă", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.91.0");
  const id = uid();
  await enterAcpAsRoot(page, `RootL${id}`, `rootl-${id}@example.com`);
  const a = await createInAcp(page, `Mv${id}a`, `mv-${id}-a@example.com`);
  await createInAcp(page, `Mv${id}b`, `mv-${id}-b@example.com`);

  await test.step("căutarea și filtrul rapid „Nevalidați”", async () => {
    await page.goto(`/admin/members?q=mv${id}`);
    await expect(page.getByTestId("gcs-member-row")).toHaveCount(2);
    await sql(`UPDATE users SET "emailVerified" = false WHERE id = $1`, [a]);
    await page.goto(`/admin/members?q=mv${id}&quick=unvalidated`);
    await expect(page.getByTestId("gcs-member-row")).toHaveCount(1);
    await expect(page.getByTestId("gcs-member-row").first()).toHaveAttribute("data-member", `Mv${id}a`);
    await expect(page.getByTestId("gcs-member-quick-unvalidated")).toHaveAttribute("aria-current", "page");
    // Sortarea pe coloană (descrescător după nume).
    await page.goto(`/admin/members?q=mv${id}&sort=name&dir=desc`);
    await expect(page.getByTestId("gcs-member-row").first()).toHaveAttribute("data-member", `Mv${id}b`);
  });

  await test.step("acțiunea în masă: VIP Silver ca grup secundar, cu expirare, după confirmarea din pagină", async () => {
    await page.goto(`/admin/members?q=mv${id}`);
    await page.getByTestId("gcs-member-select-all").check();
    await expect(page.getByTestId("gcs-member-bulk-count")).toContainText("2");
    await page.getByTestId("gcs-member-bulk-op").selectOption("add_secondary");
    await page.getByTestId("gcs-member-bulk-group").selectOption({ label: "VIP Silver" });
    await page.getByTestId("gcs-member-bulk-expiry").fill(inDays(10));
    await shot(page, "acp-members-list", { fullPage: true });
    await page.getByTestId("gcs-member-bulk-apply").click();
    await expect(page.getByTestId("gcs-confirm-dialog")).toBeVisible();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(page.getByTestId("gcs-member-bulk-status")).toContainText("2 schimbați");
    await expect(page.getByTestId("gcs-member-secondary-count")).toHaveCount(2);
    const rows = await sql<{ n: number }>(`SELECT COUNT(*)::int AS n FROM user_groups WHERE "groupId" = $1 AND "expiresAt" IS NOT NULL AND "userId" IN (SELECT id FROM users WHERE "nameNormalized" LIKE $2)`, [await groupId("vip_silver"), `mv${id}%`]);
    expect(rows[0]!.n).toBe(2);
  });

  await test.step("fișa membrului arată expirarea și sursa grupului", async () => {
    await page.goto(`/admin/members/${a}`);
    const secondary = page.locator('[data-testid="gcs-member-secondary"][data-group="vip_silver"]');
    await expect(secondary.getByTestId("gcs-member-secondary-meta")).toContainText("expiră pe");
    await expect(secondary.getByTestId("gcs-member-secondary-meta")).toContainText("manual");
    // „Gestionează” deschide popupul Grupuri (același ca butonul din bară), cu expirarea și scoaterea grupului.
    await page.getByTestId("gcs-member-card-groups-manage").click();
    const groups = page.getByTestId("gcs-member-modal-groups");
    await expect(groups.locator('[data-testid="gcs-member-secondary-edit"][data-group="vip_silver"]')).toBeVisible();
    await expect(groups.getByTestId("gcs-member-add-group")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(groups).toHaveCount(0);
  });
});

test("grupul secundar temporar expiră: jobul îl scoate și membrul primește notificarea", async ({ browser }) => {
  test.setTimeout(150_000);
  const id = uid();
  const m = await memberInNewContext(browser, `Exp${id}`, `exp-${id}@example.com`, "100.91.1");
  const member = await userId(`exp-${id}@example.com`);
  const gold = await groupId("vip_gold");
  await sql(`INSERT INTO user_groups ("userId", "groupId", source, "expiresAt") VALUES ($1, $2, 'store', (now() AT TIME ZONE 'UTC') - interval '1 minute')`, [member, gold]);
  // Jobul `groups.secondary_expiry` rulează în worker la fiecare minut.
  await expect
    .poll(async () => (await sql(`SELECT 1 FROM user_groups WHERE "userId" = $1 AND "groupId" = $2`, [member, gold])).length, { timeout: 120_000, intervals: [3000] })
    .toBe(0);
  await expect.poll(async () => (await sql(`SELECT 1 FROM notifications WHERE "userId" = $1 AND type = 'core.group_expired'`, [member])).length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await sql(`SELECT 1 FROM audit_logs WHERE action = 'user.secondary_expired' AND "targetId" = $1`, [member])).length).toBe(1);
  await m.close();
});

test("grupurile publice: adminul bifează „public”, membrul intră și iese din Setări → Grupuri", async ({ page, context, browser }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.91.2");
  const id = uid();
  await enterAcpAsRoot(page, `RootO${id}`, `rooto-${id}@example.com`);
  const [club] = await sql<{ id: number }>(`INSERT INTO groups (key, name, position) VALUES ($1, $2, 900) RETURNING id`, [`custom_club_${id}`, `Club${id}`]);
  await page.goto(`/admin/groups/${club!.id}`);
  await page.getByTestId("gcs-group-optin").check();
  const section = page.getByRole("region", { name: "Grup public" });
  await section.getByRole("button", { name: "Salvează" }).click();
  await expect(section.getByRole("status")).toHaveText("Salvat");

  const m = await memberInNewContext(browser, `Opt${id}`, `opt-${id}@example.com`, "100.91.3");
  await m.goto("/settings/groups");
  const row = m.locator(`[data-testid="gcs-optin-group"][data-group="Club${id}"]`);
  await expect(row).toHaveAttribute("data-joined", "0");
  await row.getByTestId("gcs-optin-join").click();
  await expect(m.getByTestId("gcs-optin-status")).toContainText(`Ai intrat în Club${id}`);
  await expect(row).toHaveAttribute("data-joined", "1");
  await shot(m, "settings-groups");
  const member = await userId(`opt-${id}@example.com`);
  expect(await sql(`SELECT source FROM user_groups WHERE "userId" = $1 AND "groupId" = $2`, [member, club!.id])).toEqual([{ source: "optin" }]);
  await row.getByTestId("gcs-optin-leave").click();
  await expect(m.getByTestId("gcs-optin-status")).toContainText(`Ai ieșit din Club${id}`);
  await expect(row).toHaveAttribute("data-joined", "0");
  await m.close();
  await sql(`DELETE FROM groups WHERE id = $1`, [club!.id]);
});

test("fișa membrului: taburile, acțiunile contului, cardul clanului apare și dispare cu aplicația, exportul GDPR", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.91.4");
  const id = uid();
  await enterAcpAsRoot(page, `RootD${id}`, `rootd-${id}@example.com`);
  const m = await memberInNewContext(browser, `Dash${id}`, `dash-${id}@example.com`, "100.91.5");
  const member = await userId(`dash-${id}@example.com`);
  const tag = `D${id}`.slice(0, 5).toUpperCase();
  const [clan] = await sql<{ id: number }>(
    `INSERT INTO clans (tag, "tagNormalized", name, "nameNormalized", slug, status, "membersCount", "createdAt", "updatedAt") VALUES ($1, $1, $2, $3, 'c', 'ACTIVE', 1, now(), now()) RETURNING id`,
    [tag, `Clanul ${id}`, `clanul ${id}`],
  );
  await sql(`INSERT INTO clan_members ("clanId", "userId", role) VALUES ($1, $2, 'LEADER')`, [clan!.id, member]);
  await setApp("clans", true);

  try {
    await test.step("taburile de bază și cardul clanului (aplicația Clanuri pornită)", async () => {
      await page.goto(`/admin/members/${member}`);
      for (const tab of ["overview", "profile", "activity", "permissions", "log"]) await expect(page.getByTestId(`gcs-member-tab-${tab}`)).toBeVisible();
      await expect(page.getByTestId("gcs-member-panel-clan_membership")).toContainText(`Clanul ${id}`);
      await expect(page.getByTestId("gcs-member-card-activity")).toBeVisible();
      await expect(page.getByTestId("gcs-member-card-quotas")).toBeVisible();
      await shot(page, "acp-member-dashboard", { fullPage: true });
    });

    await test.step("prezentarea doar arată: niciun formular deschis; acțiunile se deschid în popup", async () => {
      // Pe pagină (în afara popupurilor) nu stă niciun formular: Ban, Avertisment, Donație, Grupuri sunt în popupuri.
      await expect(page.locator(".gcs-mpOverview form")).toHaveCount(0);
      await expect(page.getByTestId("gcs-acp-ban-reason")).toHaveCount(0);
      await expect(page.getByTestId("gcs-member-add-group")).toHaveCount(0);
      const bar = page.getByTestId("gcs-member-danger");
      for (const which of ["groups", "warn", "ban"]) await expect(bar.getByTestId(`gcs-member-act-${which}`)).toBeVisible();
      await expect(bar.getByTestId("gcs-member-delete")).toBeVisible();

      await bar.getByTestId("gcs-member-act-ban").click();
      const ban = page.getByRole("dialog", { name: "Banează membrul" });
      await expect(ban.getByTestId("gcs-acp-ban-reason")).toBeFocused();
      await ban.getByRole("button", { name: "Închide" }).click();
      await expect(ban).toHaveCount(0);

      await bar.getByTestId("gcs-member-act-warn").click();
      await expect(page.getByRole("dialog", { name: "Avertizează membrul" }).getByLabel("Puncte")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // „Mai multe”: meniul cu acțiunile rare (tastatura: săgeți, Escape închide).
      await bar.getByTestId("gcs-member-more").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByTestId("gcs-member-gdpr-export")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await shot(page, "acp-member-actions");

      // „Ban pe site…” din chat (`?ban=1&reason=…`): popupul Ban se deschide singur, cu motivul completat.
      await page.goto(`/admin/members/${member}?ban=1&reason=${encodeURIComponent(`din chat ${id}`)}`);
      await expect(page.getByRole("dialog", { name: "Banează membrul" }).getByTestId("gcs-acp-ban-reason")).toHaveValue(`din chat ${id}`);
      await page.goto(`/admin/members/${member}`);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("aplicația oprită: cardul dispare; pornită din nou: revine", async () => {
      await setApp("clans", false);
      await page.reload();
      await expect(page.getByTestId("gcs-member-identity")).toBeVisible();
      await expect(page.getByTestId("gcs-member-panel-clan_membership")).toHaveCount(0);
      await setApp("clans", true);
      await page.reload();
      await expect(page.getByTestId("gcs-member-panel-clan_membership")).toBeVisible();
    });

    await test.step("celelalte taburi: Activitate, Permisiuni, Jurnal", async () => {
      await page.getByTestId("gcs-member-tab-activity").click();
      await expect(page.getByTestId("gcs-member-activity-chart")).toBeVisible();
      await page.getByTestId("gcs-member-tab-permissions").click();
      await expect(page.getByTestId("gcs-member-permissions")).toBeVisible();
      await page.getByTestId("gcs-member-tab-overview").click();
      await expect(page.getByTestId("gcs-member-card-content")).toBeVisible();
    });

    await test.step("„Marchează spammer” cu confirmarea din pagină, apoi jurnalul contului", async () => {
      // Popupul cu opțiunile acțiunii e și pasul de confirmare (textul spune că membrul e și banat).
      await page.getByTestId("gcs-member-more").click();
      await page.getByTestId("gcs-member-spammer").click();
      const spam = page.getByTestId("gcs-member-modal-spammer");
      await expect(spam).toContainText("banat permanent");
      await spam.getByRole("button", { name: "Marchează ca spammer" }).click();
      await expect(spam).toHaveCount(0);
      await expect(page.getByTestId("gcs-member-identity")).toContainText("Spammer");
      expect((await sql<{ isSpammer: boolean }>(`SELECT "isSpammer" FROM users WHERE id = $1`, [member]))[0]!.isSpammer).toBe(true);
      await page.getByTestId("gcs-member-tab-log").click();
      await expect(page.getByTestId("gcs-member-log").locator('[data-action="user.mark_spammer"]')).toBeVisible();
    });

    await test.step("exportul GDPR: o arhivă ZIP cu datele, intrată în jurnal", async () => {
      await page.getByTestId("gcs-member-tab-overview").click();
      const res = await page.request.get(`/admin/members/${member}/gdpr.zip`);
      expect(res.status(), await res.text().catch(() => "")).toBe(200);
      expect(res.headers()["content-disposition"]).toContain(`gdpr-Dash${id}-`);
      await page.getByTestId("gcs-member-more").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("gcs-member-gdpr-export").click()]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      const bytes = await res.body();
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      expect(bytes.includes(Buffer.from("account.json"))).toBe(true);
      expect(bytes.includes(Buffer.from("summary.json"))).toBe(true);
      expect((await sql(`SELECT 1 FROM audit_logs WHERE action = 'member.gdpr_export' AND "targetId" = $1`, [member])).length).toBeGreaterThanOrEqual(1);
    });
  } finally {
    await setApp("clans", true);
    await sql(`DELETE FROM clans WHERE id = $1`, [clan!.id]);
    await m.close();
  }
});

test("pagina Staff v2: ordinea și titlul secțiunilor din ACP, cardul detaliat cu responsabilități, cel compact", async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.91.6");
  const id = uid();
  await enterAcpAsRoot(page, `RootS${id}`, `roots-${id}@example.com`);
  const m = await memberInNewContext(browser, `Mod${id}`, `mod-${id}@example.com`, "100.91.7");
  await setPrimaryGroup(`mod-${id}@example.com`, "moderator");
  const moderator = await groupId("moderator");
  const rootGroup = await groupId("root_admin");

  try {
    await page.goto("/admin/members/staff/page");
    const modRow = page.locator(`[data-testid="gcs-staff-editor-section"][data-group-id="${moderator}"]`);
    const rootRow = page.locator(`[data-testid="gcs-staff-editor-section"][data-group-id="${rootGroup}"]`);
    await modRow.getByTestId("gcs-staff-editor-title").fill(`Echipa ${id}`);
    await rootRow.getByTestId("gcs-staff-layout-compact").click();
    // Moderatorii primii: ↑ până sus.
    for (let i = 0; i < 6; i++) {
      const up = modRow.getByRole("button", { name: /Mută .* mai sus/ });
      if (await up.isDisabled()) break;
      await up.click();
    }
    await page.getByTestId("gcs-staff-save").click();
    // (dnd-kit are și el o regiune `status`, pentru cititoarele de ecran.)
    await expect(page.getByTestId("gcs-staff-editor").getByText("Salvat", { exact: true })).toBeVisible();

    const editor = page.locator(`[data-testid="gcs-staff-editor-member"][data-member="Mod${id}"]`);
    await editor.locator("summary").click();
    await editor.getByTestId("gcs-staff-duties").fill("Reclamații\nEvenimente");
    await editor.getByRole("button", { name: "Salvează" }).click();
    await expect(editor.getByRole("status")).toHaveText("Salvat");
    await shot(page, "acp-staff-page", { fullPage: true });

    await m.goto("/staff");
    const first = m.getByTestId("gcs-staff-group").first();
    await expect(first).toHaveAttribute("data-group", "moderator");
    await expect(first).toHaveAttribute("data-layout", "detailed");
    await expect(first.getByTestId("gcs-staff-section-title")).toHaveText(`Echipa ${id}`);
    const card = first.getByTestId("gcs-staff-card").filter({ hasText: `Mod${id}` });
    await expect(card).toContainText("Responsabilități");
    await expect(card).toContainText("Reclamații");
    await expect(m.locator('[data-testid="gcs-staff-group"][data-group="root_admin"]')).toHaveAttribute("data-layout", "compact");
    await shot(m, "staff-page", { fullPage: true });
    await m.setViewportSize({ width: 375, height: 812 });
    await m.reload();
    await shot(m, "staff-page-375", { fullPage: true });
    await m.context().addCookies([{ name: "gcs-theme", value: "light", url: new URL(m.url()).origin }]);
    await m.setViewportSize({ width: 1280, height: 900 });
    await m.reload();
    await shot(m, "staff-page-light", { fullPage: true });
  } finally {
    await sql(`DELETE FROM staff_sections`);
    await sql(`DELETE FROM staff_profiles`);
    await m.close();
  }
});

test("/online: cine e unde („Vede topicul X”), filtrele și IP-ul doar pentru staff", async ({ page, context, browser, request }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.91.8");
  const id = uid();
  await enterAcpAsRoot(page, `RootW${id}`, `rootw-${id}@example.com`);
  const m = await memberInNewContext(browser, `Where${id}`, `where-${id}@example.com`, "100.91.9");
  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, `where-${id}@example.com`, `Topicul ${id}`);
  await m.goto(topic.url);
  await expect(m.getByRole("heading", { name: `Topicul ${id}` }).first()).toBeVisible();

  const row = page.locator(`[data-testid="gcs-online-row"][data-name="Where${id}"]`);
  // Prezența îl arată imediat; locul vine din semnul trimis de pagină (după hidratare).
  await expect
    .poll(
      async () => {
        await page.goto("/online");
        return (await row.count()) === 1 ? await row.getByTestId("gcs-online-where").innerText() : "";
      },
      { timeout: 30_000, intervals: [1500] },
    )
    .toContain("Vede topicul");
  await expect(row.getByTestId("gcs-online-where-link")).toHaveText(`Topicul ${id}`);
  await expect(row.getByTestId("gcs-online-ip")).toContainText("100.91.9");
  await shot(page, "online-page", { fullPage: true });

  await page.getByTestId("gcs-online-filter-guests").click();
  await expect(page).toHaveURL(/show=guests/);
  await expect(row).toHaveCount(0);
  await page.getByTestId("gcs-online-filter-members").click();
  await expect(row).toHaveCount(1);

  // Un membru obișnuit nu vede IP-urile.
  await m.goto("/online");
  await expect(m.getByTestId("gcs-online-list")).toBeVisible();
  await expect(m.getByTestId("gcs-online-ip")).toHaveCount(0);
  await m.close();
});

test("Manager meniu v2: un item nou, drag & drop, previzualizarea antetului real cu ciorna, apoi Publică", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.91.10");
  const id = uid();
  const label = `Meniu${id}`;
  await enterAcpAsRoot(page, `RootN${id}`, `rootn-${id}@example.com`);
  const guestContext = await browser.newContext();
  await useFreshIp(guestContext, "100.91.11");
  const guest = await guestContext.newPage();

  try {
    await page.setViewportSize({ width: 1400, height: 1200 });
    await page.goto("/admin/system/menu");
    await expect(page.getByTestId("gcs-menu-tree")).toBeVisible();
    await page.getByTestId("gcs-menu-add").click();
    const panel = page.getByTestId("gcs-menu-editor-panel");
    await panel.getByTestId("gcs-menu-label-input").fill(label);
    await panel.getByTestId("gcs-menu-href").fill("/online");
    await expect(page.getByTestId("gcs-menu-status")).toHaveText("Ciornă salvată");
    await expect(page.getByTestId("gcs-menu-state")).toHaveText("Ciornă nepublicată");

    await test.step("drag & drop: itemul nou ajunge primul în arbore", async () => {
      const mine = page.locator(`[data-testid="gcs-menu-row"][data-label="${label}"]`);
      const firstRow = page.locator('[data-testid="gcs-menu-row"]').first();
      const from = await mine.getByTestId("gcs-menu-grip").boundingBox();
      const to = await firstRow.getByTestId("gcs-menu-grip").boundingBox();
      expect(from && to).toBeTruthy();
      await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
      await page.mouse.down();
      await page.mouse.move(from!.x + from!.width / 2, from!.y - 10, { steps: 4 });
      await page.mouse.move(to!.x + to!.width / 2, to!.y + 2, { steps: 20 });
      await page.mouse.up();
      await expect(page.locator('[data-testid="gcs-menu-row"]').first()).toHaveAttribute("data-label", label);
      await expect(page.locator('[data-testid="gcs-menu-row"]').first()).toHaveAttribute("data-depth", "0");
      await expect(page.getByTestId("gcs-menu-status")).toHaveText("Ciornă salvată");
    });

    await test.step("previzualizarea arată ciorna în antetul real; site-ul nu", async () => {
      const frame = page.frameLocator('[data-testid="gcs-menu-preview-frame"]');
      // Antetul real al temei (clasic sau constructorul Nova) randat cu ciorna; în cadrul îngust al previzualizării
      // antetul poate trece pe sertarul de mobil, deci verificăm documentul servit previzualizării.
      await expect(frame.locator("body")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("gcs-menu-preview-frame")).toHaveAttribute("src", /gcs-nav-preview=1/);
      const html = await (await page.request.get("/?gcs-nav-preview=1", { headers: { "sec-fetch-dest": "iframe" } })).text();
      expect(html).toContain(label);
      await shot(page, "acp-menu-manager", { fullPage: true });
      await page.getByTestId("gcs-menu-device-mobile").click();
      await shot(page.getByTestId("gcs-menu-preview"), "acp-menu-preview-mobile");
      await page.getByTestId("gcs-menu-device-desktop").click();
      await guest.goto("/");
      expect(await guest.content()).not.toContain(label);
      // Fără drept pe Manager meniu, parametrul nu arată ciorna.
      expect(await (await guest.request.get("/?gcs-nav-preview=1")).text()).not.toContain(label);
    });

    await test.step("Publică (confirmarea din pagină): vizitatorii văd itemul", async () => {
      await page.getByTestId("gcs-menu-publish").click();
      await page.getByTestId("gcs-confirm-ok").click();
      await expect(page.getByTestId("gcs-menu-status")).toHaveText("Meniul a fost publicat.");
      await expect(page.getByTestId("gcs-menu-state")).toHaveText("Publicat");
      await guest.goto("/");
      expect(await guest.content()).toContain(label);
      await expect(guest.locator('a[href="/online"]').filter({ hasText: label }).first()).toBeAttached();
      expect((await sql(`SELECT 1 FROM nav_drafts`)).length).toBe(0);
    });
  } finally {
    await sql(`DELETE FROM nav_items WHERE label->>'ro' = $1`, [label]);
    await sql(`DELETE FROM nav_drafts`);
    await redisDel([], "gcs:k:nav*");
    await guestContext.close();
  }
});
