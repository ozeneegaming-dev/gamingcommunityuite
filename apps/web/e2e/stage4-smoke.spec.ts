import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { register, useFreshIp } from "./helpers";

/**
 * Smoke test-ul etapei 4 (specul etapei, §1), pe instanța instalată de `install.spec.ts` cu „Date demo”, cu worker-ul și
 * `gcs-realtime` pornite: notificări live (răspuns + mențiune → clopoțelul 2, click → citit) → „scrie…” și bannerul
 * postărilor noi → shoutbox (live, ștergere, mute, vizitator) → „Cine e online” → digestul zilnic.
 */
test.skip(!process.env.GCS_E2E_INSTALL_URL, "Rulează doar pe instanța de instalare (e2e/run.mts, build de producție).");

async function installSql<T extends Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
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

async function newUser(browser: Browser, name: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await register(page, name, `${name.toLowerCase()}@example.com`);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await setGroup(name, group);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page;
}

const idOf = async (name: string) => (await installSql<{ id: string }>(`SELECT id FROM users WHERE name = $1`, [name]))[0]!.id;

test("etapa 4: notificări live → scrie… și postări noi → shoutbox → cine e online → digest", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await useFreshIp(page.context(), "198.18.80");
  const [welcome] = await installSql<{ id: number; slug: string }>(`SELECT id, slug FROM topics WHERE title LIKE 'Bun venit pe %' ORDER BY id LIMIT 1`);
  const topicUrl = `/topic/${welcome!.id}-${welcome!.slug}`;

  const ana = await newUser(browser, "Ana4", "198.18.81");
  const bogdan = await newUser(browser, "Bogdan4", "198.18.82");

  await test.step("A urmărește topicul; B răspunde și o menționează → clopoțelul lui A arată 2; click → citită", async () => {
    await installSql(`INSERT INTO follows ("userId", "contentType", "contentId") VALUES ($1, 'topic', $2) ON CONFLICT DO NOTHING`, [await idOf("Ana4"), String(welcome!.id)]);
    const fx = (data: Record<string, unknown>) => request.post("/api/_test/forum", { data }).then((r) => expect(r.ok()).toBe(true));
    await fx({ action: "reply", topicId: welcome!.id, text: "Primul răspuns de la Bogdan", authorEmail: "bogdan4@example.com" });
    await fx({ action: "reply", topicId: welcome!.id, text: "ai văzut?", authorEmail: "bogdan4@example.com", mentionEmail: "ana4@example.com" });
    await expect(ana.getByTestId("gcs-header-bell-count")).toHaveText("2", { timeout: 15_000 });

    await ana.getByTestId("gcs-header-bell").click();
    await ana.getByTestId("gcs-notif-panel").getByRole("link", { name: /Bogdan4 te-a menționat/ }).click();
    await expect(ana).toHaveURL(new RegExp(`/topic/${welcome!.id}-`));
    await expect(ana.getByTestId("gcs-header-bell-count")).toHaveText("1");
  });

  await test.step("B scrie în editor → A vede „Bogdan4 scrie un răspuns…”; B trimite → bannerul „1 postare nouă”", async () => {
    await ana.goto(topicUrl);
    await bogdan.goto(topicUrl);
    await expect(ana.getByTestId("gcs-topic-readers")).toContainText("Bogdan4", { timeout: 10_000 });
    await bogdan.locator("#reply .gcs-editor__content").click();
    await bogdan.keyboard.type("Revin imediat");
    await expect(ana.getByTestId("gcs-topic-typing")).toHaveText("Bogdan4 scrie un răspuns…", { timeout: 5_000 });
    await bogdan.getByRole("button", { name: "Trimite răspunsul" }).click();
    await expect(ana.getByTestId("gcs-topic-new-posts")).toContainText("1 postare nouă", { timeout: 10_000 });
  });

  await test.step("shoutbox: B scrie, A vede; moderatorul șterge și îi dă mute; vizitatorul nu-l vede", async () => {
    const mod = await newUser(browser, "Mod4", "198.18.83", "moderator");
    await mod.reload();
    await Promise.all([ana.goto("/"), bogdan.goto("/")]);
    const shout = (p: Page) => p.getByTestId("gcs-shoutbox");
    await shout(bogdan).getByTestId("gcs-chat-input").fill("Salut din shoutbox");
    await shout(bogdan).getByRole("button", { name: "Trimite" }).click();
    const atAna = shout(ana).getByTestId("gcs-chat-msg").filter({ hasText: "Salut din shoutbox" });
    await expect(atAna).toBeVisible({ timeout: 2_000 });

    const atMod = shout(mod).getByTestId("gcs-chat-msg").filter({ hasText: "Salut din shoutbox" });
    await atMod.getByRole("button", { name: "Mute", exact: true }).click();
    await atMod.getByRole("group", { name: "Mute" }).getByRole("button", { name: "10 min" }).click();
    await atMod.getByRole("button", { name: "Șterge" }).click();
    await expect(atAna).toHaveCount(0, { timeout: 5_000 });
    await bogdan.reload();
    await expect(shout(bogdan).getByTestId("gcs-chat-input")).toBeDisabled();

    const guest = await browser.newContext();
    const g = await guest.newPage();
    await g.goto("/");
    await expect(g.getByTestId("gcs-forum-index")).toBeVisible();
    await expect(g.getByTestId("gcs-shoutbox")).toHaveCount(0);
    await guest.close();
  });

  await test.step("„Cine e online” îi arată pe Ana4 și pe Bogdan4", async () => {
    await ana.reload();
    await expect(ana.getByTestId("gcs-online-members")).toContainText("Bogdan4");
    await expect(ana.getByTestId("gcs-online-members")).toContainText("Ana4");
  });

  await test.step("digestul zilnic (declanșat din ruta de test) îi trimite Anei notificarea necitită, o singură dată", async () => {
    const digest = () => request.post("/api/_test/profile", { data: { action: "digest" } }).then(async (r) => (await r.json()) as { sent: number });
    expect((await digest()).sent).toBeGreaterThanOrEqual(1);
    expect((await digest()).sent).toBe(0);
    const outbox = (await (await request.post("/api/_test/profile", { data: { action: "outbox" } })).json()) as { to: string; subject: string }[];
    expect(outbox.filter((m) => m.to === "ana4@example.com" && /notificare|notificări/.test(m.subject))).toHaveLength(1);
  });
});
