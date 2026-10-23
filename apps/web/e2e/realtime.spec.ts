import { expect, test } from "@playwright/test";

const LITE = process.env.GCS_EDITION === "lite";

/** Clientul realtime (specul etapei 4 §5): conexiunea se face singură, iar fără serviciu paginile merg normal. */
test("pagina principală se conectează live (websocket în VPS, SSE în Lite)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-realtime-transport", LITE ? "sse" : "websocket");
});

test("websocket blocat → transportul de rezervă (SSE)", async ({ page }) => {
  await page.route(/socket\.io/, (route) => route.abort());
  await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-realtime-transport", "sse");
});

test("SSE blocat → polling", async ({ page }) => {
  await page.route(/socket\.io|\/api\/realtime\/stream/, (route) => route.abort());
  await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-realtime-transport", "poll");
});

test("tokenul realtime: membri și vizitatori primesc un token, adresa serviciului și transporturile", async ({ request }) => {
  const res = await request.get("/api/realtime/token");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { token: string; url: string; transports: string[] };
  expect(body.token.split(".")).toHaveLength(3);
  expect(body.transports).toEqual(LITE ? ["sse", "poll"] : ["websocket", "sse", "poll"]);
});

test("fără niciun transport live, paginile merg și data-realtime = off", async ({ page }) => {
  // Nici socket-ul, nici SSE, nici polling-ul nu se pot conecta: răspunsurile sunt blocate în browser.
  await page.route(/socket\.io|\/api\/realtime\/(stream|poll)/, (route) => route.abort());
  await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "off", { timeout: 30_000 });
});
