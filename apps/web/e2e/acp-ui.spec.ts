import { expect, test } from "@playwright/test";
import { forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Paginile ACP din etapa 5: aplicațiile, permisiunile individuale, limbile active și ordinea câmpurilor din postbit.
 * Fiecare test readuce setările la starea inițială.
 */
test("dezactivarea aplicației Chat ascunde meniul și shoutbox-ul, iar /chat dă 404", async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  await useFreshIp(context, "100.72.0");
  const id = uid();
  await enterAcpAsRoot(page, `AppAdm${id}`, `appadm-${id}@example.com`);
  // ACP → Aplicații: comutatorul se aplică imediat; oprirea cere confirmare (dialogul din pagină).
  const app = async (enabled: boolean) => {
    await page.goto("/admin/system/applications");
    const row = page.getByTestId("gcs-app-chat");
    await row.getByRole("switch", { name: "Chat pornită" }).click();
    if (!enabled) await page.getByTestId("gcs-app-confirm-ok").click();
    await expect(row.getByTestId("gcs-app-status")).toHaveText(enabled ? "Activă" : "Oprită");
    await expect(page.getByTestId("gcs-apps-notice")).toHaveText(enabled ? "Chat a fost pornită." : "Chat a fost oprită.");
  };

  await app(false);
  const other = await browser.newContext();
  await useFreshIp(other, "100.72.1");
  const m = await other.newPage();
  await member(m, `AppMem${id}`, `appmem-${id}@example.com`);
  await m.goto("/");
  await expect(m.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Chat" })).toHaveCount(0);
  await expect(m.getByTestId("gcs-shoutbox")).toHaveCount(0);
  expect((await m.goto("/chat"))?.status()).toBe(404);

  await app(true);
  await m.goto("/");
  await expect(m.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Chat" })).toBeVisible();
  await other.close();
});

test("o permisiune individuală din fișa membrului îi permite să creeze o cameră privată", async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  await useFreshIp(context, "100.72.2");
  const id = uid();
  await enterAcpAsRoot(page, `PermAdm${id}`, `permadm-${id}@example.com`);

  const other = await browser.newContext();
  await useFreshIp(other, "100.72.3");
  const m = await other.newPage();
  await member(m, `PermMem${id}`, `permmem-${id}@example.com`);
  await m.goto("/chat");
  await expect(m.getByTestId("gcs-chat-create")).toHaveCount(0);

  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`permmem-${id}@example.com`]);
  await page.goto(`/admin/members/${row!.id}?tab=permissions`);
  const perms = page.getByTestId("gcs-member-permissions");
  await perms.locator('select[name="perm:chat.create_private"]').selectOption("true");
  await page.getByRole("button", { name: "Salvează permisiunile" }).click();
  await expect(page.getByRole("status").filter({ hasText: /salvat/i }).first()).toBeVisible();

  await m.reload();
  await expect(m.getByTestId("gcs-chat-create")).toBeVisible();
  await other.close();
});

test("limbile active din ACP apar în selectorul de limbă", async ({ page, context }) => {
  await useFreshIp(context, "100.72.4");
  const id = uid();
  await enterAcpAsRoot(page, `LangAdm${id}`, `langadm-${id}@example.com`);
  await page.goto("/admin/settings/languages");
  const locales = page.getByTestId("gcs-acp-locales");
  await locales.getByLabel("Русский").uncheck();
  await page.getByRole("button", { name: "Salvează limbile" }).click();
  await expect(page.getByRole("status").first()).toBeVisible();

  await page.goto("/settings/language");
  await expect(page.getByRole("button", { name: "Română" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Русский" })).toHaveCount(0);

  await page.goto("/admin/settings/languages");
  await page.getByTestId("gcs-acp-locales").getByLabel("Русский").check();
  await page.getByRole("button", { name: "Salvează limbile" }).click();
  await expect(page.getByRole("status").first()).toBeVisible();
});

test("postbit-ul urmează ordinea câmpurilor din ACP", async ({ page, context, request }) => {
  test.setTimeout(90_000);
  await useFreshIp(context, "100.72.5");
  const id = uid();
  const field = (key: string, label: string) => request.post("/api/_test/forum", { data: { action: "profileField", key, label } }).then((r) => r.json() as Promise<{ id: number }>);
  const a = await field(`ord_a_${id}`, `Alfa ${id}`);
  const b = await field(`ord_b_${id}`, `Beta ${id}`);
  const t = await forumTree(request);

  await enterAcpAsRoot(page, `OrdAdm${id}`, `ordadm-${id}@example.com`);
  const [admin] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`ordadm-${id}@example.com`]);
  for (const [fieldId, value] of [[a.id, "unu"], [b.id, "doi"]] as const) {
    await sql(`INSERT INTO profile_field_values ("userId", "fieldId", value) VALUES ($1, $2, $3)`, [admin!.id, fieldId, value]);
  }
  const topic = await topicWithReplies(request, t.forum.id, `ordadm-${id}@example.com`, `Ordine ${id}`);

  // Beta înaintea lui Alfa: fila „Ordinea în postare”, săgeata lui Beta (lista se poate și trage), apoi „Salvează ordinea”.
  await page.goto("/admin/members/settings/profiles?tab=postbit");
  const card = page.getByTestId("gcs-acp-postbit");
  const keys = () => card.getByTestId("gcs-acp-postbit-row").evaluateAll((els, suffix) => els.map((e) => e.getAttribute("data-key")).filter((k) => k?.endsWith(suffix)), `_${id}`);
  await expect.poll(keys).toEqual([`ord_a_${id}`, `ord_b_${id}`]);
  const beta = card.locator(`[data-testid="gcs-acp-postbit-row"][data-key="ord_b_${id}"]`);
  for (let i = 0; i < 5 && (await keys())[0] !== `ord_b_${id}`; i++) await beta.getByTestId("gcs-acp-sort-up").click();
  expect(await keys()).toEqual([`ord_b_${id}`, `ord_a_${id}`]);
  await card.getByRole("button", { name: "Salvează ordinea" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  await page.reload();
  await expect.poll(keys).toEqual([`ord_b_${id}`, `ord_a_${id}`]);

  await page.goto(topic.url);
  const order = await page
    .getByTestId("gcs-post")
    .first()
    .getByTestId("gcs-postbit-fields")
    .locator("[data-field]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-field")).filter((k) => k?.startsWith("ord_")));
  expect(order).toEqual([`ord_b_${id}`, `ord_a_${id}`]);
});
