import { expect, test, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

/**
 * ACP → Sistem → Aplicații (specul 2026-10-09-acp-navigatie-aplicatii §2): rândurile (versiunea, autorul, starea),
 * aplicațiile blocate, oprirea cu confirmare din pagină, detaliile, accesul pe grup (404 și meniul), pagina de pornire
 * (rescrierea lui `/`, canonical, `/forum`) și ordinea. Fiecare test readuce starea inițială.
 */
const APPS = "/admin/system/applications";

async function openApps(page: Page) {
  await page.goto(APPS);
  await expect(page.getByTestId("gcs-apps-list")).toBeVisible();
}

/** Adresa canonică a paginii are calea dată (Next scrie rădăcina fără „/” final). */
async function expectCanonical(page: Page, pathname: string) {
  await expect.poll(async () => new URL((await page.locator('link[rel="canonical"]').getAttribute("href")) ?? "http://x/lipsa").pathname).toBe(pathname);
}

test.afterAll(async () => {
  // Starea implicită (cu cache-ul setărilor golit), chiar dacă un test s-a oprit la jumătate.
  await resetSetting("apps.landing").catch(() => {});
  await resetSetting("apps.order").catch(() => {});
  await sql(`DELETE FROM group_settings WHERE key = 'clans.app_access'`).catch(() => {});
  await sql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`).catch(() => {});
});

test("rândurile: versiunea, autorul, starea; Nucleu și Forum sunt blocate; oprirea cere confirmare; detaliile", async ({ page, context }) => {
  await useFreshIp(context, "100.81.0");
  const id = uid();
  await enterAcpAsRoot(page, `AppsRow${id}`, `appsrow-${id}@example.com`);
  await openApps(page);

  for (const key of ["core", "forums"]) {
    const row = page.getByTestId(`gcs-app-${key}`);
    await expect(row.getByTestId("gcs-app-status")).toHaveText("Blocată");
    await expect(row.getByRole("switch")).toBeChecked();
    await expect(row.getByRole("switch")).toBeDisabled();
  }
  const chat = page.getByTestId("gcs-app-chat");
  await expect(chat).toContainText("GamingCommunitySuite");
  await expect(chat).toContainText(/v\d+\.\d+\.\d+/);
  await expect(chat.getByTestId("gcs-app-status")).toHaveText("Activă");

  // Oprirea: dialogul din pagină; „Anulează” nu schimbă nimic.
  await chat.getByRole("switch", { name: "Chat pornită" }).click();
  const dialog = page.getByRole("dialog", { name: "Oprești Chat?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Anulează" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chat.getByRole("switch", { name: "Chat pornită" })).toBeChecked();
  await expect(chat.getByTestId("gcs-app-status")).toHaveText("Activă");

  // Detaliile, din meniul „⋯”: descrierea, versiunea, ce aduce.
  await page.getByTestId("gcs-app-menu-servers").click();
  await page.getByTestId("gcs-app-details-servers").click();
  const details = page.getByRole("dialog", { name: "Servere" });
  await expect(details.getByTestId("gcs-app-details")).toContainText("Ce aduce");
  await expect(details.getByTestId("gcs-app-details")).toContainText("Hărți");
  await page.keyboard.press("Escape");

  // Secțiunile (▸), fiecare cu permisiunea ei.
  await page.getByTestId("gcs-app-expand-servers").click();
  await expect(page.getByTestId("gcs-app-section-servers-bans")).toContainText("/bans");
  await expect(page.getByTestId("gcs-app-section-servers-bans")).toContainText("toate grupurile");

  // „Verifică actualizări”: dezactivat până la licențe.
  await expect(page.getByTestId("gcs-apps-check-updates").getByRole("button")).toBeDisabled();
});

test("accesul pe grup: un membru fără acces primește 404, iar meniul ascunde aplicația", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.81.1");
  const id = uid();
  await enterAcpAsRoot(page, `AppsAcc${id}`, `appsacc-${id}@example.com`);
  const other = await browser.newContext();
  await useFreshIp(other, "100.81.2");
  const m = await other.newPage();
  await member(m, `AppsMem${id}`, `appsmem-${id}@example.com`);
  await m.goto("/");
  await expect(m.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Clanuri" })).toBeVisible();

  await openApps(page);
  const clans = page.getByTestId("gcs-app-clans");
  await clans.getByTestId("gcs-app-access-clans").click();
  const dialog = page.getByTestId("gcs-app-access-dialog");
  await expect(dialog.getByRole("checkbox", { name: /Root Admin/ })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Membru", exact: true }).uncheck();
  await dialog.getByTestId("gcs-app-access-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("gcs-apps-notice")).toContainText("Salvat");
  await expect(clans.getByTestId("gcs-app-access-clans")).toHaveAttribute("aria-label", /din \d+ grupuri/);

  await m.goto("/");
  await expect(m.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Clanuri" })).toHaveCount(0);
  expect((await m.goto("/clans"))?.status()).toBe(404);
  // Un vizitator (alt grup) vede în continuare clanurile.
  const guest = await browser.newContext();
  expect((await (await guest.newPage()).goto("/clans"))?.status()).toBe(200);
  await guest.close();

  // Înapoi la toate grupurile.
  await clans.getByTestId("gcs-app-access-clans").click();
  await dialog.getByRole("button", { name: "Toate" }).click();
  await dialog.getByTestId("gcs-app-access-save").click();
  await expect(dialog).toHaveCount(0);
  expect((await m.goto("/clans"))?.status()).toBe(200);
  await other.close();
});

test("pagina de pornire: ★ Clanuri face din / pagina clanurilor (canonical /), iar forumul rămâne pe /forum", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.81.3");
  const id = uid();
  await enterAcpAsRoot(page, `AppsHome${id}`, `appshome-${id}@example.com`);
  await openApps(page);
  await expect(page.getByTestId("gcs-apps-landing")).toHaveText("Pagina de pornire: Forum");
  await page.getByTestId("gcs-app-landing-clans").click();
  await expect(page.getByTestId("gcs-apps-notice")).toHaveText("Pagina de pornire e acum Clanuri.");
  await expect(page.getByTestId("gcs-apps-landing")).toHaveText("Pagina de pornire: Clanuri");
  await expect(page.getByTestId("gcs-app-landing-clans")).toHaveAttribute("aria-pressed", "true");

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const res = await guest.goto("/");
  expect(res?.status()).toBe(200);
  expect(new URL(guest.url()).pathname).toBe("/");
  await expect(guest.getByTestId("gcs-clans-summary").or(guest.getByTestId("gcs-clans-empty")).first()).toBeVisible();
  await expectCanonical(guest, "/");
  // Meniul: Clanuri e activ pe `/`, Forum duce la /forum.
  const nav = guest.getByRole("navigation", { name: "Principal" });
  await expect(nav.getByRole("link", { name: "Clanuri" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Forum" })).toHaveAttribute("href", "/forum");
  await guest.goto("/forum");
  await expect(guest.getByTestId("gcs-forum-index")).toBeVisible();
  await expectCanonical(guest, "/forum");
  // Pagina clanurilor își are aceeași adresă canonică (`/`).
  await guest.goto("/clans");
  await expectCanonical(guest, "/");

  // Înapoi la Forum: /forum duce pe / (o singură adresă), fără buclă.
  await openApps(page);
  await page.getByTestId("gcs-app-landing-forums").click();
  await expect(page.getByTestId("gcs-apps-notice")).toHaveText("Pagina de pornire e acum Forum.");
  await expect(page.getByTestId("gcs-apps-landing")).toHaveText("Pagina de pornire: Forum");
  await guest.goto("/forum");
  expect(new URL(guest.url()).pathname).toBe("/");
  await expect(guest.getByTestId("gcs-forum-index")).toBeVisible();
  await guestContext.close();
});

test("ordinea: butoanele sus / jos mută aplicația, iar meniul principal o urmează", async ({ page, context }) => {
  await useFreshIp(context, "100.81.4");
  const id = uid();
  await enterAcpAsRoot(page, `AppsOrd${id}`, `appsord-${id}@example.com`);
  const navOrder = async () => {
    await page.goto("/");
    const labels = await page.getByRole("navigation", { name: "Principal" }).locator("a, button").allTextContents();
    return labels.map((l) => l.trim()).filter((l) => l === "Servere" || l === "Clanuri");
  };
  expect(await navOrder()).toEqual(["Servere", "Clanuri"]);

  await openApps(page);
  const rows = () => page.getByTestId("gcs-apps-list").locator("li.gcs-appItem").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  const before = await rows();
  expect(before.indexOf("gcs-app-clans")).toBeGreaterThan(before.indexOf("gcs-app-servers"));
  await page.getByRole("button", { name: "Mută Clanuri mai sus" }).click();
  await expect(page.getByTestId("gcs-apps-notice")).toHaveText("Ordinea a fost salvată.");
  const after = await rows();
  expect(after.indexOf("gcs-app-clans")).toBe(after.indexOf("gcs-app-servers") - 1);
  expect(await navOrder()).toEqual(["Clanuri", "Servere"]);

  // Înapoi.
  await openApps(page);
  await page.getByRole("button", { name: "Mută Clanuri mai jos" }).click();
  await expect(page.getByTestId("gcs-apps-notice")).toHaveText("Ordinea a fost salvată.");
  expect(await navOrder()).toEqual(["Servere", "Clanuri"]);
});
