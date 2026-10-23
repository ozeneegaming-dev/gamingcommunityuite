import { expect, test, type Browser, type Page } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

/**
 * Transporturile de rezervă (ediția Lite): același topic live ca pe websocket — „Citesc acum”, „scrie…”, bannerul
 * postărilor noi și clopoțelul de notificări — pe SSE și pe polling (forțate din `localStorage`).
 */
for (const transport of ["sse", "poll"] as const) {
  async function memberPage(browser: Browser, name: string, email: string, ip: string): Promise<Page> {
    const context = await browser.newContext();
    await useFreshIp(context, ip);
    await context.addInitScript((t) => window.localStorage.setItem("gcs-rt-transport", t), transport);
    const page = await context.newPage();
    await member(page, name, email);
    return page;
  }

  test(`topicul live pe ${transport}: cititorii, „scrie…” și „1 postare nouă”`, async ({ browser, request }) => {
    test.setTimeout(120_000);
    const id = uid();
    const net = transport === "sse" ? "198.21" : "198.22";
    const { forum } = await forumTree(request);
    const aEmail = `fb-a-${transport}-${id}@example.com`;
    const bEmail = `fb-b-${transport}-${id}@example.com`;
    const a = await memberPage(browser, `FbA${id}`, aEmail, `${net}.1`);
    const b = await memberPage(browser, `FbB${id}`, bEmail, `${net}.2`);
    const topic = await topicWithReplies(request, forum.id, aEmail, `Rezervă ${transport} ${id}`);

    await a.goto(topic.url);
    await expect(a.locator("html")).toHaveAttribute("data-realtime-transport", transport, { timeout: 20_000 });
    await expect(a.locator("html")).toHaveAttribute("data-realtime", "on");
    await b.goto(topic.url);
    await expect(b.locator("html")).toHaveAttribute("data-realtime-transport", transport, { timeout: 20_000 });
    await expect(a.getByTestId("gcs-topic-readers")).toContainText(`FbB${id}`, { timeout: 20_000 });

    await typeInEditor(b, "Un răspuns pe rezervă");
    await expect(a.getByTestId("gcs-topic-typing")).toHaveText(`FbB${id} scrie un răspuns…`, { timeout: 15_000 });

    await b.getByRole("button", { name: "Trimite răspunsul" }).click();
    const banner = a.getByTestId("gcs-topic-new-posts");
    await expect(banner).toContainText("1 postare nouă", { timeout: 20_000 });
    await banner.getByRole("link", { name: "arată" }).click();
    await expect(a.getByText("Un răspuns pe rezervă")).toBeVisible();

    // O notificare ajunge live la clopoțel: un nou răspuns al lui B în topicul lui A, cât timp A e pe prima pagină.
    await a.goto("/");
    await expect(a.locator("html")).toHaveAttribute("data-realtime-transport", transport, { timeout: 20_000 });
    const bell = a.getByTestId("gcs-header-bell-count");
    const before = (await bell.count()) > 0 ? Number(await bell.textContent()) : 0;
    await fixture(request, { action: "reply", topicId: topic.topicId, text: `Pentru A ${id}`, authorEmail: bEmail });
    await expect(bell).toHaveText(String(before + 1), { timeout: 20_000 });
    for (const p of [a, b]) await p.context().close();
  });
}
