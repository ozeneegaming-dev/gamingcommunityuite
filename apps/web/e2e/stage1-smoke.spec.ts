import { expect, test } from "@playwright/test";
import { login, PASSWORD, register, totp, useFreshIp } from "./helpers";

/**
 * Smoke test-ul etapei 1, pe instanța proaspătă instalată de `install.spec.ts` (proiectul „smoke” depinde de
 * „install”): 2FA → grup „VIP Test” cu gradient → atribuit unui membru → numele stilizat apare pe profil
 * în ≤ 2 s → ban → membrul e delogat → toate cele 4 acțiuni apar în jurnal.
 */
test.skip(!process.env.GCS_E2E_INSTALL_URL, "Rulează doar pe instanța de instalare (e2e/run.mts, build de producție).");

test("etapa 1: instalare → 2FA → grup VIP cu gradient → membru → ban → jurnal", async ({ page, browser, context }) => {
  await useFreshIp(context, "198.18.10");

  await test.step("Root Admin-ul creat de wizard se loghează și activează 2FA", async () => {
    await page.goto("/login");
    await login(page, "fondator@example.com");
    await expect(page.getByTestId("gcs-header-user")).toHaveText("Fondator");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/2fa-setup$/);
    await page.getByLabel("Parola contului").fill(PASSWORD);
    await page.getByRole("button", { name: "Continuă" }).click();
    const secret = (await page.getByTestId("gcs-totp-secret").textContent())?.trim() ?? "";
    await page.getByLabel("Codul din aplicație").fill(totp(secret));
    await page.getByRole("button", { name: "Activează 2FA" }).click();
    await expect(page).toHaveURL(/\/admin\/reauth$/);
    await page.getByLabel("Parolă").fill(PASSWORD);
    await page.getByLabel("Cod 2FA").fill(totp(secret));
    await page.getByRole("button", { name: "Intră în ACP" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });

  // Membrul: alt browser (alt context), cu propriul IP.
  const memberContext = await browser.newContext();
  await useFreshIp(memberContext, "198.18.11");
  const member = await memberContext.newPage();
  await register(member, "Jucator1", "jucator1@example.com");
  await expect(member.getByTestId("gcs-header-user")).toHaveText("Jucator1");

  let groupUrl = "";
  await test.step("grupul „VIP Test” cu nume în gradient", async () => {
    await page.goto("/admin/groups");
    // „Grup nou” din antet: dialogul cu numele, apoi direct pagina grupului.
    await page.getByTestId("gcs-group-new").click();
    const create = page.getByRole("dialog", { name: "Grup nou" });
    await create.getByLabel("Numele grupului").fill("VIP Test");
    await create.getByRole("button", { name: "Creează grupul" }).click();
    await expect(page).toHaveURL(/\/admin\/groups\/\d+$/);
    await expect(page.getByRole("heading", { name: "VIP Test", level: 1 })).toBeVisible();
    // Înapoi în listă, grupul are rândul lui cu „Editează”.
    await page.goto("/admin/groups");
    await page.getByRole("link", { name: "Editează: VIP Test" }).click();
    await expect(page.getByRole("heading", { name: "VIP Test", level: 1 })).toBeVisible();
    groupUrl = page.url();
    const style = page.getByRole("region", { name: "Stilul numelui" });
    await style.getByRole("checkbox", { name: "Gradient" }).check();
    await style.getByRole("button", { name: "Salvează stilul" }).click();
    await expect(style.getByRole("status")).toHaveText("Salvat");
  });

  await test.step("atribuit membrului: numele stilizat apare pe profil în ≤ 2 s", async () => {
    await page.goto("/admin/members?q=Jucator1");
    await page.getByRole("link", { name: "Jucator1" }).click();
    const memberUrl = page.url();
    const memberId = memberUrl.split("/").pop()!;
    await member.goto(`/members/${memberId}`);
    await expect(member.getByTestId("gcs-profile-name")).toBeVisible();

    // Grupurile se schimbă din popupul „Grupuri” al barei de acțiuni; după salvare popupul se închide.
    await page.getByTestId("gcs-member-act-groups").click();
    const groups = page.getByTestId("gcs-member-modal-groups");
    await groups.getByTestId("gcs-member-primary-group").selectOption({ label: "VIP Test" });
    await groups.getByRole("button", { name: "Salvează grupul principal" }).click();
    await expect(groups).toHaveCount(0);

    const started = Date.now();
    await member.reload();
    await expect
      .poll(() => member.getByTestId("gcs-profile-name").evaluate((el) => getComputedStyle(el).backgroundImage), { timeout: 2000 })
      .toContain("linear-gradient");
    expect(Date.now() - started).toBeLessThanOrEqual(2000);
    expect(groupUrl).toContain("/admin/groups/");
  });

  await test.step("banarea membrului îl deloghează", async () => {
    const ban = page.getByRole("region", { name: "Ban" });
    await ban.getByLabel("Motiv").fill("test smoke");
    await ban.getByRole("button", { name: "Banează" }).click();
    await expect(ban.getByRole("status")).toHaveText("Salvat");
    await member.goto("/");
    await expect(member.getByRole("link", { name: "Autentificare" })).toBeVisible();
    await expect(member.getByTestId("gcs-header-user")).toHaveCount(0);
  });

  await test.step("jurnalul conține toate cele 4 acțiuni", async () => {
    await page.goto("/admin/logs");
    for (const action of ["group.create", "group.update", "user.primary_group", "user.ban"]) {
      await expect(page.locator(`details[data-action="${action}"]`).first()).toBeAttached();
    }
  });

  await memberContext.close();
});
