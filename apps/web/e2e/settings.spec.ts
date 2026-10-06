import { expect, test, type APIRequestContext } from "@playwright/test";
import { forumTree, member, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("câmpul Țară și accentul ales apar pe profil", async ({ page }) => {
  const id = uid();
  await member(page, `Mara${id}`, `mara-${id}@example.com`);
  await page.goto("/settings/profile");
  await page.getByLabel("Țară").fill("România");
  await page.getByLabel("Descriere scurtă").fill("Nu există lag, doar skill issue.");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

  await page.goto("/settings/appearance");
  await expect(page.getByTestId("gcs-no-cosmetics")).toBeVisible();
  await expect(page.getByTestId("gcs-frame-options")).toHaveCount(0);
  await page.getByRole("button", { name: "#3DDC97" }).click();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-profile").click();
  await expect(page.locator(".gcs-profileField", { hasText: "Țară" })).toContainText("România");
  await expect(page.getByText("„Nu există lag, doar skill issue.”")).toBeVisible();
  expect(await page.getByTestId("gcs-profile-cover").getAttribute("style")).toContain("rgba(61, 220, 151");
});

test("un VIP Gold vede Fire și Gold (nu Neon); rama aleasă apare pe topic", async ({ page, request }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  await member(page, `Shadow${id}`, `shadow-${id}@example.com`);
  await profileFixture(request, { action: "vip", email: `shadow-${id}@example.com`, groupKey: "vip_gold", days: 30 });
  const topic = await topicWithReplies(request, forum.id, `shadow-${id}@example.com`, `Ramă ${id}`);

  await page.goto("/settings/appearance");
  const frames = page.getByTestId("gcs-frame-options");
  await expect(frames.getByText("Fire")).toBeVisible();
  await expect(frames.getByText("Gold")).toBeVisible();
  await expect(frames.getByText("Neon")).toHaveCount(0);
  await frames.locator("label", { hasText: "Gold" }).click();
  await expect(page.getByTestId("gcs-appearance-preview").locator(".gcs-avatarFrame--gold")).toBeVisible();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

  await page.goto(topic.url);
  await expect(page.getByTestId("gcs-post").first().locator(".gcs-avatarFrame--gold")).toBeVisible();
});

test("mesajele „Nimeni”: butonul Mesaj dispare de pe profil pentru ceilalți", async ({ page, browser }) => {
  const id = uid();
  const other = await memberInNewContext(browser, `Other${id}`, `other-${id}@example.com`, "198.51.100");
  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`other-${id}@example.com`]);
  await member(page, `Mara${id}`, `mara-${id}@example.com`);
  await page.goto(`/members/${row!.id}`);
  await expect(page.getByTestId("gcs-profile-message")).toBeVisible();

  await other.goto("/settings/privacy");
  await other.getByLabel("Cine îmi poate scrie mesaje private").selectOption("NOBODY");
  await other.getByRole("button", { name: "Salvează" }).click();
  await expect(other.getByTestId("gcs-settings-status")).toHaveText("Salvat.");
  await other.close();

  await page.reload();
  await expect(page.getByTestId("gcs-profile-message")).toHaveCount(0);
});

test("un cont Steam fără email vede bannerul; după confirmarea emailului bannerul dispare", async ({ page, request }) => {
  const id = uid();
  await member(page, `Steam${id}`, `steam-${id}@example.com`);
  await sql(`UPDATE users SET email = $2 WHERE email = $1`, [`steam-${id}@example.com`, `7656119${Date.now()}@steam.invalid`]);
  await page.goto("/");
  await expect(page.getByTestId("gcs-steam-email-banner")).toBeVisible();

  await page.getByTestId("gcs-steam-email-banner").getByRole("link").click();
  await page.getByLabel("Adresa nouă").fill(`real-${id}@example.com`);
  await page.getByRole("button", { name: "Trimite linkul de confirmare" }).click();
  await expect(page.getByTestId("gcs-settings-status").first()).toHaveText("Ți-am trimis un link de confirmare pe adresa nouă.");

  const mails = await profileFixture<{ to: string; html: string }[]>(request, { action: "outbox" });
  const mail = mails.find((m) => m.to === `real-${id}@example.com`)!;
  const link = /href="([^"]+)"/.exec(mail.html)![1]!.replace(/&#38;/g, "&");
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByTestId("gcs-email-changed")).toBeVisible();
  await expect(page.getByTestId("gcs-steam-email-banner")).toHaveCount(0);
});
