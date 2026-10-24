import { e2eDb } from "./db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { register, useFreshIp } from "./helpers";

/**
 * Smoke test-ul chat-ului v3 (cererea de după etapa 5), pe instanța instalată: avatarul și culoarea grupului, mențiunea
 * la click pe nume, emoticoanele, clipul YouTube, imaginea încărcată și ștergerea propriului mesaj. Repetabil pe o
 * instanță persistentă (nume unice la fiecare rulare; nu schimbă setări).
 */
test.skip(!process.env.GCS_E2E_INSTALL_URL, "Rulează doar pe instanța de instalare (e2e/run.mts, build de producție).");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

async function installSql(query: string, params: unknown[] = []): Promise<void> {
  const url = new URL(process.env.GCS_E2E_INSTALL_DB_URL ?? process.env.DATABASE_URL!);
  if (!process.env.GCS_E2E_INSTALL_DB_URL) url.pathname = "/redline_e2e_install";
  const client = await e2eDb(url.toString());
  try {
    await client.query(query, params);
  } finally {
    await client.end();
  }
}

async function chatUser(browser: Browser, name: string, ip: string, group: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await register(page, name, `${name.toLowerCase()}@example.com`);
  // Înregistrarea se termină cu o redirecționare: așteptăm header-ul logat înainte de altă navigare.
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await installSql(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = $2) WHERE name = $1`, [name, group]);
  await installSql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
  await page.goto("/chat");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page;
}

const room = (page: Page) => page.getByTestId("gcs-chat-general");

test("chat v3: avatar și culoarea grupului, mențiune, emoticon, YouTube, imagine, ștergerea propriului mesaj", async ({ browser }) => {
  test.setTimeout(180_000);
  const run = Math.random().toString(36).slice(2, 7);
  const a = await chatUser(browser, `SmkVip${run}`, "198.18.94", "vip_gold");
  const b = await chatUser(browser, `SmkMem${run}`, "198.18.95", "member");

  await room(b).getByTestId("gcs-chat-input").fill(`salut ${run}`);
  await room(b).getByRole("button", { name: "Trimite" }).click();
  const fromB = room(a).getByTestId("gcs-chat-msg").filter({ hasText: `salut ${run}` });
  await expect(fromB).toBeVisible({ timeout: 10_000 });
  await expect(fromB.getByTestId("gcs-chat-avatar")).toBeVisible();
  await expect(fromB.getByTestId("gcs-chat-name")).toHaveClass(/gcs-name--member/);

  await fromB.getByTestId("gcs-chat-name").click();
  await room(a).getByRole("button", { name: "Emoticoane" }).first().click();
  await room(a).getByTestId("gcs-chat-emoji").getByRole("tab", { name: "Gaming și sport" }).click();
  await room(a).getByTestId("gcs-chat-emoji").getByRole("button", { name: "🎮" }).click();
  await room(a).getByTestId("gcs-chat-input").press("Enter");
  await expect(room(b).getByTestId("gcs-chat-msg").filter({ hasText: `@SmkMem${run} 🎮` })).toBeVisible({ timeout: 10_000 });
  await a.waitForTimeout(1_200);

  await room(a).getByTestId("gcs-chat-input").fill(`clip ${run} https://youtu.be/dQw4w9WgXcQ`);
  await room(a).getByTestId("gcs-chat-input").press("Enter");
  await expect(room(b).getByTestId("gcs-chat-msg").filter({ hasText: `clip ${run}` }).getByTestId("gcs-chat-youtube")).toBeVisible({ timeout: 10_000 });
  await a.waitForTimeout(1_200);

  await room(a).getByTestId("gcs-chat-file").setInputFiles({ name: "smoke.png", mimeType: "image/png", buffer: PNG });
  await expect(room(a).getByRole("list", { name: "Imagini atașate" }).getByRole("img")).toBeVisible();
  await room(a).getByTestId("gcs-chat-input").fill(`poza ${run}`);
  await room(a).getByRole("button", { name: "Trimite" }).click();
  const withImage = room(b).getByTestId("gcs-chat-msg").filter({ hasText: `poza ${run}` });
  await expect(withImage.locator('img[src^="/files/"]')).toBeVisible({ timeout: 10_000 });

  // Curățenie: autorul își șterge mesajele de test.
  for (const text of [`poza ${run}`, `clip ${run}`, `@SmkMem${run}`]) {
    const own = room(a).getByTestId("gcs-chat-msg").filter({ hasText: text });
    await own.getByTestId("gcs-chat-more").click();
    await a.getByTestId("gcs-chatpro-delete").click();
    await expect(room(b).getByTestId("gcs-chat-msg").filter({ hasText: text })).toHaveCount(0, { timeout: 10_000 });
  }
  const last = room(b).getByTestId("gcs-chat-msg").filter({ hasText: `salut ${run}` });
  await last.getByTestId("gcs-chat-more").click();
  await b.getByTestId("gcs-chatpro-delete").click();
  for (const p of [a, b]) await p.context().close();
});
