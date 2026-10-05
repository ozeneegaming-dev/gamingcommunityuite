import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { register, useFreshIp } from "./helpers";

/**
 * Smoke test-ul etapei 2 (specul etapei, §1), pe instanța instalată de `install.spec.ts` cu „Date demo”:
 * vizitator → membru nou (topic cu sondaj și tag-uri, în coadă) → moderator (aprobare) → alt membru (răspuns cu citat,
 * imagine și mențiune) → Like (+1 reputație) → rezolvare → căutare fără diacritice → permisiune scoasă → acces refuzat.
 */
test.skip(!process.env.GCS_E2E_INSTALL_URL, "Rulează doar pe instanța de instalare (e2e/run.mts, build de producție).");

/** SQL pe baza instanței de instalare (`redline_e2e_install`, pe același server ca baza E2E). */
async function installSql<T extends Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  // Pe VPS (prin tunel), baza instanței se dă explicit; local e `redline_e2e_install` pe serverul E2E.
  const url = new URL(process.env.GCS_E2E_INSTALL_DB_URL ?? process.env.DATABASE_URL!);
  if (!process.env.GCS_E2E_INSTALL_DB_URL) url.pathname = "/redline_e2e_install";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query<T>(query, params)).rows;
  } finally {
    await client.end();
  }
}

async function setGroup(name: string, groupKey: string) {
  await installSql(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = $2) WHERE name = $1`, [name, groupKey]);
  await installSql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
}

async function newUser(browser: import("@playwright/test").Browser, name: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await register(page, name, `${name.toLowerCase()}@example.com`);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  return page;
}

test("etapa 2: topic cu sondaj → aprobare → răspuns cu citat, imagine și mențiune → Like → rezolvat → căutare → acces refuzat", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await useFreshIp(page.context(), "198.18.60");

  await test.step("vizitatorul vede forumurile demo", async () => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Ajutor tehnic", exact: true })).toBeVisible();
  });

  const newbie = await newUser(browser, "Incepator", "198.18.61");
  let topicUrl = "";
  await test.step("un membru nou deschide un topic cu sondaj și tag-uri; topicul intră în coadă", async () => {
    await newbie.goto("/");
    await newbie.getByRole("link", { name: "Ajutor tehnic", exact: true }).click();
    await newbie.getByRole("link", { name: "Topic nou" }).click();
    await newbie.getByLabel("Titlu").fill("Mașina de joc nu pornește");
    const tags = newbie.getByLabel("Tag-uri");
    await tags.fill("hardware");
    await tags.press("Enter");
    await tags.fill("ajutor");
    await tags.press("Enter");
    await newbie.locator("form .gcs-editor__content").click();
    await newbie.keyboard.type("După ultimul update, jocul se închide la pornire. Ce pot încerca?");
    await newbie.getByRole("button", { name: "Adaugă un sondaj" }).click();
    await newbie.getByRole("textbox", { name: "Întrebarea sondajului" }).fill("Ce placă video ai?");
    await newbie.getByLabel("Opțiunea 1").fill("NVIDIA");
    await newbie.getByLabel("Opțiunea 2").fill("AMD");
    await newbie.getByRole("button", { name: "Publică topicul" }).click();
    await expect(newbie.getByText("Topicul tău așteaptă aprobarea unui moderator.")).toBeVisible();
  });

  const mod = await newUser(browser, "Paznicul", "198.18.62");
  await setGroup("Paznicul", "super_moderator");
  await test.step("moderatorul aprobă topicul direct din pagina lui", async () => {
    const [topic] = await installSql<{ id: number; slug: string }>(`SELECT id, slug FROM topics WHERE title = 'Mașina de joc nu pornește'`);
    topicUrl = `/topic/${topic!.id}-${topic!.slug}`;
    await mod.goto(topicUrl);
    await mod.getByTestId("gcs-post").first().getByRole("button", { name: "Aprobă" }).click();
    await expect(mod.getByText("Așteaptă aprobarea unui moderator")).toHaveCount(0);
  });

  const helper = await newUser(browser, "Ajutorul", "198.18.63");
  await setGroup("Ajutorul", "member");
  let replyId = 0;
  await test.step("alt membru răspunde cu citat, o imagine atașată și o mențiune", async () => {
    await helper.goto(topicUrl);
    await helper.getByTestId("gcs-post").first().getByRole("button", { name: "Citează" }).click();
    await helper.locator("#reply .gcs-editor__content").click();
    await helper.keyboard.press("Control+End");
    await helper.keyboard.type("Reinstalează driverele, ");
    await helper.keyboard.type("@Incep");
    await helper.getByRole("option").getByText("@Incepator").click();
    await helper.keyboard.type(" uite setările mele:");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAMElEQVRIiWO4pmE5IIhh1GKN0aC+Npq4LEezk8ZoAXJttMi0HK0kNEarRcvhXy0CAKIgzA6emNzPAAAAAElFTkSuQmCC",
      "base64",
    );
    const chooser = helper.waitForEvent("filechooser");
    await helper.locator("#reply").getByRole("button", { name: "Imagine" }).click();
    await (await chooser).setFiles({ name: "setari.png", mimeType: "image/png", buffer: png });
    await expect(helper.locator("#reply .gcs-editor__content img")).toBeVisible();

    await helper.getByRole("button", { name: "Trimite răspunsul" }).click();
    const reply = helper.getByTestId("gcs-post").last();
    await expect(reply.locator("blockquote.gcs-quote")).toContainText("Incepator a scris:");
    await expect(reply.locator("a.gcs-mention")).toHaveText("@Incepator");
    await expect(reply.locator("img.gcs-postImage")).toBeVisible();
    replyId = Number(await reply.getAttribute("data-post-id"));
  });

  await test.step("autorul dă Like (+1 reputație) și marchează răspunsul drept rezolvare", async () => {
    await newbie.goto(topicUrl);
    const reply = newbie.locator(`#post-${replyId}`);
    await reply.getByRole("button", { name: "Reacționează", exact: true }).click();
    await reply.getByRole("button", { name: "Reacționează cu Like" }).click();
    await expect(reply.getByRole("button", { name: "Like: 1" })).toBeVisible();
    await reply.getByRole("button", { name: "Marchează ca rezolvare" }).click();
    await expect(reply.getByText("Cel mai bun răspuns")).toBeVisible();
    const [rep] = await installSql<{ reputation: number }>(`SELECT reputation FROM users WHERE name = 'Ajutorul'`);
    expect(rep!.reputation).toBe(1);
  });

  await test.step("căutarea fără diacritice găsește topicul", async () => {
    await page.goto("/search?q=masina%20porneste");
    await expect(page.getByTestId("gcs-search-result").filter({ hasText: "Mașina de joc nu pornește" })).toBeVisible();
  });

  await test.step("fără `forums.read` pentru Membru, următorul request al membrului e refuzat", async () => {
    const [forum] = await installSql<{ id: number }>(`SELECT id FROM forums WHERE name = 'Ajutor tehnic'`);
    const res = await page.request.post("/api/_test/forum", {
      data: { action: "permissions", forumId: forum!.id, groupKey: "member", actions: ["forums.view"] },
    });
    expect(res.ok()).toBe(true);
    await helper.goto(topicUrl);
    await expect(helper.getByText("Nu ai acces la acest forum.")).toBeVisible();
  });

  for (const p of [newbie, mod, helper]) await p.context().close();
});
