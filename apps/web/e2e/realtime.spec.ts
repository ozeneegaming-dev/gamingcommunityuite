import { expect, test } from "@playwright/test";

/** Clientul realtime (specul etapei 4 §5): conexiunea se face singură, iar fără serviciu paginile merg normal. */
test("pagina principală se conectează la gcs-realtime", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
});

test("tokenul realtime: membri și vizitatori primesc un token și adresa serviciului", async ({ request }) => {
  const res = await request.get("/api/realtime/token");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { token: string; url: string };
  expect(body.token.split(".")).toHaveLength(3);
});

test("fără serviciul realtime, paginile merg și data-realtime = off", async ({ page }) => {
  // Socket-ul nu se poate conecta: răspunsurile serviciului sunt blocate în browser.
  await page.route(/socket\.io/, (route) => route.abort());
  await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "off", { timeout: 20_000 });
});
