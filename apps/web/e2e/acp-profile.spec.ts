import { expect, test } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("un câmp nou „Discord tag” (doar membri) apare în setări și pe profil doar pentru membri; un câmp obligatoriu blochează salvarea", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootField${id}`, `root-field-${id}@example.com`);
  await page.goto("/admin/members/settings/profiles");
  // Lista + panou: „Câmp nou” din antet deschide panoul cu formularul gol.
  await page.getByTestId("gcs-acp-field-new-open").click();
  const form = page.getByTestId("gcs-acp-field-new");
  await form.getByLabel("Cheia").fill(`dc_${id}`);
  await form.getByLabel("Eticheta").fill(`Discord tag ${id}`);
  await form.getByLabel("Secțiunea").selectOption("GAMES");
  await form.getByLabel("Cine îl vede").selectOption("MEMBERS");
  await form.getByRole("button", { name: "Câmp nou" }).click();
  await expect(form).toHaveCount(0);
  const card = page.locator(`[data-testid="gcs-acp-profile-field"][data-key="dc_${id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(`Discord tag ${id}`);
  await expect(card).toContainText("Membri");
  const panel = page.getByTestId("gcs-acp-field-edit");

  const mara = await memberInNewContext(browser, `Mara${id}`, `mara-${id}@example.com`, "198.51.100");
  await mara.goto("/settings/profile");
  await mara.getByLabel(`Discord tag ${id}`).fill("mara#1234");
  await mara.getByRole("button", { name: "Salvează" }).click();
  await expect(mara.getByTestId("gcs-settings-status")).toHaveText("Salvat.");
  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`mara-${id}@example.com`]);
  await mara.goto(`/members/${row!.id}?tab=games`);
  await expect(mara.getByText("mara#1234").first()).toBeVisible();

  const guest = await browser.newPage();
  await guest.goto(`/members/${row!.id}?tab=games`);
  await expect(guest.getByTestId("gcs-profile-name")).toBeVisible();
  await expect(guest.getByText("mara#1234")).toHaveCount(0);
  await guest.close();

  // Obligatoriu: salvarea profilului fără valoare e refuzată.
  await page.reload();
  await card.getByTestId("gcs-acp-field-edit-open").click();
  await expect(panel.getByTestId("gcs-acp-field-key")).toHaveValue(`dc_${id}`);
  await panel.getByLabel("Obligatoriu").check();
  await panel.getByRole("button", { name: "Salvează" }).click();
  await expect(panel).toHaveCount(0);
  await expect(card).toContainText("Obligatoriu");
  await mara.goto("/settings/profile");
  await mara.getByLabel(`Discord tag ${id} *`).fill("");
  await mara.getByLabel(`Discord tag ${id} *`).evaluate((el) => el.removeAttribute("required"));
  await mara.getByRole("button", { name: "Salvează" }).click();
  await expect(mara.getByTestId("gcs-settings-status")).toHaveText("Câmp obligatoriu");

  // Curățenie: câmpul obligatoriu nu trebuie să afecteze alte teste.
  await card.getByTestId("gcs-acp-field-edit-open").click();
  await panel.getByRole("button", { name: "Șterge" }).click();
  await page.getByTestId("gcs-confirm-ok").click();
  await expect(card).toHaveCount(0);
  await mara.close();
});

test("Profiluri: lista arată rânduri, nu formulare; panoul se deschide, salvează și se închide; ordinea și filele", async ({ page, request }) => {
  test.setTimeout(90_000);
  const id = uid();
  const field = (key: string, label: string) => request.post("/api/_test/forum", { data: { action: "profileField", key, label } }).then((r) => r.json() as Promise<{ id: number }>);
  await field(`ra_${id}`, `Rând A ${id}`);
  await field(`rb_${id}`, `Rând B ${id}`);
  const keys = [`ra_${id}`, `rb_${id}`];
  const dbOrder = async () => (await sql<{ key: string }>(`SELECT key FROM profile_fields WHERE key IN ($1, $2) ORDER BY position, id`, keys)).map((r) => r.key);

  await enterAcpAsRoot(page, `RootRows${id}`, `root-rows-${id}@example.com`);
  await page.goto("/admin/members/settings/profiles");
  const rows = page.getByTestId("gcs-acp-profile-field");
  const rowA = page.locator(`[data-testid="gcs-acp-profile-field"][data-key="ra_${id}"]`);
  const rowB = page.locator(`[data-testid="gcs-acp-profile-field"][data-key="rb_${id}"]`);

  await test.step("rânduri compacte: niciun formular deschis până la „Editează”", async () => {
    await expect(rowA).toBeVisible();
    await expect(rowB).toContainText("În postare");
    await expect(page.locator('input[name="key"]')).toHaveCount(0);
    await expect(page.locator('input[name="label"]')).toHaveCount(0);
  });

  await test.step("ordinea: săgeata mută B înaintea lui A și rămâne după reîncărcare", async () => {
    const shown = () => rows.evaluateAll((els, suffix) => els.map((e) => e.getAttribute("data-key")).filter((k) => k?.endsWith(suffix)), `_${id}`);
    // Câmpurile noi au aceeași poziție; între ele poate sta alt câmp, deci B urcă până trece de A.
    for (let i = 0; i < 5 && (await shown())[0] !== `rb_${id}`; i++) {
      await rowB.getByTestId("gcs-acp-sort-up").click();
      await expect(page.getByTestId("gcs-acp-profile-fields-status")).toHaveText("Ordinea a fost salvată.");
    }
    await expect.poll(dbOrder).toEqual([`rb_${id}`, `ra_${id}`]);
    await page.reload();
    await expect.poll(shown).toEqual([`rb_${id}`, `ra_${id}`]);
  });

  await test.step("panoul: se deschide cu formularul pe secțiuni, salvează, se închide; ordinea rămâne", async () => {
    await rowB.getByTestId("gcs-acp-field-edit-open").click();
    const panel = page.getByTestId("gcs-acp-field-edit");
    await expect(panel).toBeVisible();
    await expect(panel.locator("legend")).toContainText(["De bază", "Unde apare", "Link"]);
    await expect(panel.getByTestId("gcs-acp-field-key")).toHaveAttribute("readonly", "");
    // „Valori” apare doar la liste.
    await expect(panel.getByTestId("gcs-acp-field-options")).toHaveCount(0);
    await panel.getByTestId("gcs-acp-field-type").selectOption("SELECT");
    await expect(panel.getByTestId("gcs-acp-field-options")).toBeVisible();
    await expect(panel.getByTestId("gcs-acp-field-template")).toHaveCount(0);
    await panel.getByTestId("gcs-acp-field-type").selectOption("TEXT");
    await panel.getByTestId("gcs-acp-field-label").fill(`Rând Bis ${id}`);
    await panel.getByRole("button", { name: "Salvează" }).click();
    await expect(panel).toHaveCount(0);
    await expect(rowB).toContainText(`Rând Bis ${id}`);
    expect(await dbOrder()).toEqual([`rb_${id}`, `ra_${id}`]);
  });

  await test.step("căutarea filtrează lista și blochează ordonarea", async () => {
    await page.getByTestId("gcs-acp-profile-fields-search").fill(`ra_${id}`);
    await expect(rows).toHaveCount(1);
    await expect(rowA.getByTestId("gcs-acp-sort-up")).toHaveCount(0);
    await page.getByTestId("gcs-acp-profile-fields-search").fill(`nimic-${id}`);
    await page.getByRole("button", { name: "Golește filtrele" }).click();
    await expect(rowB).toBeVisible();
  });

  await test.step("filele: grupurile au propriul „Grup nou”, setările au cheia FACEIT", async () => {
    await page.getByTestId("gcs-acp-profiles-tab-groups").click();
    await expect(page).toHaveURL(/tab=groups/);
    await expect(page.getByTestId("gcs-acp-field-group-row").first()).toBeVisible();
    await page.getByTestId("gcs-acp-group-new-open").click();
    const panel = page.getByTestId("gcs-acp-group-new");
    await panel.getByTestId("gcs-acp-group-key").fill(`g_${id}`);
    await panel.getByTestId("gcs-acp-group-label").fill(`Grup ${id}`);
    await panel.getByRole("button", { name: "Adaugă un grup" }).click();
    await expect(panel).toHaveCount(0);
    const group = page.locator(`[data-testid="gcs-acp-field-group-row"][data-key="g_${id}"]`);
    await expect(group).toContainText(`Grup ${id}`);
    await group.getByTestId("gcs-acp-group-edit-open").click();
    await page.getByTestId("gcs-acp-group-edit").getByRole("button", { name: "Șterge" }).click();
    await page.getByTestId("gcs-confirm-ok").click();
    await expect(group).toHaveCount(0);

    await page.getByTestId("gcs-acp-profiles-tab-settings").click();
    await expect(page.getByTestId("gcs-acp-faceit-key")).toBeVisible();
    // Limitele semnăturii stau tot aici și se salvează.
    await page.getByLabel("Lungimea maximă (caractere)").fill("300");
    const settingsForm = page.locator("form.gcs-acpProf__settings");
    await settingsForm.getByRole("button", { name: "Salvează" }).click();
    await expect(settingsForm.getByRole("status")).toHaveText("Salvat");
    await page.reload();
    await expect(page.getByLabel("Lungimea maximă (caractere)")).toHaveValue("300");
  });

  await resetSetting("profile.signature_max_chars");
  await sql(`DELETE FROM profile_fields WHERE key IN ($1, $2)`, keys);
});

test("acordarea „VIP Gold 30 de zile” din fișa membrului stilizează numele pe topic în ≤ 2 s; retragerea îl readuce", async ({ page, request, browser }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  const author = await memberInNewContext(browser, `Vip${id}`, `vip-${id}@example.com`, "198.51.100");
  const topic = await topicWithReplies(request, forum.id, `vip-${id}@example.com`, `VIP ${id}`);
  await author.goto(topic.url);
  const name = author.getByTestId("gcs-post").first().locator(".gcs-post__authorName a");
  await expect(name).toHaveClass(/gcs-name--member/);

  await enterAcpAsRoot(page, `RootVip${id}`, `root-vip-${id}@example.com`);
  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`vip-${id}@example.com`]);
  await page.goto(`/admin/members/${row!.id}?tab=profile`);
  const vip = page.getByTestId("gcs-acp-member-vip");
  await vip.getByLabel("Nivel").selectOption({ label: "VIP Gold" });
  await vip.getByLabel("Zile").fill("30");
  await vip.getByRole("button", { name: "Acordă VIP" }).click();
  await expect(vip.getByTestId("gcs-acp-vip-active")).toContainText("VIP Gold");

  await expect.poll(async () => {
    await author.reload();
    return name.getAttribute("class");
  }, { timeout: 2000, intervals: [200] }).toContain("gcs-name--vip_gold");

  await vip.getByRole("button", { name: "Retrage VIP" }).click();
  await page.getByTestId("gcs-confirm-ok").click();
  await expect(vip.getByTestId("gcs-acp-vip-active")).toHaveCount(0);
  await author.reload();
  await expect(name).toHaveClass(/gcs-name--member/);
  await expect(vip.getByText("Retras")).toBeVisible();
  await author.close();
});
