import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

/**
 * Shell-ul ACP din etapa 6 (§1.1–1.2): sidebar-ul pe grupuri pliabile, intrarea curentă evidențiată, restrângerea
 * la iconițe ținută minte, sertarul de pe mobil și dashboard-ul cu carduri KPI și graficul de activitate.
 */
test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.73.0");
});

test("grupurile din sidebar se deschid și se închid; intrarea curentă e evidențiată, cu grupul ei deschis", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Shell${id}`, `shell-${id}@example.com`);
  const nav = page.getByRole("navigation", { name: "Aplicații ACP" });
  const members = nav.getByRole("button", { name: "Membri" });

  await expect(members).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Grupuri", exact: true })).toHaveCount(0);
  await members.click();
  await expect(members).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Grupuri", exact: true })).toBeVisible();
  await members.click();
  await expect(members).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Grupuri", exact: true })).toHaveCount(0);

  // Din tastatură: Enter pe grup îl deschide.
  await nav.getByRole("button", { name: "Comunitate" }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "Comunitate" })).toHaveAttribute("aria-expanded", "true");

  await page.goto("/admin/groups");
  await expect(page.getByRole("heading", { name: "Grupuri", level: 1 })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Membri" })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Grupuri", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");
  // Antetul paginii: breadcrumb-ul Dashboard › Membri › Grupuri.
  const crumbs = page.getByRole("navigation", { name: "Cale de navigare" });
  await expect(crumbs.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(crumbs).toContainText("Membri");
});

test("sidebar-ul restrâns la iconițe rămâne restrâns după reîncărcare", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Rail${id}`, `rail-${id}@example.com`);
  const sidebar = page.getByTestId("gcs-acp-sidebar");
  const toggle = page.getByTestId("gcs-acp-menu-toggle");
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await toggle.click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Etichetele rămân numele accesibile ale butoanelor (vizual apar ca tooltip-uri).
  await expect(page.getByRole("navigation", { name: "Aplicații ACP" }).getByRole("button", { name: "Membri" })).toBeAttached();

  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Un click pe un grup readuce sidebar-ul la lățimea întreagă, cu grupul deschis.
  await page.getByRole("navigation", { name: "Aplicații ACP" }).getByRole("button", { name: "Membri" }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect(page.getByRole("navigation", { name: "Aplicații ACP" }).getByRole("link", { name: "Grupuri", exact: true })).toBeVisible();
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
});

test("pe mobil, meniul e un sertar: se deschide din hamburger și se închide cu Escape", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `Drawer${id}`, `drawer-${id}@example.com`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  const sidebar = page.getByTestId("gcs-acp-sidebar");
  const toggle = page.getByTestId("gcs-acp-menu-toggle");
  await expect(sidebar).not.toBeInViewport();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "Meniul ACP" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeInViewport();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Focusul intră în sertar.
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("#gcs-acp-sidebar"))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
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
