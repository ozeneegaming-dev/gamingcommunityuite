import { expect, test, type Frame, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

const SAVED = "Draft salvat. Vizitatorii văd modificările doar după ce salvezi.";
const PUBLISHED = "Salvat: tema e publicată pentru toți.";

/** CSS-ul publicat al temei implicite (ce primesc vizitatorii). */
const publicCss = async (page: Page) => (await page.request.get("/gcs-theme.css?t=gcs-dark")).text();
/** Prima valoare a unei variabile din CSS-ul publicat (blocul întunecat, `html:root`). */
const cssVar = (css: string, name: string) => new RegExp(`${name}: ([^;]+);`).exec(css)?.[1] ?? null;

/** Documentul din iframe-ul previzualizării. */
async function previewFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId("gcs-studio-preview").elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("previzualizarea nu are document");
  return frame;
}

const rootVar = (frame: Frame, name: string) => frame.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(), name);

/**
 * Editorul vizual de temă (ACP → Aspect → Teme → „Editează vizual”): o culoare și un interval se văd imediat în
 * previzualizare, vizitatorii nu le văd până la „Salvează”, ieșirea cu modificări cere confirmare, iar la final tema
 * revine la valorile inițiale (alte teste se bazează pe aspectul implicit).
 */
test("editorul vizual: previzualizare live, ieșire cu confirmare, salvare și revenire", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.71.0");
  const id = uid();
  await enterAcpAsRoot(page, `Studio${id}`, `studio-${id}@example.com`);

  const before = await publicCss(page);
  expect(cssVar(before, "--gcs-header-h"), "tema implicită pornește cu antetul implicit").toBe("76px");
  expect(cssVar(before, "--gcs-accent")?.toUpperCase(), "tema implicită pornește cu accentul implicit").toBe("#DF390C");

  await page.goto("/admin/appearance/themes");
  await page.getByTestId("gcs-acp-theme-visual").first().click();
  await expect(page).toHaveURL(/\/admin\/theme-editor\/gcs-dark$/);
  await expect(page.getByTestId("gcs-theme-studio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvează și publică" })).toBeDisabled();

  // Previzualizarea: site-ul public în iframe, cu puntea editorului.
  const frame = await previewFrame(page);
  await expect(frame.getByTestId("gcs-brand")).toBeVisible();
  await expect.poll(() => rootVar(frame, "--gcs-header-h")).toBe("76PX");

  // Un interval: înălțimea antetului (Antet → Antet desktop).
  await page.getByTestId("gcs-studio-nav-header").click();
  await page.getByTestId("gcs-studio-nav-headerDesktop").click();
  await expect(page.getByTestId("gcs-studio-revert-header_height")).toHaveCount(0);
  await page.getByTestId("gcs-studio-field-header_height").fill("80");
  await expect.poll(() => rootVar(frame, "--gcs-header-h")).toBe("80PX");
  // Antetul e constructorul (în orice temă): înălțimea lui vine din rândurile lui; `--gcs-header-h` dă limita logo-ului.
  await expect(frame.getByTestId("gcs-header-builder")).toBeVisible();
  await expect(page.getByTestId("gcs-studio-revert-header_height")).toBeVisible();

  // O culoare: culoarea primară a paletei (modul întunecat), din selector.
  await page.getByTestId("gcs-studio-back").click();
  await page.getByTestId("gcs-studio-back").click();
  await page.getByTestId("gcs-studio-nav-palette").click();
  await page.getByTestId("gcs-studio-color-accent").click();
  await page.getByTestId("gcs-studio-tab-picker").click();
  await page.getByTestId("gcs-studio-hex").fill("#123456");
  await expect.poll(() => rootVar(frame, "--gcs-accent")).toBe("#123456");

  // Draft-ul se salvează singur, dar vizitatorii încă văd tema publicată.
  const status = page.getByTestId("gcs-studio-status");
  await expect(status).toHaveText(SAVED);
  expect(cssVar(await publicCss(page), "--gcs-header-h")).toBe("76px");

  // Ieșirea cu modificări nesalvate cere confirmare; „Continuă editarea” rămâne în editor.
  await page.getByTestId("gcs-studio-exit").click();
  const dialog = page.getByRole("dialog", { name: "Modificări nesalvate" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("gcs-studio-exit-stay").click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/theme-editor\/gcs-dark$/);

  // „Salvează” publică tema: CSS-ul public are valorile noi.
  await page.getByTestId("gcs-studio-save").click();
  await expect(status).toHaveText(PUBLISHED);
  const published = await publicCss(page);
  expect(cssVar(published, "--gcs-header-h")).toBe("80px");
  expect(cssVar(published, "--gcs-accent")?.toUpperCase()).toBe("#123456");

  // Revenirea la valorile implicite (butonul de lângă fiecare setare), apoi salvare.
  await page.getByTestId("gcs-studio-back").click();
  await page.getByTestId("gcs-studio-revert-color-accent").click();
  await expect.poll(() => rootVar(frame, "--gcs-accent")).toBe("#DF390C");
  await page.getByTestId("gcs-studio-back").click();
  await page.getByTestId("gcs-studio-nav-header").click();
  await page.getByTestId("gcs-studio-nav-headerDesktop").click();
  await page.getByTestId("gcs-studio-revert-header_height").click();
  await expect.poll(() => rootVar(frame, "--gcs-header-h")).toBe("76PX");
  await expect(status).toHaveText(SAVED);
  await page.getByTestId("gcs-studio-save").click();
  await expect(status).toHaveText(PUBLISHED);
  const restored = await publicCss(page);
  expect(cssVar(restored, "--gcs-header-h")).toBe("76px");
  expect(cssVar(restored, "--gcs-accent")?.toUpperCase()).toBe("#DF390C");

  // O modificare la care se renunță: „Ieși fără salvare” șterge draft-ul, tema publicată rămâne (Nova: antetul nu e fix).
  await page.getByTestId("gcs-studio-field-header_sticky").check();
  await expect(status).toHaveText(SAVED);
  await page.getByTestId("gcs-studio-exit").click();
  await page.getByTestId("gcs-studio-exit-discard").click();
  await expect(page).toHaveURL(/\/admin\/appearance\/themes$/);
  expect(await publicCss(page)).toContain("position: relative");
  await expect(page.getByTestId("gcs-acp-theme").first().getByText("Modificări nepublicate")).toHaveCount(0);
});

test("un membru fără drept ACP nu poate deschide editorul vizual", async ({ page, context }) => {
  await useFreshIp(context, "100.71.1");
  const id = uid();
  await member(page, `FaraStudio${id}`, `fara-studio-${id}@example.com`);
  const res = await page.goto("/admin/theme-editor/default");
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("gcs-theme-studio")).toHaveCount(0);
});
