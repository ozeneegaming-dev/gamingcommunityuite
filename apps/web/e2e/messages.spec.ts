import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { member, memberInNewContext, typeInEditor, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

async function idOf(email: string): Promise<string> {
  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  return row!.id;
}

/** Adaugă un destinatar în câmpul cu sugestii (scrie numele, eventual cu `@` în față, și alege sugestia). */
async function pick(page: Page, name: string, typed = name): Promise<void> {
  await page.locator("#gcs-pick-user").fill(typed);
  await page.getByRole("option").getByRole("button", { name }).click();
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("A scrie lui B și C; B citește și răspunde; C pleacă; A îl invită pe D; B îl ignoră pe A", async ({ page, browser, request }) => {
  const id = uid();
  const b = await memberInNewContext(browser, `Bogdan${id}`, `b-${id}@example.com`, "198.51.100");
  const c = await memberInNewContext(browser, `Cristi${id}`, `c-${id}@example.com`, "192.0.2");
  const d = await memberInNewContext(browser, `Dana${id}`, `d-${id}@example.com`, "198.18.0");
  await member(page, `Ana${id}`, `a-${id}@example.com`);

  // A → B (din profil: destinatarul precompletat) + C (din sugestii).
  await page.goto(`/messages/new?to=${await idOf(`b-${id}@example.com`)}`);
  await expect(page.getByTestId("gcs-recipient")).toHaveText([`Bogdan${id}`]);
  // Ca o mențiune: cu `@` în față.
  await pick(page, `Cristi${id}`, `@Cristi${id}`);
  await page.getByLabel("Titlu").fill(`Echipa ${id}`);
  await typeInEditor(page, "Intrați la turneu?", page.locator("form"));
  await page.getByRole("button", { name: "Trimite" }).click();
  await expect(page.getByTestId("gcs-conversation-title")).toHaveText(`Echipa ${id}`);
  const url = page.url();

  // B vede conversația necitită, o deschide; A vede „Citit de B”.
  await b.goto("/");
  await expect(b.getByTestId("gcs-header-unread")).toHaveText("1");
  // Mesajele din antet: panoul cu ultimele conversații, apoi „Toate mesajele”.
  await b.getByTestId("gcs-header-messages").click();
  await expect(b.getByTestId("gcs-messages-panel").getByTestId("gcs-messages-item")).toHaveCount(1);
  await b.keyboard.press("Escape");
  await b.goto("/messages");
  await b.getByTestId("gcs-inbox-item").getByRole("link", { name: `Echipa ${id}` }).click();
  await expect(b.getByTestId("gcs-message")).toHaveCount(1);
  await expect(b.getByTestId("gcs-header-unread")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("gcs-read-by")).toHaveText(`Citit de Bogdan${id}`);

  await typeInEditor(b, "Sunt în!", b.locator(".gcs-replyBox"));
  await b.getByRole("button", { name: "Trimite" }).click();
  await expect(b.getByTestId("gcs-message")).toHaveCount(2);

  // C părăsește conversația și nu o mai poate deschide.
  await c.goto(url);
  c.once("dialog", (dialog) => void dialog.accept());
  await c.getByTestId("gcs-conversation-leave").click();
  await expect(c).toHaveURL(/\/messages$/);
  expect((await c.goto(url))?.status()).toBe(404);

  // A îl invită pe D, care vede istoricul.
  await page.goto(url);
  await pick(page, `Dana${id}`);
  await page.getByRole("button", { name: "Invită", exact: true }).click();
  await expect(page.getByTestId("gcs-participants")).toContainText(`Dana${id}`);
  await d.goto(url);
  await expect(d.getByTestId("gcs-message")).toHaveCount(2);

  // B îl ignoră pe A (la mesaje): o conversație nouă A → B e refuzată, cu mesajul tradus.
  await profileFixture(request, { action: "ignore", email: `b-${id}@example.com`, ignoredEmail: `a-${id}@example.com`, posts: false, messages: true });
  await page.goto(`/messages/new?to=${await idOf(`b-${id}@example.com`)}`);
  await page.getByLabel("Titlu").fill("Iar eu");
  await typeInEditor(page, "Salut din nou", page.locator("form"));
  await page.getByRole("button", { name: "Trimite" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Unul dintre destinatari nu primește mesaje de la tine" })).toBeVisible();

  for (const p of [b, c, d]) await p.close();
});
