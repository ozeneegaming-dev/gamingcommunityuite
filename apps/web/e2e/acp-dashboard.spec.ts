import { expect, test } from "@playwright/test";
import { enterAcpAsRoot, register, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

const widgetOrder = (page: import("@playwright/test").Page, column: "main" | "side") =>
  page.getByTestId(`gcs-acp-column-${column}`).locator("section[data-widget]").evaluateAll((els) => els.map((e) => e.getAttribute("data-widget")));

test("Root Admin cu 2FA intră pe /admin și vede widgetul „Înregistrări noi”", async ({ page }) => {
  await enterAcpAsRoot(page, "RootA", "root-a@example.com");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Înregistrări noi" })).toBeVisible();
  await expect(page.getByTestId("gcs-acp-user")).toHaveText("RootA");
  // Meniul: aplicațiile Sistem și Membri, cu submeniul aplicației curente.
  await expect(page.getByRole("navigation", { name: "Aplicații ACP" }).getByRole("link", { name: "Membri" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Meniu Sistem" }).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("widgetul „Notițe admin” se mută din tastatură, iar ordinea rămâne după reîncărcare", async ({ page }) => {
  await enterAcpAsRoot(page, "RootB", "root-b@example.com");
  expect(await widgetOrder(page, "side")).toEqual(["moderation_queue", "admin_notes", "online_users", "online_admins", "failed_acp_logins"]);

  const handle = page.getByRole("button", { name: "Mută widgetul Notițe admin" });
  await handle.focus();
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/admin"));
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await saved;
  expect(await widgetOrder(page, "side")).toEqual(["moderation_queue", "online_users", "admin_notes", "online_admins", "failed_acp_logins"]);

  await page.reload();
  expect(await widgetOrder(page, "side")).toEqual(["moderation_queue", "online_users", "admin_notes", "online_admins", "failed_acp_logins"]);
});

test("o notiță salvată rămâne după reîncărcare", async ({ page }) => {
  await enterAcpAsRoot(page, "RootC", "root-c@example.com");
  const notes = page.getByRole("region", { name: "Notițe admin" });
  await notes.getByRole("textbox", { name: "Notițe admin" }).fill("Turneu CS2 sâmbătă: verificăm bracket-ul vineri");
  await notes.getByRole("button", { name: "Salvează" }).click();
  await expect(notes.getByRole("status")).toHaveText("Salvat");

  await page.reload();
  await expect(page.getByRole("region", { name: "Notițe admin" }).getByRole("textbox", { name: "Notițe admin" })).toHaveValue(
    "Turneu CS2 sâmbătă: verificăm bracket-ul vineri",
  );
  await expect(page.getByRole("region", { name: "Notițe admin" }).getByRole("status")).toContainText("RootC");
});

test("căutarea din header găsește setarea SMTP", async ({ page }) => {
  await enterAcpAsRoot(page, "RootD", "root-d@example.com");
  await page.getByLabel("Căutare în ACP").fill("smtp");
  await expect(page.getByRole("option", { name: "Server SMTP" })).toBeVisible();
});

test("un Membru care deschide /admin primește 404", async ({ page }) => {
  await register(page, "Membru1", "membru1@example.com");
  await expect(page.getByTestId("gcs-header-user")).toHaveText("Membru1");
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  const csv = await page.request.get("/admin/registrations.csv");
  expect(csv.status()).toBe(404);
});

test("un vizitator care deschide /admin primește 404", async ({ page }) => {
  const res = await page.goto("/admin/members");
  expect(res?.status()).toBe(404);
});

test("worker-ul pornit: /api/health raportează `worker: up`, iar dashboard-ul nu arată bannerul", async ({ page, request }) => {
  // Worker-ul pornește odată cu serverul (e2e/run.mts) și scrie primul heartbeat imediat.
  await expect
    .poll(async () => ((await (await request.get("/api/health")).json()) as { worker?: string }).worker, { timeout: 60_000 })
    .toBe("up");
  await enterAcpAsRoot(page, "RootW", "root-w@example.com");
  await expect(page.getByTestId("gcs-health-worker")).toContainText("funcționează");
  await expect(page.getByTestId("gcs-banner-worker")).toHaveCount(0);
});

test("gcs-realtime pornit: /api/health raportează `realtime: up`", async ({ request }) => {
  await expect
    .poll(async () => ((await (await request.get("/api/health")).json()) as { realtime?: string }).realtime, { timeout: 60_000 })
    .toBe("up");
});
