import { expect, test } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("un câmp nou „Discord tag” (doar membri) apare în setări și pe profil doar pentru membri; un câmp obligatoriu blochează salvarea", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootField${id}`, `root-field-${id}@example.com`);
  await page.goto("/admin/members/settings/profiles");
  const form = page.locator("section", { has: page.locator("#gcs-field-new") });
  await form.getByLabel("Cheie").fill(`dc_${id}`);
  await form.getByLabel("Etichetă").fill(`Discord tag ${id}`);
  await form.getByLabel("Tab").selectOption("GAMES");
  await form.getByLabel("Cine îl vede").selectOption("MEMBERS");
  await form.getByRole("button", { name: "Câmp nou" }).click();
  const card = page.getByTestId("gcs-acp-profile-field").filter({ has: page.locator(`input[value="dc_${id}"]`) });
  await expect(card).toBeVisible();

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
  await card.getByLabel("Obligatoriu").check();
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  await mara.goto("/settings/profile");
  await mara.getByLabel(`Discord tag ${id} *`).fill("");
  await mara.getByLabel(`Discord tag ${id} *`).evaluate((el) => el.removeAttribute("required"));
  await mara.getByRole("button", { name: "Salvează" }).click();
  await expect(mara.getByTestId("gcs-settings-status")).toHaveText("Câmp obligatoriu");

  // Curățenie: câmpul obligatoriu nu trebuie să afecteze alte teste.
  await card.getByRole("button", { name: "Șterge" }).click();
  await page.getByTestId("gcs-confirm-ok").click();
  await expect(card).toHaveCount(0);
  await mara.close();
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
