import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { PASSWORD, register, totp, useFreshIp } from "./helpers";

/**
 * Smoke test-ul etapei 3 (specul etapei, §1), pe instanța instalată de `install.spec.ts` cu „Date demo”, cu worker-ul pornit:
 * profil completat + badge „Primul post” (prin worker) → VIP Gold acordat din ACP (nume stilizat în ≤ 2 s, rama Gold)
 * → hover card → follow + conversație A → B, C (B răspunde, C pleacă) → B îl ignoră pe A → VIP expirat (sweep).
 */
test.skip(!process.env.GCS_E2E_INSTALL_URL, "Rulează doar pe instanța de instalare (e2e/run.mts, build de producție).");

async function installSql<T extends Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  // Pe VPS (prin tunel), baza instanței se dă explicit; local e `redline_e2e_install` pe serverul E2E.
  const url = new URL(process.env.GCS_E2E_INSTALL_DB_URL ?? process.env.DATABASE_URL!);
  if (!process.env.GCS_E2E_INSTALL_DB_URL) url.pathname = "/redline_e2e_install";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query<T>(query, params)).rows;
  } finally {
    await client.end();
  }
}

async function setGroup(name: string, groupKey: string) {
  await installSql(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = $2) WHERE name = $1`, [name, groupKey]);
  await installSql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
}

async function newUser(browser: Browser, name: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await register(page, name, `${name.toLowerCase()}@example.com`);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await setGroup(name, group);
  return page;
}

const idOf = async (name: string) => (await installSql<{ id: string }>(`SELECT id FROM users WHERE name = $1`, [name]))[0]!.id;

test("etapa 3: profil + badge → VIP din ACP → ramă → hover card → conversație → ignorare → VIP expirat", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await useFreshIp(page.context(), "198.18.70");

  const mara = await newUser(browser, "Mara3", "198.18.71");
  const [welcome] = await installSql<{ id: number; slug: string }>(`SELECT id, slug FROM topics WHERE title LIKE 'Bun venit pe %' ORDER BY id LIMIT 1`);
  const topicUrl = `/topic/${welcome!.id}-${welcome!.slug}`;

  await test.step("membrul își completează profilul și primește „Primul post” după primul răspuns (prin worker)", async () => {
    await mara.goto("/settings/profile");
    await mara.getByLabel("Țară").fill("România");
    await mara.getByRole("button", { name: "Salvează" }).click();
    await expect(mara.getByTestId("gcs-settings-status")).toHaveText("Salvat.");
    await mara.goto("/settings/appearance");
    await mara.getByRole("button", { name: "#B794FF" }).click();
    await mara.getByRole("button", { name: "Salvează" }).click();
    await expect(mara.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

    await mara.goto(topicUrl);
    await mara.locator("#reply .gcs-editor__content").click();
    await mara.keyboard.type("Salut tuturor, abia m-am înscris!");
    await mara.getByRole("button", { name: "Trimite răspunsul" }).click();
    await expect(mara.getByText("Salut tuturor, abia m-am înscris!")).toBeVisible();

    const maraId = await idOf("Mara3");
    await expect
      .poll(async () => (await installSql(`SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub."badgeId" WHERE ub."userId" = $1 AND b.key = 'first_post'`, [maraId])).length, {
        timeout: 30_000,
      })
      .toBe(1);
    await mara.goto(`/members/${maraId}`);
    await expect(mara.getByTestId("gcs-profile-badges").locator(".gcs-badgeGrid__item", { hasText: "Primul post" })).toBeVisible();
    await expect(mara.locator(".gcs-profileField", { hasText: "Țară" })).toContainText("România");
  });

  await test.step("admin-ul acordă VIP Gold pe 30 de zile din ACP; numele e stilizat pe topic în ≤ 2 s; membrul alege rama Gold", async () => {
    await register(page, "Sef3", "sef3@example.com");
    await expect(page.getByTestId("gcs-header-user")).toHaveText("Sef3");
    await setGroup("Sef3", "root_admin");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/2fa-setup$/);
    await page.getByLabel("Parola contului").fill(PASSWORD);
    await page.getByRole("button", { name: "Continuă" }).click();
    const secret = (await page.getByTestId("gcs-totp-secret").textContent())?.trim() ?? "";
    await page.getByLabel("Codul din aplicație").fill(totp(secret));
    await page.getByRole("button", { name: "Activează 2FA" }).click();
    await page.getByLabel("Parolă").fill(PASSWORD);
    await page.getByLabel("Cod 2FA").fill(totp(secret));
    await page.getByRole("button", { name: "Intră în ACP" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.goto(`/admin/members/${await idOf("Mara3")}?tab=profile`);
    const vip = page.getByTestId("gcs-acp-member-vip");
    await vip.getByLabel("Nivel").selectOption({ label: "VIP Gold" });
    await vip.getByLabel("Zile").fill("30");
    await vip.getByRole("button", { name: "Acordă VIP" }).click();
    await expect(vip.getByTestId("gcs-acp-vip-active")).toContainText("VIP Gold");

    const name = mara.getByTestId("gcs-post").filter({ hasText: "abia m-am înscris" }).locator(".gcs-post__authorName a");
    await expect
      .poll(async () => {
        await mara.goto(topicUrl);
        return name.getAttribute("class");
      }, { timeout: 2000, intervals: [250] })
      .toContain("gcs-name--vip_gold");

    await mara.goto("/settings/appearance");
    await mara.getByTestId("gcs-frame-options").locator("label", { hasText: "Gold" }).click();
    await mara.getByRole("button", { name: "Salvează" }).click();
    await expect(mara.getByTestId("gcs-settings-status")).toHaveText("Salvat.");
    await mara.goto(topicUrl);
    await expect(mara.getByTestId("gcs-post").filter({ hasText: "abia m-am înscris" }).locator(".gcs-avatarFrame--gold")).toBeVisible();
  });

  const bogdan = await newUser(browser, "Bogdan3", "198.18.72");
  const cristi = await newUser(browser, "Cristi3", "198.18.73");

  await test.step("hover card-ul pe numele ei arată grupul, rangul și badge-urile", async () => {
    await bogdan.goto(topicUrl);
    await bogdan.getByTestId("gcs-post").filter({ hasText: "abia m-am înscris" }).locator(".gcs-post__authorName a").hover();
    const card = bogdan.getByTestId("gcs-hover-card");
    await expect(card).toBeVisible();
    await expect(card.getByText("VIP Gold")).toBeVisible();
    await expect(card.getByTestId("gcs-hover-rank")).toHaveText("Recrut");
    await expect(card.locator("img.gcs-badgeArt")).not.toHaveCount(0);
  });

  let conversationUrl = "";
  await test.step("A îl urmărește pe B și deschide o conversație cu B și C; B răspunde, C pleacă", async () => {
    await mara.goto(`/members/${await idOf("Bogdan3")}`);
    await mara.getByTestId("gcs-profile-follow").click();
    await expect(mara.getByTestId("gcs-profile-followers")).toHaveText("1");

    await mara.getByTestId("gcs-profile-message").click();
    await mara.locator("#gcs-pick-user").fill("Cristi3");
    await mara.getByRole("option").getByRole("button", { name: "Cristi3" }).click();
    await mara.getByLabel("Titlu").fill("Echipa de turneu");
    await mara.locator("form .gcs-editor__content").click();
    await mara.keyboard.type("Intrați cu mine la turneul de sâmbătă?");
    await mara.getByRole("button", { name: "Trimite" }).click();
    await expect(mara.getByTestId("gcs-conversation-title")).toHaveText("Echipa de turneu");
    conversationUrl = new URL(mara.url()).pathname;

    await bogdan.goto(conversationUrl);
    await bogdan.locator(".gcs-replyBox .gcs-editor__content").click();
    await bogdan.keyboard.type("Sunt în!");
    await bogdan.getByRole("button", { name: "Trimite" }).click();
    await expect(bogdan.getByTestId("gcs-message")).toHaveCount(2);

    await cristi.goto(conversationUrl);
    cristi.once("dialog", (d) => void d.accept());
    await cristi.getByTestId("gcs-conversation-leave").click();
    await expect(cristi).toHaveURL(/\/messages$/);
    expect((await cristi.goto(conversationUrl))?.status()).toBe(404);
  });

  await test.step("B o ignoră pe A; A nu-i mai poate scrie lui B", async () => {
    await bogdan.goto(`/members/${await idOf("Mara3")}`);
    await bogdan.locator(".gcs-menu summary").click();
    await bogdan.getByTestId("gcs-profile-ignore").click();
    await expect(bogdan.getByTestId("gcs-profile-ignore")).toHaveText("Nu mai ignora");

    await mara.goto(`/messages/new?to=${await idOf("Bogdan3")}`);
    await mara.getByLabel("Titlu").fill("Încă o dată");
    await mara.locator("form .gcs-editor__content").click();
    await mara.keyboard.type("Salut!");
    await mara.getByRole("button", { name: "Trimite" }).click();
    await expect(mara.getByRole("alert").filter({ hasText: "Unul dintre destinatari nu primește mesaje de la tine" })).toBeVisible();
  });

  await test.step("VIP-ul expirat: la sweep, Mara pierde grupul VIP, stilul și rama; istoricul arată „Expirat”", async () => {
    const maraId = await idOf("Mara3");
    await installSql(`UPDATE vip_subscriptions SET "expiresAt" = '2001-01-01' WHERE "userId" = $1 AND status = 'ACTIVE'`, [maraId]);
    const res = await page.request.post("/api/_test/profile", { data: { action: "sweep" } });
    expect(await res.json()).toMatchObject({ expired: 1 });

    await mara.goto(topicUrl);
    const post = mara.getByTestId("gcs-post").filter({ hasText: "abia m-am înscris" });
    await expect(post.locator(".gcs-post__authorName a")).toHaveClass(/gcs-name--member/);
    await expect(post.locator(".gcs-avatarFrame--gold")).toHaveCount(0);

    await page.goto(`/admin/members/${maraId}?tab=profile`);
    await expect(page.getByTestId("gcs-acp-member-vip").getByText("Expirat")).toBeVisible();
  });

  for (const p of [mara, bogdan, cristi]) await p.close();
});
