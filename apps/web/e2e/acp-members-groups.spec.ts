import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterAcp, enterAcpAsRoot, groupId, register, setPrimaryGroup, useFreshIp, userId } from "./helpers";

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
    const ban = page.getByRole("region", { name: "Ban" });
    await ban.getByLabel("Motiv").fill("spam");
    await ban.getByRole("button", { name: "Banează" }).click();
    await expect(ban.getByRole("status")).toHaveText("Salvat");

    await member.page.goto("/");
    await expect(member.page.getByRole("link", { name: "Autentificare" })).toBeVisible();
    await expect(member.page.getByTestId("gcs-header-user")).toHaveCount(0);
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
  // Sidebar-ul: doar Dashboard-ul (singurul drept); grupul Membri lipsește.
  const apps = adminPage.getByRole("navigation", { name: "Aplicații ACP" });
  await expect(apps.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(apps.getByRole("button", { name: "Membri" })).toHaveCount(0);
  expect((await adminPage.goto("/admin/members"))?.status()).toBe(404);
});
