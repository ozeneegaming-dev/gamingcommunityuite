import { e2eKv } from "./kv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { sql, userId, useFreshIp } from "./helpers";

/**
 * Mențiunile peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): aceeași listă de sugestii în chat, Chat Pro,
 * pe perete și în editoarele postărilor / mesajelor private (tastatura: ↑ ↓, Enter, Escape; click), aceeași pastilă
 * (după id, cu stilul numelui sau culoarea grupului, hover card / cardul grupului) și notificarea celui menționat.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

// Testele nu depind unul de altul (doar de userii din `beforeAll`): fără `serial`, o eroare nu le oprește pe celelalte.
const id = uid();
const authorName = `Ana${id}`;
const authorEmail = `ment-a-${id}@example.com`;
const targetName = `Bogdan${id}`;
const targetEmail = `ment-b-${id}@example.com`;
const groupName = `Echipa${id}`;
const colegEmail = `ment-c-${id}@example.com`;
let author: Page;
let target: Page;
let groupDbId = 0;

async function memberPage(browser: Browser, name: string, email: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email);
  return page;
}

async function setApp(key: string, enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [key, enabled]);
  const redis = await e2eKv();
  try {
    await redis.del("gcs:k:apps:enabled", "gcs:k:groups:mentions");
  } finally {
    redis.disconnect();
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mentions-${name}.png`) });
}

/** Scrie `@…` în câmp și alege sugestia cu textul dat (din tastatură: săgeți + Enter, sau click). */
async function pick(page: Page, popupScope: Locator, query: string, label: string, how: "keyboard" | "click"): Promise<void> {
  await page.keyboard.type(`@${query}`);
  const popup = popupScope.getByTestId("gcs-mention-popup");
  const option = popup.getByRole("option").filter({ hasText: `@${label}` });
  await expect(option).toBeVisible();
  if (how === "click") {
    await option.click();
    return;
  }
  const options = popup.getByRole("option");
  const index = (await options.allTextContents()).findIndex((t) => t.includes(`@${label}`));
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
  await expect(options.nth(index)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(popup).toHaveCount(0);
}

/** Hover pe un element și stratul cardului afișat. */
async function hoverCard(page: Page, target: Locator) {
  await target.hover();
  const layer = page.locator(".gcs-hoverCardLayer");
  await expect(layer).toBeVisible();
  await expect(layer).not.toHaveAttribute("data-side", "pending");
  return layer;
}

const notified = async (email: string, type: string, targetType?: string) =>
  (
    await sql<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE "userId" = $1 AND type = $2 ${targetType ? `AND "targetType" = $3` : ""}`, [
      await userId(email),
      type,
      ...(targetType ? [targetType] : []),
    ])
  )[0]!.n;

test.beforeAll(async ({ browser }) => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  author = await memberPage(browser, authorName, authorEmail, "198.18.70");
  target = await memberPage(browser, targetName, targetEmail, "198.18.71");
  await memberPage(browser, `Coleg${id}`, colegEmail, "198.18.72");
  // Un grup pe care membrii îl pot menționa (cu notificarea membrilor), cu un membru ca grup secundar.
  const [group] = await sql<{ id: number }>(
    `INSERT INTO groups (key, name, color, icon, position, "isProtected", "inLegend") VALUES ($1, $2, '#3DDC97', 'fa-solid fa-gamepad', 901, false, false) RETURNING id`,
    [`custom_ment_${id}`, groupName],
  );
  groupDbId = group!.id;
  await sql(`INSERT INTO user_groups ("userId", "groupId") VALUES ($1, $2)`, [await userId(colegEmail), groupDbId]);
  const memberGroup = (await sql<{ id: number }>(`SELECT id FROM groups WHERE key = 'member'`))[0]!.id;
  for (const [key, value] of [
    ["mentions.enabled", true],
    ["mentions.allowed_groups", [memberGroup]],
    ["mentions.notify", true],
    ["mentions.notify_limit", 20],
    ["mentions.cooldown_minutes", 0],
  ] as const) {
    await sql(`INSERT INTO group_settings ("groupId", key, value) VALUES ($1, $2, $3::jsonb) ON CONFLICT ("groupId", key) DO UPDATE SET value = EXCLUDED.value`, [groupDbId, key, JSON.stringify(value)]);
  }
  await setApp("chat_pro", false);
});

test.afterAll(async () => {
  await setApp("chat_pro", false).catch(() => {});
});

test("chat-ul: sugestiile (tastatură și click), pastilele după id cu stilul numelui, hover card-ul și notificările", async () => {
  await author.goto("/chat");
  await expect(author.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  const room = author.getByTestId("gcs-chat-general");
  const input = room.getByTestId("gcs-chat-input");
  await input.click();
  await author.keyboard.type("Salut ");
  await pick(author, room, targetName.slice(0, 5), targetName, "keyboard");
  await author.keyboard.type("și ");
  await pick(author, room, groupName.slice(0, 6), groupName, "click");
  await expect(input).toHaveValue(`Salut @${targetName} și @${groupName} `);
  await shot(author, "chat-before-send");
  await room.getByRole("button", { name: "Trimite" }).click();

  const msg = room.getByTestId("gcs-chat-msg").filter({ hasText: targetName }).last();
  const pill = msg.locator("a.gcs-mention");
  await expect(pill).toHaveAttribute("data-user-id", await userId(targetEmail));
  await expect(pill).toHaveClass(/gcs-name--member/);
  const groupPill = msg.locator("a.gcs-groupMention");
  await expect(groupPill).toHaveAttribute("data-group-id", String(groupDbId));
  await expect(groupPill).toHaveText(`@${groupName}`);
  await expect(groupPill).toHaveAttribute("href", `/members?group=${groupDbId}`);
  const layer = await hoverCard(author, pill);
  await expect(layer.getByTestId("gcs-hover-card")).toBeVisible();
  await shot(author, "chat-pill-hovercard");
  await author.mouse.move(0, 0);

  await expect.poll(() => notified(targetEmail, "chat.mention")).toBe(1);
  await expect.poll(() => notified(colegEmail, "core.group_mention", "chat.message"), { timeout: 30_000 }).toBe(1);
});

test("Escape închide lista, iar pe un ecran îngust lista încape", async () => {
  await author.setViewportSize({ width: 375, height: 760 });
  await author.goto("/chat");
  const room = author.getByTestId("gcs-chat-general");
  await room.getByTestId("gcs-chat-input").click();
  await author.keyboard.type(`@${targetName.slice(0, 5)}`);
  const popup = room.getByTestId("gcs-mention-popup");
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await shot(author, "chat-narrow");
  await author.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await room.getByTestId("gcs-chat-input").fill("");
  await author.setViewportSize({ width: 1280, height: 800 });
});

test("Chat Pro: aceeași listă, pastila după id; mesajul e evidențiat ca mențiune la cel menționat", async () => {
  await setApp("chat_pro", true);
  await target.goto("/chat");
  await expect(target.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await author.goto("/chat");
  await expect(author.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await author.waitForTimeout(3_000);
  const room = author.getByTestId("gcs-chat-general");
  await room.getByTestId("gcs-chat-input").click();
  await pick(author, room, targetName.slice(0, 5), targetName, "keyboard");
  await author.keyboard.type("intră în meci");
  await room.getByRole("button", { name: "Trimite" }).click();
  const seen = target.getByTestId("gcs-chat-general").getByTestId("gcs-chat-msg").filter({ hasText: "intră în meci" }).last();
  await expect(seen).toHaveClass(/gcs-chatPro__msg--mention/);
  await expect(seen.locator("a.gcs-mention")).toHaveAttribute("data-user-id", await userId(targetEmail));
  await shot(target, "chat-pro-mention");
  await setApp("chat_pro", false);
});

test("peretele profilului: sugestiile în textarea, pastila în status și notificarea", async () => {
  await author.goto(`/members/${await userId(targetEmail)}?tab=about`);
  const input = author.getByTestId("gcs-wall-input");
  await input.click();
  await author.keyboard.type("Bravo ");
  await pick(author, author.locator("form.gcs-wallComposer").first(), targetName.slice(0, 5), targetName, "click");
  await author.keyboard.type("pentru turneu");
  await author.locator("form.gcs-wallComposer").first().locator('button[type="submit"]').click();
  const pill = author.getByTestId("gcs-wall-item").filter({ hasText: "pentru turneu" }).first().locator("a.gcs-mention");
  await expect(pill).toHaveAttribute("data-user-id", await userId(targetEmail));
  await expect(pill).toHaveClass(/gcs-name--member/);
  await shot(author, "wall");
  await expect.poll(() => notified(targetEmail, "forums.mention", "profile.status")).toBe(1);
});

test("postările și mesajele private: pastila cu stilul numelui și notificarea celui menționat", async ({ request }) => {
  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, authorEmail, `Mențiuni peste tot ${id}`);
  await author.goto(topic.url);
  await typeInEditor(author, "Uite ");
  await author.keyboard.type(`@${targetName.slice(0, 5)}`);
  await author.locator(".gcs-mentionList").getByRole("option").filter({ hasText: `@${targetName}` }).click();
  await author.getByRole("button", { name: "Trimite răspunsul" }).click();
  const pill = author.getByTestId("gcs-post").last().locator("a.gcs-mention");
  await expect(pill).toHaveClass(/gcs-name--member/);
  await expect.poll(() => notified(targetEmail, "forums.mention", "forums.post")).toBe(1);

  await author.goto(`/messages/new?to=${await userId(targetEmail)}`);
  await author.getByLabel("Titlu").fill(`Mesaj ${id}`);
  await typeInEditor(author, "Salut ", author.locator("form"));
  await author.keyboard.type(`@${targetName.slice(0, 5)}`);
  await author.locator(".gcs-mentionList").getByRole("option").filter({ hasText: `@${targetName}` }).click();
  await author.getByRole("button", { name: "Trimite" }).click();
  await expect(author.getByTestId("gcs-conversation-title")).toHaveText(`Mesaj ${id}`);
  await expect(author.getByTestId("gcs-message").last().locator("a.gcs-mention")).toHaveClass(/gcs-name--member/);
  await expect.poll(() => notified(targetEmail, "forums.mention", "pm.conversation")).toBe(1);
});
