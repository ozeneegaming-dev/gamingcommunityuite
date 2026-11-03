import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { novaSettings, patchNova, restoreNova } from "./cockpit-fixtures";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";
import { e2eKv } from "./kv";

/**
 * Submeniurile din antet (macheta aprobată „Submeniurile din antet”): itemul de pe bară cu iconița în pătratul de 40 px
 * și săgeata care se rotește, panoul cu săgeata deasupra butonului, grila de itemi (iconiță, titlu, descriere), coloana
 * linkurilor scurte (ACP › Meniu, „Link scurt”), descrierea scrisă în ACP, tastatura, mișcarea redusă și lista din
 * sertarul de pe telefon. Meniul și tema se refac după test.
 * Cu `GCS_E2E_SHOTS=<folder>`: mega-1440.png, mega-hover-1440.png, mega-375.png, acp-menu-description.png.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

async function shot(target: Page | Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
}

/** Meniul e în cache (`gcs:k:nav*`); după schimbările directe în bază îl golim. */
async function clearNavCache(): Promise<void> {
  const kv = await e2eKv();
  try {
    const keys = await kv.keys("gcs:k:nav*");
    if (keys.length > 0) await kv.del(...keys);
  } finally {
    kv.disconnect();
  }
}

/** Animațiile și tranzițiile în curs din element (și din copiii lui) s-au terminat. */
const settle = (el: Locator) => el.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => null))));

const DESKTOP = { width: 1600, height: 900 };
/**
 * Pătratele iconițelor apar doar când încap toți itemii barei (altfel bara arată doar etichetele). Meniul de test are
 * prea mulți itemi pentru asta, așa că, pe durata testului, câțiva itemi de pe primul nivel sunt opriți.
 */
const SPARE_HREFS = ["/chat", "/activity", "/leaderboard", "/vip"];
/** Subitemii Servere marcați „Link scurt” în ACP și subitemul cu descrierea scrisă acolo (refăcuți după test). */
const SHORT = ["Banuri", "Contestații"];
const DESCRIBED = "Toate serverele";
const TOUCHED_HREFS = ["/servers", "/bans", "/servers/tickets"];

/** Meniul de dinainte: fără descrierea și fără linkurile scurte puse de test, fără ciornă. */
async function restoreMenu(): Promise<void> {
  await sql(`UPDATE nav_items SET description = NULL, "shortLink" = false WHERE "parentId" IS NOT NULL AND href IN ($1, $2, $3)`, TOUCHED_HREFS);
  await sql(`DELETE FROM nav_drafts`);
  await clearNavCache();
}

/** Pornește / oprește itemii dați (după id), apoi golește cache-ul meniului. */
async function setEnabled(ids: number[], enabled: boolean): Promise<void> {
  if (ids.length === 0) return;
  await sql(`UPDATE nav_items SET enabled = $1 WHERE id IN (${ids.map((_, i) => `$${i + 2}`).join(", ")})`, [enabled, ...ids]);
  await clearNavCache();
}

/** Textul ciornei salvate (JSON-ul ei, ca text, pe ambele baze). */
async function draftText(): Promise<string> {
  const [row] = await sql<{ items: unknown }>(`SELECT items FROM nav_drafts`);
  if (!row) return "";
  return typeof row.items === "string" ? row.items : JSON.stringify(row.items);
}

test("submeniurile din antet: ACP › Meniu (descrierea, linkurile scurte), panoul la 1440, tastatura, mișcarea redusă și sertarul la 375", async ({ page, context }) => {
  test.setTimeout(300_000);
  await useFreshIp(context, "100.93.1");
  const id = uid();
  const desc = `Statusul serverelor, scris din ACP ${id}`;
  const saved = await novaSettings();
  let spare: number[] = [];
  await enterAcpAsRoot(page, `Mega${id}`, `mega-${id}@example.com`);

  try {
    await test.step("ACP › Meniu: „Link scurt” pe două subitemi Servere și o descriere proprie; Publică", async () => {
      await page.setViewportSize({ width: 1400, height: 1200 });
      await page.goto("/admin/system/menu");
      await expect(page.getByTestId("gcs-menu-tree")).toBeVisible();
      const editor = page.getByTestId("gcs-menu-editor-panel");
      const row = (label: string) => page.locator(`[data-testid="gcs-menu-row"][data-label="${label}"]`);
      for (const label of SHORT) {
        await row(label).getByTestId("gcs-menu-row-label").click();
        await expect(editor.getByTestId("gcs-menu-short")).not.toBeChecked();
        await editor.getByTestId("gcs-menu-short").check();
        await expect(row(label).getByTestId("gcs-menu-row-short")).toBeVisible();
      }
      // Pe primul nivel nu există „Link scurt” (n-are coloană în care să stea).
      await row("Servere").getByTestId("gcs-menu-row-label").click();
      await expect(editor.getByTestId("gcs-menu-short")).toHaveCount(0);

      await row(DESCRIBED).getByTestId("gcs-menu-row-label").click();
      const input = editor.getByTestId("gcs-menu-desc-input");
      // Gol, descrierea automată rămâne ca rezervă (și apare ca indiciu în câmp).
      await expect(input).toHaveValue("");
      await expect(input).toHaveAttribute("placeholder", "Status live, jucători, conectare dintr-un click");
      await input.fill(desc);
      await expect.poll(draftText, { timeout: 20_000 }).toContain(desc);
      await expect.poll(async () => (await draftText()).match(/"shortLink":\s*true/g)?.length ?? 0).toBe(SHORT.length);
      await expect(page.getByTestId("gcs-menu-state")).toHaveText("Ciornă nepublicată");
      await shot(page, "acp-menu-description");

      await page.getByTestId("gcs-menu-publish").click();
      await page.getByTestId("gcs-confirm-ok").click();
      await expect(page.getByTestId("gcs-menu-status")).toHaveText("Meniul a fost publicat.");
      const rows = await sql<{ href: string; shortLink: boolean }>(`SELECT href, "shortLink" FROM nav_items WHERE "shortLink" = true ORDER BY href`);
      expect(rows.map((r) => r.href)).toEqual(["/bans", "/servers/tickets"]);
    });

    // Iconițele în meniul principal (setarea temei), ca în machetă: pătratele de 40 px.
    spare = (await sql<{ id: number }>(`SELECT id FROM nav_items WHERE "parentId" IS NULL AND enabled = true AND href IN ($1, $2, $3, $4)`, SPARE_HREFS)).map((r) => r.id);
    await setEnabled(spare, false);
    await patchNova({ header: { navIcons: true } });
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    const nav = page.getByTestId("gcs-hb-nav");
    await expect(nav).toHaveAttribute("data-ready", "");
    const trigger = nav.getByRole("button", { name: "Servere", exact: true });
    const panel = page.getByRole("menu", { name: "Servere" });

    await test.step("itemul de pe bară: iconița în pătratul de 40 px, accentul și săgeata rotită cât e deschis", async () => {
      const square = trigger.locator(".gcs-hb__navIcon");
      await expect(square).toBeVisible();
      const box = await square.boundingBox();
      expect(Math.round(box!.width)).toBe(40);
      expect(Math.round(box!.height)).toBe(40);
      // Închis: pătratul neutru (fără gradientul de accent), săgeata în jos, eticheta în culoarea antetului.
      expect(await square.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
      const color = () => trigger.locator(".gcs-hb__navLabel").evaluate((el) => getComputedStyle(el).color);
      const closedColor = await color();
      await trigger.click();
      await expect(panel).toBeVisible();
      await settle(panel);
      await settle(trigger);
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(await square.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("gradient");
      expect(await trigger.locator(".gcs-hb__caret").evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(-1,/);
      // Deschis: eticheta în culoarea de accent.
      expect(await color()).not.toBe(closedColor);
    });

    await test.step("panoul: în ecran, cu săgeata deasupra butonului; grila cu iconiță, titlu și descriere; coloana linkurilor scurte", async () => {
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(DESKTOP.width);
      const t = (await trigger.boundingBox())!;
      const arrow = (await panel.getByTestId("gcs-mega-arrow").boundingBox())!;
      const arrowX = arrow.x + arrow.width / 2;
      expect(arrowX).toBeGreaterThanOrEqual(t.x);
      expect(arrowX).toBeLessThanOrEqual(t.x + t.width);
      // Săgeata stă pe marginea de sus a panoului, între buton și panou.
      expect(arrow.y).toBeLessThan(panelBox.y);
      expect(arrow.y + arrow.height).toBeGreaterThan(t.y + t.height);

      const cards = panel.getByTestId("gcs-mega-item");
      expect(await cards.count()).toBeGreaterThan(0);
      for (const card of await cards.all()) {
        await expect(card.locator(".gcs-mega__icon svg")).toBeVisible();
        await expect(card.locator(".gcs-mega__name")).not.toBeEmpty();
        await expect(card.getByTestId("gcs-mega-desc")).not.toBeEmpty();
      }
      // Descrierea scrisă în ACP, în locul celei automate.
      const described = cards.filter({ hasText: DESCRIBED });
      await expect(described.getByTestId("gcs-mega-desc")).toHaveText(desc);
      // Linkurile scurte: în coloana din dreapta (plăcuțe), nu și în grilă.
      const side = panel.getByTestId("gcs-mega-side");
      await expect(side.getByTestId("gcs-mega-short")).toHaveText(SHORT.map((s) => new RegExp(`^${s}`)));
      for (const s of SHORT) await expect(cards.filter({ hasText: s })).toHaveCount(0);
      const sideBox = (await side.boundingBox())!;
      expect(sideBox.x).toBeGreaterThan((await cards.first().boundingBox())!.x);
      // Deschiderea animată: panoul crește din sus, itemii intră pe rând.
      const names = await panel.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => (a as CSSAnimation).animationName ?? ""));
      expect(names).toContain("gcs-mega-open");
      expect(names).toContain("gcs-mega-item-in");
      await shot(page, "mega-1440");

      // Hover: fundalul de accent, chenarul de accent, căsuța iconiței plină.
      const hovered = cards.nth(1);
      const iconBg = (l: Locator) => l.locator(".gcs-mega__icon").evaluate((el) => getComputedStyle(el).backgroundColor);
      const before = await iconBg(hovered);
      await hovered.hover();
      await settle(hovered);
      expect(await iconBg(hovered)).not.toBe(before);
      expect(await hovered.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      await shot(page, "mega-hover-1440");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

    await test.step("tastatura: Enter / ↓ / Space deschid pe primul item, săgețile mută, Escape închide și readuce focusul", async () => {
      const items = panel.getByRole("menuitem");
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(panel).toBeVisible();
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(items.nth(2)).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(items.nth(1)).toBeFocused();
      // Ultimul item e o plăcuță din coloana din dreapta.
      await page.keyboard.press("End");
      await expect(items.last()).toBeFocused();
      await expect(items.last()).toHaveAttribute("data-testid", "gcs-mega-short");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();

      await page.keyboard.press("ArrowDown");
      await expect(panel).toBeVisible();
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await page.keyboard.press(" ");
      await expect(panel).toBeVisible();
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

    await test.step("mișcarea redusă: panoul apare direct, fără animații", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await trigger.click();
      await expect(panel).toBeVisible();
      const animations = await panel.evaluate((el) => el.getAnimations({ subtree: true }).length);
      expect(animations).toBe(0);
      expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      expect(await panel.getByTestId("gcs-mega-item").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await page.emulateMedia({ reducedMotion: null });
    });

    await test.step("telefon (375 px): submeniul e o listă în sertar, cu iconiță, titlu și descriere, fără scroll orizontal", async () => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto("/");
      await page.getByTestId("gcs-mobile-nav").click();
      const drawer = page.getByRole("dialog", { name: "Principal" });
      await expect(drawer).toBeVisible();
      const group = drawer.getByRole("button", { name: "Servere" });
      await group.click();
      await expect(group).toHaveAttribute("aria-expanded", "true");
      const link = drawer.getByRole("link", { name: DESCRIBED });
      await expect(link).toBeVisible();
      await expect(link).toHaveAccessibleDescription(desc);
      const cards = drawer.getByTestId("gcs-drawer-card").filter({ visible: true });
      expect(await cards.count()).toBeGreaterThan(1);
      for (const card of await cards.all()) {
        await expect(card.locator(".gcs-drawer__icon svg")).toBeVisible();
        await expect(card.getByTestId("gcs-drawer-desc")).toBeVisible();
      }
      // Linkurile scurte sunt și ele în listă.
      for (const s of SHORT) await expect(drawer.getByRole("link", { name: s, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(await drawer.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      const drawerBox = (await drawer.boundingBox())!;
      for (const card of await cards.all()) {
        const b = (await card.boundingBox())!;
        expect(b.x + b.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width + 0.5);
      }
      await shot(page, "mega-375");
    });
  } finally {
    await setEnabled(spare, true);
    await restoreMenu();
    await restoreNova(saved);
  }
});
