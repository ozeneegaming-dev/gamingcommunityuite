import { expect, test, type Page } from "@playwright/test";
import { fixture, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, setSetting, useFreshIp } from "./helpers";

/**
 * Tema implicită „GCS Nova” (specul 2026-10-10-tema-nova): designul pe paginile site-ului (nu în ACP), antetul cu
 * rândul breadcrumb + căutare, subsolul configurabil din ACP (cu mențiunea produsului protejată), plăcile de moderare.
 * Cu `GCS_SHOTS_DIR`, salvează și capturi (întunecat / luminos, desktop / 375 px) ale paginilor principale.
 */

/** Breadcrumb-ul din rândul antetului (în timpul hidratării poate exista o copie ascunsă). */
const trail = (page: Page) => page.getByTestId("gcs-crumb-trail").filter({ visible: true }).first();

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.GCS_SHOTS_DIR;
  if (!dir) return;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test("Nova: designul pe site (nu în ACP), antetul, subsolul din ACP și plăcile de moderare", async ({ page, context, request }) => {
  test.setTimeout(300_000);
  await useFreshIp(context, "100.88.7");
  const id = uid();
  const email = `nova-${id}@example.com`;
  // Prima vizită compilează paginile (în modul `next dev`); înregistrarea așteaptă apoi doar serverul.
  await page.goto("/");
  await page.goto("/register");
  await enterAcpAsRoot(page, `Nova${id}`, email);

  await test.step("designul Nova e pe site, nu și în ACP", async () => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/gcs-nova/);
    await expect(trail(page)).toBeVisible();
    await expect(trail(page)).toContainText("Acasă");
    await expect(page.getByTestId("gcs-crumb-search")).toBeVisible();
    await page.getByRole("link", { name: "Activitate", exact: true }).first().click();
    await expect(trail(page)).toContainText("Activitate");
    await page.goto("/admin");
    await expect(page.locator("html")).not.toHaveClass(/gcs-nova/);
  });

  await test.step("subsolul implicit: „Despre” cu numele site-ului, coloanele aplicațiilor, mențiunea produsului", async () => {
    await page.goto("/");
    const footer = page.getByTestId("gcs-site-footer");
    await expect(footer.getByTestId("gcs-footer-about-text")).toContainText("este casa gamerilor noștri");
    await expect(footer.getByTestId("gcs-footer-column")).toHaveCount(3);
    await expect(footer.getByTestId("gcs-footer-column").first()).toContainText("Descoperă comunitatea");
    await expect(footer.locator(".gcs-siteFooter__powered")).toBeVisible();
    await expect(footer.locator(".gcs-siteFooter__powered")).toContainText("Powered by GamingCommunitySuite");
    await expect(footer.getByTestId("gcs-footer-social")).toHaveCount(0);
  });

  await test.step("ACP → Aspect → Subsol: textul, o coloană, rețelele sociale; revenirea cere confirmare în pagină", async () => {
    await setSetting("social.discord", "https://discord.gg/gcs-e2e");
    await page.goto("/admin/appearance/footer");
    await expect(page.getByTestId("gcs-footer-defaults")).toBeVisible();
    await page.getByTestId("gcs-footer-about-title").fill("Despre noi");
    await page.getByTestId("gcs-footer-about-text-input").fill(`Comunitatea **Nova ${id}** te așteaptă.`);
    await page.getByTestId("gcs-footer-column-remove").last().click();
    await expect(page.getByTestId("gcs-footer-editor-column")).toHaveCount(2);
    await page.getByTestId("gcs-footer-save").click();
    await expect(page.getByTestId("gcs-footer-defaults")).toHaveCount(0);

    await page.goto("/");
    const footer = page.getByTestId("gcs-site-footer");
    await expect(footer.getByTestId("gcs-footer-about-text")).toContainText(`Nova ${id}`);
    await expect(footer.locator(".gcs-siteFooter__hl")).toHaveText(`Nova ${id}`);
    await expect(footer.getByTestId("gcs-footer-column")).toHaveCount(2);
    await expect(footer.getByTestId("gcs-footer-social").locator('a[data-network="discord"]')).toHaveAttribute("href", "https://discord.gg/gcs-e2e");
    await shot(page, "footer-dark-desktop");

    await page.goto("/admin/appearance/footer");
    await page.getByTestId("gcs-footer-reset").click();
    const dialog = page.getByRole("dialog", { name: "Revii la subsolul implicit?" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("gcs-footer-reset-confirm").click();
    await expect(page.getByTestId("gcs-footer-defaults")).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("gcs-site-footer").getByTestId("gcs-footer-column")).toHaveCount(3);
    await resetSetting("social.discord");
  });

  await test.step("moderarea topicului: plăci colorate; ștergerea cere confirmare în pagină", async () => {
    const category = await fixture<{ id: number }>(request, { action: "forum", parentId: null, type: "CATEGORY", name: `Nova ${id}` });
    const forum = await fixture<{ id: number }>(request, { action: "forum", parentId: category.id, type: "FORUM", name: `Forum Nova ${id}` });
    const topic = await topicWithReplies(request, forum.id, email, `Topic Nova ${id}`, 1);
    await page.goto(topic.url);
    await page.getByText("Unelte de moderare").click();
    const tiles = page.locator(".gcs-modTiles .gcs-modTile");
    await expect(tiles.first()).toBeVisible();
    await expect(page.locator('.gcs-modTile[data-tone="feature"]')).toBeVisible();
    await expect(page.locator('.gcs-modTile[data-tone="delete"]')).toBeVisible();
    await page.locator('.gcs-modTile[data-tone="delete"]').click();
    const dialog = page.getByRole("dialog", { name: "Șterge topicul" });
    await expect(dialog).toBeVisible();
    // Butonul din dialog (cel din antet, „închide”, are același nume).
    await dialog.getByRole("button", { name: "Anulează" }).last().click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: `Topic Nova ${id}`, level: 1 })).toBeVisible();
    await shot(page, "topic-dark-desktop");
  });
});
