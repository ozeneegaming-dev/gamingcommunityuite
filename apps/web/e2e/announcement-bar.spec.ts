import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, setSetting, useFreshIp } from "./helpers";

/**
 * Bara de anunț v2 (macheta „Bara de anunț v2”, proprietarul: „nu funcționează și are prea puține setări”): bara stă
 * unde o pune adminul (sus deasupra antetului, sub antet, în pagină, jos fixă), arată textul scurt pe telefon și doar pe
 * dispozitivele alese, închisă rămâne închisă până la o versiune nouă sau până trec zilele de reapariție, iar afișările,
 * click-urile și închiderile se văd în ACP.
 *
 * Barele se scriu direct în setare doar cu câmpurile care contează: cele lipsă primesc valorile implicite (aceeași
 * citire ca pentru configurațiile vechi).
 */
const SETTING = "announcement.bars";
const config = (bars: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({ rotateSeconds: 8, multiple: "rotate", transition: "none", order: "list", pauseOnHover: true, dots: true, stats: true, ...over, bars });
const bar = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  enabled: true,
  label: "ANUNȚ",
  text: `Bara ${id}`,
  cta: null,
  link: null,
  guests: true,
  members: true,
  groups: [],
  startsAt: null,
  endsAt: null,
  dismissible: true,
  version: 1,
  position: "page",
  fullWidth: true,
  ...over,
});

async function guestPage(context: BrowserContext, ip: string): Promise<Page> {
  await useFreshIp(context, ip);
  return context.newPage();
}

test.afterEach(async () => {
  await resetSetting(SETTING);
});

test("pozițiile: sus deasupra antetului, sub antet, în pagină, jos fixă; textul scurt și dispozitivele pe telefon", async ({ context }) => {
  const id = uid();
  await setSetting(
    SETTING,
    config([
      bar(`t${id}`, { position: "top", sticky: true, text: `**Cupa ${id}** sus`, mobileText: `Scurt ${id}` }),
      bar(`u${id}`, { position: "under", fullWidth: false, preset: "info", text: `Sub antet ${id}` }),
      bar(`p${id}`, { position: "page", devices: "desktop", text: `În pagină ${id}` }),
      bar(`b${id}`, { position: "bottom", preset: "warning", text: `Jos ${id}` }),
    ]),
  );
  const page = await guestPage(context, "100.95.1");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("gcs-ann-slot-top")).toContainText(`Cupa ${id}`);
  await expect(page.getByTestId("gcs-ann-slot-top").locator("strong")).toHaveText(`Cupa ${id}`);
  await expect(page.getByTestId("gcs-ann-slot-under")).toContainText(`Sub antet ${id}`);
  await expect(page.getByTestId("gcs-ann-slot-page")).toContainText(`În pagină ${id}`);
  await expect(page.getByTestId("gcs-ann-slot-bottom")).toContainText(`Jos ${id}`);

  const places = await page.evaluate(() => {
    const one = (s: string) => document.querySelector<HTMLElement>(s)!;
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const header = one(".gcs-hb, .gcs-siteHeader");
    const main = one("main.gcs-siteMain");
    const footer = one('[data-testid="gcs-site-footer"]');
    const top = one('[data-testid="gcs-ann-slot-top"]');
    const under = one('[data-testid="gcs-ann-slot-under"]');
    const inPage = one('[data-testid="gcs-ann-slot-page"]');
    const bottom = one('[data-testid="gcs-ann-slot-bottom"]');
    return {
      topBeforeHeader: after(top, header) && !header.contains(top) && !main.contains(top),
      topSticky: getComputedStyle(top).position,
      underAfterHeader: after(header, under) && after(under, main) && !header.contains(under),
      underBoxed: under.querySelector(".gcs-annBar--boxed") !== null,
      pageInMain: main.contains(inPage),
      bottomAfterFooter: after(footer, bottom),
      bottomFixed: getComputedStyle(bottom).position,
      topFullWidth: Math.round(top.getBoundingClientRect().width) === document.documentElement.clientWidth,
    };
  });
  expect(places).toEqual({ topBeforeHeader: true, topSticky: "sticky", underAfterHeader: true, underBoxed: true, pageInMain: true, bottomAfterFooter: true, bottomFixed: "fixed", topFullWidth: true });

  // Pe telefon: textul scurt în locul celui lung; bara „doar desktop” dispare.
  await page.setViewportSize({ width: 375, height: 812 });
  const top = page.getByTestId("gcs-ann-slot-top");
  await expect(top.getByText(`Scurt ${id}`)).toBeVisible();
  await expect(top.getByText(`Cupa ${id}`)).toBeHidden();
  await expect(page.getByTestId("gcs-ann-slot-page")).toHaveCount(0);
  // Fără scroll orizontal din cauza barelor.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("închiderea: rămâne închisă la reîncărcare, reapare la o versiune nouă și după zilele de reapariție", async ({ context, baseURL }) => {
  const id = uid();
  const barId = `d${id}`;
  await setSetting(SETTING, config([bar(barId, { text: `Mentenanță ${id}`, reappearDays: 0 })]));
  const page = await guestPage(context, "100.95.2");
  await page.goto("/");
  const ann = page.getByTestId("gcs-ann-bar").filter({ hasText: `Mentenanță ${id}` });
  await expect(ann).toBeVisible();
  await ann.getByTestId("gcs-ann-dismiss").click();
  await expect(ann).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("gcs-forum-index")).toBeVisible();
  await expect(page.getByTestId("gcs-ann-bar").filter({ hasText: `Mentenanță ${id}` })).toHaveCount(0);

  // Bara schimbată în ACP (versiunea 2): o vede din nou și cine o închisese.
  await setSetting(SETTING, config([bar(barId, { text: `Mentenanță ${id} mutată`, version: 2, reappearDays: 0 })]));
  await page.reload();
  await expect(page.getByTestId("gcs-ann-bar").filter({ hasText: `Mentenanță ${id} mutată` })).toBeVisible();

  // Reapariția după 1 zi: o închidere de acum 2 zile nu mai ascunde bara; una de azi, da.
  await setSetting(SETTING, config([bar(barId, { text: `Mentenanță ${id} mutată`, version: 2, reappearDays: 1 })]));
  const day = Math.floor(Date.now() / 86_400_000);
  await context.addCookies([{ name: "gcs-ann", value: encodeURIComponent(`guest~${barId}~2~${day - 2}`), url: baseURL! }]);
  await page.reload();
  await expect(page.getByTestId("gcs-ann-bar").filter({ hasText: `Mentenanță ${id} mutată` })).toBeVisible();
  await context.addCookies([{ name: "gcs-ann", value: encodeURIComponent(`guest~${barId}~2~${day}`), url: baseURL! }]);
  await page.reload();
  await expect(page.getByTestId("gcs-forum-index")).toBeVisible();
  await expect(page.getByTestId("gcs-ann-bar").filter({ hasText: `Mentenanță ${id} mutată` })).toHaveCount(0);
});

test("statisticile: afișarea, click-ul și închiderea se numără și apar în ACP, cu resetarea", async ({ browser, page, context }) => {
  test.setTimeout(120_000);
  const id = uid();
  const barId = `s${id}`;
  await setSetting(SETTING, config([bar(barId, { text: `Turneu ${id}`, cta: { label: "Vezi membrii", href: "/members", style: "white", newTab: false } })]));

  const guestContext = await browser.newContext();
  const guest = await guestPage(guestContext, "100.95.3");
  const event = (name: string) => guest.waitForResponse((r) => r.url().includes("/api/announcement/event") && (r.request().postDataJSON() as { event?: string } | null)?.event === name);
  const viewed = event("view");
  await guest.goto("/");
  expect((await viewed).status()).toBe(204);
  const ann = guest.getByTestId("gcs-ann-bar").filter({ hasText: `Turneu ${id}` });
  const clicked = event("click");
  await ann.getByTestId("gcs-ann-cta").click();
  expect((await clicked).status()).toBe(204);
  await expect(guest).toHaveURL(/\/members/);
  const dismissed = event("dismiss");
  await guest.getByTestId("gcs-ann-bar").filter({ hasText: `Turneu ${id}` }).getByTestId("gcs-ann-dismiss").click();
  expect((await dismissed).status()).toBe(204);
  await guestContext.close();

  await useFreshIp(context, "100.95.4");
  await enterAcpAsRoot(page, `Anunt${id}`, `ann-stats-${id}@example.com`);
  await page.goto("/admin/appearance/announcement-bar");
  const row = page.locator(`[data-testid="gcs-ann-row"][data-bar="${barId}"]`);
  await expect(row.getByTestId("gcs-ann-status-chip")).toHaveAttribute("data-status", "active");
  await row.getByTestId("gcs-ann-row-open").click();
  const panel = page.getByTestId("gcs-ann-editor-bar");
  await expect(panel).toHaveAttribute("data-bar", barId);
  // Previzualizarea arată bara în poziția ei („în pagină”).
  await expect(panel.getByTestId("gcs-ann-preview")).toHaveAttribute("data-position", "page");
  await panel.getByTestId("gcs-ann-sec-behaviour").click();
  await expect(panel.getByTestId("gcs-ann-stat-views")).toHaveText("1");
  await expect(panel.getByTestId("gcs-ann-stat-clicks")).toHaveText("1");
  await expect(panel.getByTestId("gcs-ann-stat-dismissals")).toHaveText("1");
  await panel.getByTestId("gcs-ann-stats-reset").click();
  await expect(panel.getByTestId("gcs-ann-stat-views")).toHaveText("0");

  // Poziția aleasă în panou se salvează (și previzualizarea o urmează).
  await panel.getByTestId("gcs-ann-sec-position").click();
  await panel.getByTestId("gcs-ann-pos-under").click();
  await expect(panel.getByTestId("gcs-ann-preview")).toHaveAttribute("data-position", "under");
  await panel.getByTestId("gcs-ann-save").click();
  await expect(panel.getByTestId("gcs-ann-status")).toHaveText("Barele de anunț au fost salvate.");
  await page.goto("/");
  await expect(page.getByTestId("gcs-ann-slot-under")).toContainText(`Turneu ${id}`);
});
