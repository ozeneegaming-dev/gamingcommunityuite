import { expect, test, type Locator, type Page } from "@playwright/test";
import { forumTree, member, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

/**
 * Hover card-ul lângă nume (8 px, dedesubt sau deasupra, după mărimea măsurată), coperta în card și în postbit,
 * statusul online o singură dată în postbit (specul „hover card și coperta în postbit”, 2026-10-07).
 */

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

/** Un banner lat (PNG), desenat de browser: coperta încărcată de membru. */
async function bannerPng(page: Page): Promise<Buffer> {
  const canvas = await page.context().newPage();
  await canvas.setViewportSize({ width: 1200, height: 300 });
  await canvas.setContent(
    '<body style="margin:0;width:1200px;height:300px;display:grid;place-items:center;background:linear-gradient(120deg,#1b1033,#3a0d16 55%,#0f2236);font:800 64px sans-serif;color:#fff;letter-spacing:.12em">GCS COMMUNITY</body>',
  );
  const png = await canvas.screenshot({ type: "png" });
  await canvas.close();
  return png;
}

/** Coperta membrului logat în `page`, cu poziția verticală dată (ca din Setări → Profil). */
async function uploadCover(page: Page, positionY: number): Promise<void> {
  const res = await page.request.post("/api/profile/images", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { file: { name: "cover.png", mimeType: "image/png", buffer: await bannerPng(page) }, kind: "cover", positionY: String(positionY) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Coperta randată: poziția verticală și imaginea (stilul calculat; browserul rescrie ordinea din `background`). */
async function coverOf(locator: Locator) {
  return locator.evaluate((el) => ({ y: getComputedStyle(el).backgroundPositionY, image: getComputedStyle(el).backgroundImage }));
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** Cardul deschis, după animația de apariție (120 ms). */
async function openCard(page: Page, name: Locator): Promise<Locator> {
  await name.hover();
  const layer = page.locator(".gcs-hoverCardLayer");
  await expect(layer.getByTestId("gcs-hover-card")).toBeVisible();
  await expect(layer).not.toHaveAttribute("data-side", "pending");
  await page.waitForTimeout(250);
  return layer;
}

test("coperta apare în postbit și în hover card, cu poziția salvată; numele stă sub copertă; statusul online apare o dată", async ({ page, request, browser }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  const author = await memberInNewContext(browser, `Banner${id}`, `banner-${id}@example.com`, "198.51.100");
  await uploadCover(author, 30);
  await author.close();
  const topic = await topicWithReplies(request, forum.id, `banner-${id}@example.com`, `Topic copertă ${id}`);
  await member(page, `Fan${id}`, `fan-${id}@example.com`);

  await page.goto(topic.url);
  const postbit = page.getByTestId("gcs-post").first().getByTestId("gcs-postbit");
  const cover = postbit.getByTestId("gcs-postbit-cover");
  await expect(cover).toBeVisible();
  expect(await coverOf(cover)).toMatchObject({ y: "30%", image: expect.stringContaining("/files/") });
  await expect(postbit.locator(".gcs-postbit__profile--cover")).toBeVisible();
  // Online o singură dată: sus, lângă @handle (subsolul are doar „Membru din”).
  await expect(postbit.getByTestId("gcs-postbit-online")).toHaveCount(1);
  await expect(postbit.locator(".gcs-postbit__footStatus")).toHaveCount(0);
  await expect(postbit.locator(".gcs-postbit__foot")).toContainText("Membru din");

  const name = postbit.locator(".gcs-post__authorName a");
  const layer = await openCard(page, name);
  const card = layer.getByTestId("gcs-hover-card");
  const cardCover = card.getByTestId("gcs-hover-cover");
  expect(await coverOf(cardCover)).toMatchObject({ y: "30%", image: expect.stringContaining("/files/") });
  // Numele, grupul și statusul sunt sub copertă (nu desenate peste imagine).
  const coverBox = await box(cardCover);
  expect((await box(card.locator(".gcs-hoverCard__name"))).y).toBeGreaterThanOrEqual(coverBox.y + coverBox.height);
  expect((await box(card.locator(".gcs-hoverCard__meta"))).y).toBeGreaterThanOrEqual(coverBox.y + coverBox.height);
  // Lipit de nume: 8 px sub el.
  const nameBox = await box(name);
  const layerBox = await box(layer);
  await expect(layer).toHaveAttribute("data-side", "below");
  expect(Math.abs(layerBox.y - (nameBox.y + nameBox.height + 8))).toBeLessThanOrEqual(1.5);
});

test("lângă marginea de jos, cardul se deschide deasupra numelui, la 8 px (după înălțimea reală), și pentru vizitatori", async ({ page, request, browser }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  const author = await memberInNewContext(browser, `Jos${id}`, `jos-${id}@example.com`, "198.51.100");
  await author.close();
  const topic = await topicWithReplies(request, forum.id, `jos-${id}@example.com`, `Topic jos ${id}`, 2);
  await page.setViewportSize({ width: 1280, height: 720 });

  for (const who of ["guest", "member"] as const) {
    if (who === "member") await member(page, `Cititor${id}`, `cititor-${id}@example.com`);
    await page.goto(topic.url);
    const name = page.getByTestId("gcs-post").last().locator(".gcs-post__authorName a");
    await name.scrollIntoViewIfNeeded();
    // Numele la ~70 px de marginea de jos: dedesubt nu e loc pentru card.
    await name.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - (window.innerHeight - 70)));
    const layer = await openCard(page, name);
    await expect(layer).toHaveAttribute("data-side", "above");
    const nameBox = await box(name);
    const layerBox = await box(layer);
    expect(Math.abs(layerBox.y + layerBox.height - (nameBox.y - 8)), who).toBeLessThanOrEqual(1.5);
    await expect(layer.getByTestId("gcs-hover-follow")).toHaveCount(who === "guest" ? 0 : 1);
    await page.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);
  }
});
