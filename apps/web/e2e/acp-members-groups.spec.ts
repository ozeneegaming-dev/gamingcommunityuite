import { expect, test, type Browser, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcp, enterAcpAsRoot, groupId, register, setPrimaryGroup, sql, useFreshIp, userId } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "192.0.2");
});

/** Un membru obișnuit (grupul `member`), logat într-un context separat de browser. */
async function memberSession(browser: Browser, name: string, email: string): Promise<{ page: Page; id: string }> {
  const context = await browser.newContext();
  await useFreshIp(context, "198.18.0");
  const page = await context.newPage();
  await register(page, name, email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await setPrimaryGroup(email, "member");
  return { page, id: await userId(email) };
}

test("ACP → site: culoarea grupului, matricea de permisiuni, banul și jurnalul", async ({ page, browser }) => {
  await enterAcpAsRoot(page, "RootM", "root-m@example.com");
  const member = await memberSession(browser, "Jucator", "jucator@example.com");
  const memberGroup = await groupId("member");

  await test.step("culoarea grupului member ajunge pe profilul membrului în ≤ 2 s", async () => {
    // Membrul are deja pagina deschisă (în modul dev, prima accesare compilează ruta).
    await member.page.goto(`/members/${member.id}`);
    await expect(member.page.getByTestId("gcs-profile-name")).toBeVisible();

    await page.goto(`/admin/groups/${memberGroup}`);
    const style = page.getByRole("region", { name: "Stilul numelui" });
    await style.getByLabel("Culoare").fill("#22d3ee");
    await style.getByRole("button", { name: "Salvează stilul" }).click();
    await expect(style.getByRole("status")).toHaveText("Salvat");

    // Criteriul 4 din spec: modificarea din ACP e vizibilă pe site în ≤ 2 s, fără restart.
    const started = Date.now();
    await member.page.reload();
    await expect
      .poll(() => member.page.getByTestId("gcs-profile-name").evaluate((el) => getComputedStyle(el).color), { timeout: 2000 })
      .toBe("rgb(34, 211, 238)");
    expect(Date.now() - started).toBeLessThanOrEqual(2000);
  });

  await test.step("permisiunea pe container: acordată → 200, scoasă → 404 imediat", async () => {
    await page.goto("/admin/permissions/test/1");
    const cell = page.getByRole("checkbox", { name: "Membru: Vede containerul de test" });
    await cell.check();
    await page.getByRole("button", { name: "Salvează permisiunile" }).click();
    await expect(page.getByRole("status")).toHaveText("Salvat");
    expect((await member.page.goto("/_test/container/test/1"))?.status()).toBe(200);

    await cell.uncheck();
    await page.getByRole("button", { name: "Salvează permisiunile" }).click();
    await expect(page.getByRole("status")).toHaveText("Salvat");
    expect((await member.page.goto("/_test/container/test/1"))?.status()).toBe(404);
  });

  await test.step("în jurnal apare group.update cu valorile înainte și după", async () => {
    await page.goto("/admin/logs?action=group.update");
    const entry = page.locator('details[data-action="group.update"]').first();
    await entry.locator("summary").click();
    await expect(entry.getByText(/"color": "#22D3EE"/).first()).toBeVisible();
    await expect(entry.getByText(/"color": "#ECEDF1"/).first()).toBeVisible();
  });

  await test.step("banarea membrului îl deloghează la următorul request", async () => {
    await page.goto(`/admin/members/${member.id}`);
    // Banul se dă din popupul „Banează” al barei de acțiuni; popupul se închide, iar cardul Banuri arată banul activ.
    await page.getByTestId("gcs-member-act-ban").click();
    const ban = page.getByRole("dialog", { name: "Banează membrul" });
    await ban.getByLabel("Motiv").fill("spam");
    await ban.getByRole("button", { name: "Banează" }).click();
    await expect(ban).toHaveCount(0);
    await expect(page.getByTestId("gcs-member-card-bans").locator('[data-status="active"]')).toContainText("spam");

    await member.page.goto("/");
    await expect(member.page.getByRole("link", { name: "Autentificare" })).toBeVisible();
    await expect(member.page.getByTestId("gcs-header-user")).toHaveCount(0);
  });

  // Grupul `member` e comun tuturor specurilor (ex. names-light verifică culoarea implicită): culoarea revine.
  await test.step("culoarea implicită a grupului member revine", async () => {
    await page.goto(`/admin/groups/${memberGroup}`);
    const style = page.getByRole("region", { name: "Stilul numelui" });
    await style.getByLabel("Culoare").fill("#ECEDF1");
    await style.getByRole("button", { name: "Salvează stilul" }).click();
    await expect(style.getByRole("status")).toHaveText("Salvat");
  });
});

test("un Admin cu rolul „Manager VIP” nu vede aplicația Membri; /admin/members → 404", async ({ page, browser }) => {
  await enterAcpAsRoot(page, "RootV", "root-v@example.com");

  // Adminul (grupul admin are acp.access) intră în ACP; fără niciun rol nu vede nimic.
  const adminContext = await browser.newContext();
  await useFreshIp(adminContext, "198.19.0");
  const adminPage = await adminContext.newPage();
  await enterAcp(adminPage, "AdminVIP", "admin-vip@example.com", "admin");

  await page.goto("/admin/staff/roles");
  await page.getByLabel("Numele rolului").fill("Manager VIP");
  await page.getByRole("button", { name: "Creează rolul" }).click();
  const role = page.getByRole("region", { name: "Manager VIP" });
  await expect(role).toBeVisible();
  await role.getByText("Drepturi pe secțiuni").click();
  await role.getByRole("checkbox", { name: "Dashboard: Vezi" }).check();
  await role.getByRole("button", { name: "Salvează drepturile" }).click();
  await expect(role.getByRole("status")).toHaveText("Salvat");
  await role.getByLabel("Nume de utilizator").fill("AdminVIP");
  await role.getByRole("button", { name: "Atribuie userului" }).click();
  await expect(role.getByText("AdminVIP", { exact: true })).toBeVisible();

  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  // Bara de iconițe: doar Dashboard-ul (singurul drept); zona Membri lipsește.
  const apps = adminPage.getByRole("navigation", { name: "Zonele ACP" });
  await expect(apps.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(apps.getByRole("button", { name: "Membri" })).toHaveCount(0);
  expect((await adminPage.goto("/admin/members"))?.status()).toBe(404);
});

test("Grupuri: rânduri compacte cu etichete și filtre; ordinea schimbată cu ↑/↓ sau prin tragere rămâne salvată", async ({ page }) => {
  test.setTimeout(120_000);
  const id = uid();
  await enterAcpAsRoot(page, `RootG${id}`, `root-g${id}@example.com`);
  const [alfa] = await sql<{ id: number }>(`INSERT INTO groups (key, name, position) VALUES ($1, $2, 9990) RETURNING id`, [`custom_alfa_${id}`, `Alfa${id}`]);
  const [beta] = await sql<{ id: number }>(`INSERT INTO groups (key, name, position) VALUES ($1, $2, 9991) RETURNING id`, [`custom_beta_${id}`, `Beta${id}`]);
  const rows = page.getByTestId("gcs-acp-group");
  const row = (name: string) => page.locator(`[data-testid="gcs-acp-group"][data-group-name="${name}"]`);
  const order = async () => {
    const names = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-group-name")));
    return { alfa: names.indexOf(`Alfa${id}`), beta: names.indexOf(`Beta${id}`) };
  };

  try {
    await page.goto("/admin/groups");
    // Drepturile importante pe rând: Root Admin are ACP complet și e moderator global; Membru n-are etichete de staff.
    const root = page.locator('[data-testid="gcs-acp-group"][data-group="root_admin"]');
    await expect(root.locator('[data-flag="acpFull"]')).toBeVisible();
    await expect(root.locator('[data-flag="globalMod"]')).toBeVisible();
    await expect(page.locator('[data-testid="gcs-acp-group"][data-group="member"] [data-flag="acp"]')).toHaveCount(0);
    await expect(row(`Alfa${id}`)).toContainText("Personalizat");

    // Filtrul „Personalizate” și căutarea; reordonarea e oprită cât lista nu e completă.
    await page.getByTestId("gcs-groups-filter-custom").click();
    await expect(row(`Alfa${id}`)).toBeVisible();
    await expect(root).toHaveCount(0);
    await page.getByTestId("gcs-groups-filter-all").click();
    await page.getByTestId("gcs-groups-search").fill(`Beta${id}`);
    await expect(rows).toHaveCount(1);
    await expect(row(`Beta${id}`).getByRole("button", { name: `Mută Beta${id} mai sus` })).toBeDisabled();
    await page.getByTestId("gcs-groups-search").fill("");

    // ↑ pe Beta: trece înaintea lui Alfa și rămâne așa după reîncărcare.
    expect((await order()).alfa).toBeLessThan((await order()).beta);
    await row(`Beta${id}`).getByRole("button", { name: `Mută Beta${id} mai sus` }).click();
    await expect(page.getByTestId("gcs-groups-status")).toHaveText("Ordinea a fost salvată");
    await page.reload();
    await expect(row(`Alfa${id}`)).toBeVisible();
    expect((await order()).beta).toBeLessThan((await order()).alfa);

    // Tragerea de mâner: Alfa înapoi deasupra lui Beta, salvat și după reîncărcare.
    const handle = row(`Alfa${id}`).getByTestId("gcs-group-drag");
    await handle.scrollIntoViewIfNeeded();
    const from = (await handle.boundingBox())!;
    const to = (await row(`Beta${id}`).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 8, { steps: 4 });
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 15 });
    await page.mouse.up();
    await expect(page.getByTestId("gcs-groups-status")).toHaveText("Ordinea a fost salvată");
    await page.reload();
    await expect(row(`Alfa${id}`)).toBeVisible();
    expect((await order()).alfa).toBeLessThan((await order()).beta);
    const [pa] = await sql<{ position: number }>(`SELECT position FROM groups WHERE id = $1`, [alfa!.id]);
    const [pb] = await sql<{ position: number }>(`SELECT position FROM groups WHERE id = $1`, [beta!.id]);
    expect(pa!.position).toBeLessThan(pb!.position);
  } finally {
    await sql(`DELETE FROM groups WHERE id IN ($1, $2)`, [alfa!.id, beta!.id]);
  }
});
