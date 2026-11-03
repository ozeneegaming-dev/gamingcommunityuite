import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * Shell-ul ACP: navigația pe două niveluri (specul 2026-10-09-acp-navigatie-aplicatii §1) — bara de iconițe cu zonele,
 * coloana a doua cu toate paginile zonei, restrângerea ținută minte, sertarul de pe mobil, tastatura — și dashboard-ul
 * cu carduri KPI și graficul de activitate (etapa 6 §1.2).
 */
test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.73.0");
});

test("coloana arată paginile zonei alese, pe grupuri; pagina curentă și zona ei sunt evidențiate", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Shell${id}`, `shell-${id}@example.com`);
  const rail = page.getByRole("navigation", { name: "Zonele ACP" });
  await expect(rail.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

  // O zonă aleasă din bară: coloana îi arată toate paginile odată, pe grupuri.
  const members = rail.getByRole("button", { name: "Membri" });
  await members.click();
  await expect(members).toHaveAttribute("aria-pressed", "true");
  const column = page.getByRole("navigation", { name: "Membri", exact: true });
  await expect(column.getByRole("heading", { name: "Staff" })).toBeVisible();
  await expect(column.getByRole("link", { name: "Grupuri", exact: true })).toBeVisible();
  await expect(column.getByRole("link", { name: "Badge-uri" })).toBeVisible();

  // Tastatura: o singură oprire Tab în bară, apoi săgețile mută focusul între zone.
  await members.focus();
  await page.keyboard.press("ArrowDown");
  await expect(rail.getByRole("button", { name: "Aspect" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Aspect", exact: true }).getByRole("link", { name: "Manager meniu" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(rail.getByRole("link", { name: "Dashboard" })).toBeFocused();
  await expect(rail.locator('[data-rail-item][tabindex="0"]')).toHaveCount(1);

  await page.goto("/admin/groups");
  await expect(page.getByRole("heading", { name: "Grupuri", level: 1 })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Membri" })).toHaveAttribute("aria-current", "true");
  await expect(rail.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Membri", exact: true }).getByRole("link", { name: "Grupuri", exact: true })).toHaveAttribute("aria-current", "page");
  // Antetul paginii: breadcrumb-ul Dashboard › Membri › Grupuri.
  const crumbs = page.getByRole("navigation", { name: "Cale de navigare" });
  await expect(crumbs.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(crumbs).toContainText("Membri");

  // Moderarea stă în zona Comunitate (lângă forumuri și chat).
  await page.goto("/admin/members/moderation/queue");
  await expect(rail.getByRole("button", { name: "Comunitate" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("navigation", { name: "Comunitate", exact: true }).getByRole("link", { name: "Coadă unificată" })).toHaveAttribute("aria-current", "page");
});

test("coloana restrânsă rămâne restrânsă după reîncărcare; pe Dashboard, coloana arată ultima zonă", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Rail${id}`, `rail-${id}@example.com`);
  const sidebar = page.getByTestId("gcs-acp-sidebar");
  const toggle = page.getByTestId("gcs-acp-menu-toggle");
  const rail = page.getByRole("navigation", { name: "Zonele ACP" });
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("gcs-acp-column")).toBeHidden();
  // Bara rămâne, cu etichetele zonelor.
  await expect(rail.getByRole("button", { name: "Membri" })).toBeVisible();

  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Un click pe o zonă redeschide coloana, cu zona aleasă.
  await rail.getByRole("button", { name: "Statistici" }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(page.getByRole("navigation", { name: "Statistici", exact: true }).getByRole("link", { name: "Prezentare generală" })).toBeVisible();
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  // Dashboard-ul nu e într-o zonă: coloana arată ultima zonă aleasă, încă de la prima randare.
  await expect(page.getByTestId("gcs-acp-column")).toHaveAttribute("data-area", "stats");

  // Butonul din antetul coloanei o restrânge și el.
  await page.getByTestId("gcs-acp-column-hide").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toBeFocused();
});

test("„Sari la conținut” e primul element focusabil și duce focusul în pagină", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Skip${id}`, `skip-${id}@example.com`);
  await page.reload();
  await page.keyboard.press("Tab");
  const skip = page.getByTestId("gcs-acp-skip");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#gcs-acp-content")).toBeFocused();
});

test("pe mobil, meniul e un sertar cu bara și coloana: se deschide din hamburger și se închide cu Escape", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Drawer${id}`, `drawer-${id}@example.com`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/groups");

  const sidebar = page.getByTestId("gcs-acp-sidebar");
  const toggle = page.getByTestId("gcs-acp-menu-toggle");
  await expect(sidebar).not.toBeInViewport();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "Meniul ACP" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeInViewport();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Ambele niveluri, cu zona paginii curente deschisă.
  await expect(drawer.getByRole("navigation", { name: "Zonele ACP" })).toBeVisible();
  await expect(drawer.getByRole("navigation", { name: "Membri", exact: true }).getByRole("link", { name: "Grupuri", exact: true })).toHaveAttribute("aria-current", "page");
  // Focusul intră în sertar.
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("#gcs-acp-sidebar"))).toBe(true);
  // Altă zonă, din sertar; un link închide sertarul.
  await drawer.getByRole("button", { name: "Sistem" }).click();
  await drawer.getByRole("navigation", { name: "Sistem", exact: true }).getByRole("link", { name: "Jurnale sistem" }).click();
  await expect(page).toHaveURL(/\/admin\/logs$/);
  await expect(page.getByRole("dialog", { name: "Meniul ACP" })).toHaveCount(0);

  await toggle.click();
  await expect(page.getByRole("dialog", { name: "Meniul ACP" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Meniul ACP" })).toHaveCount(0);
  await expect(sidebar).not.toBeInViewport();
  await expect(toggle).toBeFocused();

  // Un click pe fundal închide și el sertarul.
  await toggle.click();
  await expect(page.getByRole("dialog", { name: "Meniul ACP" })).toBeVisible();
  await page.getByTestId("gcs-acp-backdrop").click({ position: { x: 370, y: 400 } });
  await expect(page.getByRole("dialog", { name: "Meniul ACP" })).toHaveCount(0);
});

test("dashboard-ul are cardurile KPI și graficul de activitate pe 30 de zile", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Kpi${id}`, `kpi-${id}@example.com`);
  for (const key of ["members", "posts", "topics", "online", "vips", "reports"]) {
    await expect(page.getByTestId(`gcs-acp-kpi-${key}`)).toBeVisible();
    await expect(page.getByTestId(`gcs-acp-kpi-${key}-value`)).toHaveText(/\d/);
  }
  await expect(page.getByTestId("gcs-acp-kpi-members").getByRole("progressbar")).toBeVisible();

  const chart = page.getByTestId("gcs-acp-area-chart");
  await expect(chart).toBeVisible();
  await expect(chart.getByRole("img", { name: "Activitate în ultimele 30 de zile" })).toBeVisible();
  // Tabelul alternativ (ascuns vizual): o zi pe rând.
  await expect(chart.locator("tbody tr")).toHaveCount(30);
  await expect(page.getByTestId("gcs-acp-spark-active")).toBeVisible();
  // Listele rapide (rezumatul e cache-uit 60 s, deci nu verificăm membrul tocmai creat).
  await expect(page.getByRole("region", { name: "Ultimii membri" })).toBeVisible();
  await expect(page.getByTestId("gcs-health-version")).toBeVisible();
});

test("Statistici → Prezentare generală arată plăcile aplicațiilor", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Stats${id}`, `stats-${id}@example.com`);
  await page.goto("/admin/stats");
  await expect(page.getByRole("heading", { name: "Prezentare generală", level: 1 })).toBeVisible();
  await expect(page.getByTestId("gcs-acp-stats-forums").locator('[data-tile="forums.topics"]')).toBeVisible();
  // Rapoartele pe perioade: pagini „în curând”, listate în aceeași zonă.
  await page.getByRole("navigation", { name: "Statistici", exact: true }).getByRole("link", { name: "Înregistrări" }).click();
  await expect(page.getByRole("heading", { name: "Înregistrări", level: 1 })).toBeVisible();
});

test("„Aplicații și pluginuri” apare o singură dată, în zona Aplicații; Sistem are grupul „Integrări”", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Apps${id}`, `apps-${id}@example.com`);
  await page.goto("/admin/system/applications");
  const rail = page.getByRole("navigation", { name: "Zonele ACP" });
  await expect(rail.getByRole("button", { name: "Aplicații" })).toHaveAttribute("aria-current", "true");
  const apps = page.getByRole("navigation", { name: "Aplicații", exact: true });
  await expect(apps.getByRole("link", { name: "Aplicații și pluginuri" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Cale de navigare" })).toContainText("Aplicații");

  await rail.getByRole("button", { name: "Sistem" }).click();
  const system = page.getByRole("navigation", { name: "Sistem", exact: true });
  await expect(system).toContainText("Integrări");
  await expect(system).not.toContainText("Aplicații și integrări");
  await expect(system.getByRole("link", { name: "Aplicații și pluginuri" })).toHaveCount(0);
});
