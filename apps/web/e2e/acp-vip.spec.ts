import { expect, test, type APIRequestContext } from "@playwright/test";
import { memberInNewContext, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("o ramă nouă „Ice” pentru VIP Silver apare în setările unui VIP Silver", async ({ page, request, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootFrame${id}`, `root-frame-${id}@example.com`);
  await page.goto("/admin/vip/frames");
  const form = page.locator("section", { has: page.locator("#gcs-frame-new") });
  await form.getByLabel("Cheie").fill(`ice_${id}`);
  await form.getByLabel("Nume").fill(`Ice ${id}`);
  await form.getByLabel("Culori (2–6, separate prin virgulă)").fill("#6FB6FF, #D8F3FF, #22D3EE");
  await form.getByRole("checkbox", { name: "VIP Silver" }).check();
  await form.getByRole("button", { name: "Ramă nouă" }).click();
  await expect(page.getByTestId("gcs-acp-frame").filter({ has: page.locator(`input[value="ice_${id}"]`) })).toBeVisible();
  expect(await (await request.get("/gcs-names.css")).text()).toContain(`.gcs-avatarFrame--ice_${id}::before{background:conic-gradient(#6FB6FF,#D8F3FF,#22D3EE,#6FB6FF)`);

  const silver = await memberInNewContext(browser, `Silver${id}`, `silver-${id}@example.com`, "198.51.100");
  await profileFixture(request, { action: "vip", email: `silver-${id}@example.com`, groupKey: "vip_silver", days: 30 });
  await silver.goto("/settings/appearance");
  await expect(silver.getByTestId("gcs-frame-options").getByText(`Ice ${id}`)).toBeVisible();
  await silver.close();
});

test("editarea gradientului unui stil de nume ajunge în CSS-ul generat în ≤ 2 s", async ({ page, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootStyle${id}`, `root-style-${id}@example.com`);
  await page.goto("/admin/vip/name-styles");
  const ice = page.getByTestId("gcs-acp-name-style").filter({ hasText: "gcs-name--ns_ice" });
  await ice.locator('input[type="color"]').nth(1).fill("#123456");
  await ice.getByRole("button", { name: "Salvează stilul" }).click();
  await expect(ice.getByRole("status")).toBeVisible();
  await expect
    .poll(async () => (await (await request.get("/gcs-names.css")).text()).includes("#123456"), { timeout: 2000, intervals: [200] })
    .toBe(true);
});

test("un abonat care expiră în 2 zile apare în widget; „Retrage” din lista de abonați scrie în istoric", async ({ page, request, browser }) => {
  const id = uid();
  const soon = await memberInNewContext(browser, `Soon${id}`, `soon-${id}@example.com`, "198.51.100");
  await soon.close();
  await profileFixture(request, { action: "vip", email: `soon-${id}@example.com`, groupKey: "vip_bronze", days: 2 });

  await enterAcpAsRoot(page, `RootSubs${id}`, `root-subs-${id}@example.com`);
  await expect(page.getByTestId("gcs-widget-vip-expiring")).toContainText(`Soon${id}`);

  await page.goto("/admin/vip/subscribers?expiring=1");
  const row = page.getByTestId("gcs-acp-vip-subscriber").filter({ hasText: `Soon${id}` });
  page.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "Retrage" }).click();
  await expect(row).toHaveCount(0);

  await page.goto("/admin/vip/history");
  await expect(page.getByTestId("gcs-acp-vip-log").filter({ hasText: `Soon${id}` }).first()).toContainText("Retras");
});
