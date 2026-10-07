import { expect, test, type APIRequestContext } from "@playwright/test";
import { forumTree, member, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { login, PASSWORD, sql, totp, useFreshIp, userId } from "./helpers";

async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("câmpul Țară și accentul ales apar pe profil", async ({ page }) => {
  const id = uid();
  await member(page, `Mara${id}`, `mara-${id}@example.com`);
  await page.goto("/settings/profile");
  await page.getByLabel("Țară").fill("România");
  await page.getByLabel("Descriere scurtă").fill("Nu există lag, doar skill issue.");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

  await page.goto("/settings/appearance");
  await expect(page.getByTestId("gcs-no-cosmetics")).toBeVisible();
  await expect(page.getByTestId("gcs-frame-options")).toHaveCount(0);
  await page.getByRole("button", { name: "#3DDC97" }).click();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-profile").click();
  await expect(page.locator(".gcs-profileField", { hasText: "Țară" })).toContainText("România");
  await expect(page.getByText("„Nu există lag, doar skill issue.”")).toBeVisible();
  expect(await page.getByTestId("gcs-profile-cover").getAttribute("style")).toContain("rgba(61, 220, 151");
});

test("un VIP Gold vede Fire și Gold (nu Neon); rama aleasă apare pe topic", async ({ page, request }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  await member(page, `Shadow${id}`, `shadow-${id}@example.com`);
  await profileFixture(request, { action: "vip", email: `shadow-${id}@example.com`, groupKey: "vip_gold", days: 30 });
  const topic = await topicWithReplies(request, forum.id, `shadow-${id}@example.com`, `Ramă ${id}`);

  await page.goto("/settings/appearance");
  const frames = page.getByTestId("gcs-frame-options");
  await expect(frames.getByText("Fire")).toBeVisible();
  await expect(frames.getByText("Gold")).toBeVisible();
  await expect(frames.getByText("Neon")).toHaveCount(0);
  await frames.locator("label", { hasText: "Gold" }).click();
  await expect(page.getByTestId("gcs-appearance-preview").locator(".gcs-avatarFrame--gold")).toBeVisible();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

  await page.goto(topic.url);
  await expect(page.getByTestId("gcs-post").first().locator(".gcs-avatarFrame--gold")).toBeVisible();
});

test("mesajele „Nimeni”: butonul Mesaj dispare de pe profil pentru ceilalți", async ({ page, browser }) => {
  const id = uid();
  const other = await memberInNewContext(browser, `Other${id}`, `other-${id}@example.com`, "198.51.100");
  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`other-${id}@example.com`]);
  await member(page, `Mara${id}`, `mara-${id}@example.com`);
  await page.goto(`/members/${row!.id}`);
  await expect(page.getByTestId("gcs-profile-message")).toBeVisible();

  await other.goto("/settings/privacy");
  await other.getByLabel("Cine îmi poate scrie mesaje private").selectOption("NOBODY");
  await other.getByRole("button", { name: "Salvează" }).click();
  await expect(other.getByTestId("gcs-settings-status")).toHaveText("Salvat.");
  await other.close();

  await page.reload();
  await expect(page.getByTestId("gcs-profile-message")).toHaveCount(0);
});

test("un cont Steam fără email vede bannerul; după confirmarea emailului bannerul dispare", async ({ page, request }) => {
  const id = uid();
  await member(page, `Steam${id}`, `steam-${id}@example.com`);
  await sql(`UPDATE users SET email = $2 WHERE email = $1`, [`steam-${id}@example.com`, `7656119${Date.now()}@steam.invalid`]);
  await page.goto("/");
  await expect(page.getByTestId("gcs-steam-email-banner")).toBeVisible();

  await page.getByTestId("gcs-steam-email-banner").getByRole("link").click();
  await page.getByLabel("Adresa nouă").fill(`real-${id}@example.com`);
  await page.getByRole("button", { name: "Trimite linkul de confirmare" }).click();
  await expect(page.getByTestId("gcs-settings-status").first()).toHaveText("Ți-am trimis un link de confirmare pe adresa nouă.");

  const mails = await profileFixture<{ to: string; html: string }[]>(request, { action: "outbox" });
  const mail = mails.find((m) => m.to === `real-${id}@example.com`)!;
  const link = /href="([^"]+)"/.exec(mail.html)![1]!.replace(/&#38;/g, "&");
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByTestId("gcs-email-changed")).toBeVisible();
  await expect(page.getByTestId("gcs-steam-email-banner")).toHaveCount(0);
});

test.describe("setările din etapa 5", () => {
  test("fusul orar se salvează; „Deconectează” închide cealaltă sesiune", async ({ page, browser }) => {
    const id = uid();
    await member(page, `Tz${id}`, `tz-${id}@example.com`);
    await page.goto("/settings/language");
    await page.getByTestId("gcs-timezone").selectOption("America/New_York");
    await page.getByRole("button", { name: "Salvează" }).click();
    await expect(page.getByRole("status")).toHaveText("Salvat.");
    await page.reload();
    await expect(page.getByTestId("gcs-timezone")).toHaveValue("America/New_York");
    const [row] = await sql<{ timezone: string }>(`SELECT timezone FROM users WHERE email = $1`, [`tz-${id}@example.com`]);
    expect(row!.timezone).toBe("America/New_York");

    // A doua sesiune (alt browser), apoi deconectarea ei din prima.
    const other = await browser.newContext();
    await useFreshIp(other, "203.0.114");
    const second = await other.newPage();
    await second.goto("/login");
    await login(second, `tz-${id}@example.com`);
    await expect(second.getByTestId("gcs-header-user")).toBeVisible();

    await page.goto("/settings/security");
    await expect(page.getByTestId("gcs-session")).toHaveCount(2);
    await page.getByTestId("gcs-session").filter({ hasNot: page.getByText("Sesiunea curentă") }).getByRole("button", { name: "Deconectează" }).click();
    await expect(page.getByTestId("gcs-session")).toHaveCount(1);
    await second.reload();
    await expect(second.getByTestId("gcs-header-login")).toBeVisible();
    await other.close();
  });

  test("un membru își activează autentificarea în doi pași", async ({ page }) => {
    const id = uid();
    await member(page, `Tfa${id}`, `tfa-${id}@example.com`);
    await page.goto("/settings/security");
    await page.getByTestId("gcs-2fa-enable").click();
    await page.getByLabel("Parola contului").fill(PASSWORD);
    await page.getByRole("button", { name: "Continuă" }).click();
    const secret = (await page.getByTestId("gcs-totp-secret").textContent())?.trim() ?? "";
    await page.getByLabel("Codul din aplicație").fill(totp(secret));
    await page.getByRole("button", { name: "Activează 2FA" }).click();
    await expect(page.getByTestId("gcs-2fa-status")).toHaveText("Autentificarea în doi pași este activă.");
  });

  test("semnătura formatată (culoare, mărime, imagine din adresă) apare sub postări; video-ul nu există în bară", async ({ page, request }) => {
    const t = await forumTree(request);
    const id = uid();
    await member(page, `Sig${id}`, `sig-${id}@example.com`);
    await page.goto("/settings/signature");
    const form = page.getByTestId("gcs-signature-form");
    // Editorul compact: formatarea, linkul, imaginea din adresă și emoji; fără video, citat, cod sau „Tot ecranul”.
    const toolbar = form.getByRole("toolbar", { name: "Formatare" });
    await expect(toolbar.getByRole("button", { name: "Video" })).toHaveCount(0);
    await expect(toolbar.getByRole("button", { name: "Citat" })).toHaveCount(0);
    const box = form.getByRole("textbox", { name: "Textul semnăturii" });
    // După o comandă care mută focusul (popover, listă), editorul și-l recapătă la cadrul următor și își reaplică
    // selecția; tastele se trimit abia după aceea.
    const settle = async () => {
      await expect(box).toBeFocused();
      await page.waitForTimeout(250);
    };
    await box.click();
    await page.keyboard.type(`Semnătura lui Sig${id}`);
    await page.keyboard.press("Enter");
    await toolbar.getByRole("button", { name: "Imagine" }).click();
    await form.getByLabel("Adresa imaginii (https://…)").fill("http://cdn.example/banner.png");
    await form.getByRole("button", { name: "Inserează" }).click();
    await expect(form.getByRole("alert")).toHaveText("Adresa trebuie să înceapă cu https:// și să ducă la o imagine.");
    await form.getByLabel("Adresa imaginii (https://…)").fill("https://cdn.example/banner.png");
    await form.getByRole("button", { name: "Inserează" }).click();
    await settle();
    // Tot textul: culoarea (butoanele barei nu iau focusul), apoi mărimea (lista o aplică aceleiași selecții).
    await page.keyboard.press("ControlOrMeta+A");
    await toolbar.getByRole("button", { name: "Culoarea textului" }).click();
    await form.getByRole("button", { name: "#3DDC97" }).click();
    await toolbar.getByLabel("Mărimea textului").selectOption("18px");
    await settle();
    await form.getByRole("button", { name: "Salvează semnătura" }).click();
    const preview = page.getByTestId("gcs-signature-preview");
    await expect(preview.locator('span[style*="color:#3DDC97"]')).toHaveText(`Semnătura lui Sig${id}`);
    await expect(preview.locator('span[style*="font-size:18px"]')).toHaveCount(1);
    await expect(preview.locator('img[src="https://cdn.example/banner.png"]')).toHaveCount(1);

    const topic = await topicWithReplies(request, t.forum.id, `sig-${id}@example.com`, `Semnat ${id}`);
    await page.goto(topic.url);
    const signature = page.getByTestId("gcs-post").first().getByTestId("gcs-post-signature");
    await expect(signature).toContainText(`Semnătura lui Sig${id}`);
    await expect(signature.locator('span[style*="color:#3DDC97"]')).toHaveCount(1);
    // Imaginile din semnătură sunt mici (cel mult 90 px înălțime).
    expect(await signature.locator("img").evaluate((img) => getComputedStyle(img).maxHeight)).toBe("90px");
  });

  test("un câmp de profil „Text lung” se scrie în editorul compact și apare formatat în tabul Despre", async ({ page }) => {
    const id = uid();
    const key = `despre_${id}`;
    await sql(`INSERT INTO profile_fields (key, label, type, section, "maxLength", position, options) VALUES ($1, $2, 'TEXTAREA', 'ABOUT', 300, 50, '{}')`, [key, `Despre mine ${id}`]);
    try {
      await member(page, `Ab${id}`, `ab-${id}@example.com`);
      await page.goto("/settings/profile");
      await page.getByRole("textbox", { name: `Despre mine ${id}` }).click();
      await page.keyboard.type("Joc CS2 ");
      await page.getByRole("button", { name: "Bold", exact: true }).click();
      await page.keyboard.type("în fiecare seară");
      await page.getByRole("button", { name: "Salvează", exact: true }).click();
      await expect(page.getByTestId("gcs-settings-status")).toHaveText("Salvat.");

      await page.goto(`/members/${await userId(`ab-${id}@example.com`)}?tab=about`);
      const field = page.getByTestId("gcs-profile-rich-field").filter({ hasText: `Despre mine ${id}` });
      await expect(field.locator("strong")).toHaveText("în fiecare seară");
      await expect(field).toContainText("Joc CS2");
    } finally {
      await sql(`DELETE FROM profile_fields WHERE key = $1`, [key]);
    }
  });

  test("toast-ul unei notificări noi apare; oprit din setări, nu mai apare", async ({ page, browser, request }) => {
    const t = await forumTree(request);
    const id = uid();
    await member(page, `Toast${id}`, `toast-${id}@example.com`);
    const author = await memberInNewContext(browser, `Autor${id}`, `autor-t-${id}@example.com`, "203.0.115");
    await author.context().close();
    const topic = await topicWithReplies(request, t.forum.id, `autor-t-${id}@example.com`, `Toast ${id}`);

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
    await request.post("/api/_test/forum", { data: { action: "reply", topicId: topic.topicId, text: "salut", authorEmail: `autor-t-${id}@example.com`, mentionEmail: `toast-${id}@example.com` } });
    await expect(page.getByTestId("gcs-toast").first()).toBeVisible({ timeout: 15_000 });

    await page.goto("/settings/notifications");
    const prefs = page.getByTestId("gcs-alert-prefs");
    await prefs.getByLabel("Arată notificările noi în colțul ecranului").uncheck();
    await prefs.getByRole("button", { name: "Salvează alertele" }).click();
    await expect(prefs.getByRole("status")).toHaveText("Preferințele au fost salvate.");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
    await request.post("/api/_test/forum", { data: { action: "reply", topicId: topic.topicId, text: "din nou", authorEmail: `autor-t-${id}@example.com`, mentionEmail: `toast-${id}@example.com` } });
    await expect(page.getByTestId("gcs-header-bell-count")).toHaveText(/[2-9]/, { timeout: 15_000 });
    await expect(page.getByTestId("gcs-toast")).toHaveCount(0);
  });
});
