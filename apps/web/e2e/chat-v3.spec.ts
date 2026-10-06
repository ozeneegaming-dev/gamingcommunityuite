import { expect, test, type Browser, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, useFreshIp } from "./helpers";

/** Chat v3 (după Chatbox-ul IPS): avatare, culorile grupului, mențiuni, emoticoane, media și setările din ACP. */
async function chatPage(browser: Browser, name: string, email: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  await page.goto("/chat");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page;
}

/** O imagine PNG mică (120×40). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

const room = (page: Page) => page.getByTestId("gcs-chat-general");

/** Trimite și așteaptă mesajul în listă (flood-ul VIP e de 1 s între mesaje). */
async function send(page: Page, text: string, expected = text): Promise<void> {
  await room(page).getByTestId("gcs-chat-input").fill(text);
  await room(page).getByRole("button", { name: "Trimite" }).click();
  await expect(room(page).getByTestId("gcs-chat-msg").filter({ hasText: expected })).toBeVisible();
  await page.waitForTimeout(1_100);
}

test("avatarul și numele în culoarea grupului; click pe nume → mențiune; emoticoane, YouTube, imagine; autorul își șterge mesajul", async ({ browser }) => {
  test.setTimeout(120_000);
  const id = uid();
  const a = await chatPage(browser, `Vip${id}`, `c3-a-${id}@example.com`, "198.18.30", "vip_gold");
  const b = await chatPage(browser, `Mem${id}`, `c3-b-${id}@example.com`, "198.18.31");

  await send(b, `salut ${id}`);
  const fromB = room(a).getByTestId("gcs-chat-msg").filter({ hasText: `salut ${id}` });
  await expect(fromB).toBeVisible({ timeout: 5_000 });
  await expect(fromB.getByTestId("gcs-chat-avatar")).toBeVisible();
  await expect(fromB.getByTestId("gcs-chat-name")).toHaveClass(/gcs-name--member/);

  // Click pe nume → @nume în câmp; apoi un emoticon din tab-ul „Gaming și sport”.
  await fromB.getByTestId("gcs-chat-name").click();
  await expect(room(a).getByTestId("gcs-chat-input")).toHaveValue(`@Mem${id} `);
  await room(a).getByRole("button", { name: "Emoticoane" }).first().click();
  const emoji = room(a).getByTestId("gcs-chat-emoji");
  await emoji.getByRole("tab", { name: "Gaming și sport" }).click();
  await emoji.getByRole("button", { name: "🎮" }).click();
  await expect(room(a).getByTestId("gcs-chat-input")).toHaveValue(`@Mem${id} 🎮`);
  await room(a).getByTestId("gcs-chat-input").press("Enter");
  const mention = room(b).getByTestId("gcs-chat-msg").filter({ hasText: `@Mem${id} 🎮` });
  await expect(mention).toBeVisible({ timeout: 5_000 });
  await expect(mention.getByTestId("gcs-chat-name")).toHaveClass(/gcs-name--vip_gold/);
  await a.waitForTimeout(1_100);

  // YouTube: miniatura; clipul se deschide într-o fereastră.
  await send(a, "https://youtu.be/dQw4w9WgXcQ");
  const yt = room(b).getByTestId("gcs-chat-msg").filter({ hasText: "youtu.be/dQw4w9WgXcQ" }).getByTestId("gcs-chat-youtube");
  await expect(yt).toBeVisible({ timeout: 5_000 });
  await yt.click();
  await expect(b.locator("dialog")).toBeVisible();
  await expect(b.locator("dialog iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  await b.locator("dialog").getByRole("button", { name: "Închide", exact: true }).click();

  // Imaginea încărcată ajunge la celălalt membru.
  await room(a).getByTestId("gcs-chat-file").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG });
  await expect(room(a).getByRole("list", { name: "Imagini atașate" }).getByRole("img")).toBeVisible();
  await room(a).getByTestId("gcs-chat-input").fill(`poza ${id}`);
  await room(a).getByRole("button", { name: "Trimite" }).click();
  const withImage = room(b).getByTestId("gcs-chat-msg").filter({ hasText: `poza ${id}` });
  await expect(withImage.locator('img[src^="/files/"]')).toBeVisible({ timeout: 5_000 });

  // Autorul își șterge mesajul; dispare și la celălalt.
  await room(a).getByTestId("gcs-chat-msg").filter({ hasText: `poza ${id}` }).getByRole("button", { name: "Șterge" }).click();
  await expect(withImage).toHaveCount(0, { timeout: 5_000 });
  for (const p of [a, b]) await p.context().close();
});

test("setările din ACP: regulile, mesajele noi sus, ora pe 12 h și limita de emoticoane", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const keys = ["chat.rules", "chat.newest_on_top", "chat.time_format", "chat.max_emoticons"];
  const id = uid();
  await useFreshIp(context, "198.18.32");
  await enterAcpAsRoot(page, `RootC${id}`, `c3-root-${id}@example.com`);
  try {
    await page.goto("/admin/community/chat/settings");
    const form = page.getByTestId("gcs-acp-chat-settings");
    await form.getByLabel("Regulile chat-ului (gol = fără butonul „Reguli”)").fill(`Fără spam ${id}.\nRespect.`);
    await form.getByLabel("Mesajele noi sus (câmpul de scris deasupra listei)").check();
    await form.getByLabel("Formatul orei").selectOption("12h");
    await form.getByLabel("Emoticoane într-un mesaj (0 = nelimitat)").fill("1");
    await form.getByRole("button", { name: "Salvează" }).click();
    await expect(form.getByRole("status")).toBeVisible();

    const m = await chatPage(browser, `Mc${id}`, `c3-m-${id}@example.com`, "198.18.33");
    await room(m).getByTestId("gcs-chat-rules-open").click();
    await expect(m.getByTestId("gcs-chat-rules")).toContainText(`Fără spam ${id}.`);
    await m.getByTestId("gcs-chat-rules").getByRole("button", { name: "Închide" }).click();

    // Câmpul de scris e deasupra listei; mesajul nou e primul.
    const inputBox = await room(m).getByTestId("gcs-chat-input").boundingBox();
    const listBox = await room(m).locator(".gcs-chat__list").boundingBox();
    expect(inputBox!.y).toBeLessThan(listBox!.y);
    await room(m).getByTestId("gcs-chat-input").fill(`sus ${id}`);
    await room(m).getByRole("button", { name: "Trimite" }).click();
    const first = room(m).getByTestId("gcs-chat-msg").first();
    await expect(first).toContainText(`sus ${id}`);
    const time = first.locator("time");
    const expected = await time.evaluate((el) =>
      new Date(el.getAttribute("datetime")!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }),
    );
    await expect(time).toHaveText(expected);

    await m.waitForTimeout(3_100);
    await room(m).getByTestId("gcs-chat-input").fill("😀😀");
    await room(m).getByRole("button", { name: "Trimite" }).click();
    await expect(room(m).getByRole("alert")).toContainText("Prea multe emoticoane");
    await m.context().close();
  } finally {
    for (const key of keys) await resetSetting(key);
  }
});
