import { expect, test } from "@playwright/test";
import { novaSettings, patchNova, preset, restoreNova } from "./cockpit-fixtures";
import { useFreshIp } from "./helpers";

/**
 * Meniul principal al antetului construit, pe ecranele late: pătratele iconițelor nu scot itemi de pe bară. Antetul are
 * lățimea limitată, deci și la 1920 px meniul împărțit Esports poate să nu încapă cu iconițe: atunci ambele jumătăți
 * arată doar etichetele, iar în „Mai mult” trece doar ce nu încape nici așa. O alegere „Navigație (dreapta)” cu id-uri
 * care nu mai există (de dinainte de o salvare a meniului) revine la împărțirea automată, în loc să golească dreapta.
 */
test("antetul Esports la 1920 și 1600 px: iconițele nu scot itemi de pe bară; partea dreaptă nu rămâne goală", async ({ page, context }) => {
  await useFreshIp(context, "100.93.7");
  const saved = await novaSettings();
  try {
    const layout = { ...((await preset("esports")) as Record<string, unknown>), split: [999_998, 999_999] };
    await patchNova({ header: { layout, navIcons: true } });
    for (const width of [1920, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const left = page.getByTestId("gcs-hb-nav");
      const right = page.getByTestId("gcs-hb-nav-right");
      await expect(left).toHaveAttribute("data-ready", "");
      await expect(right).toHaveAttribute("data-ready", "");
      expect(await right.locator(":scope > [data-nav-item]").count()).toBeGreaterThan(0);

      const state = await page.locator(".gcs-hb__navBar").evaluateAll((bars) => {
        const icons = bars.flatMap((bar) => [...bar.querySelectorAll(":scope > :not([aria-hidden]) .gcs-hb__nav > .gcs-hb__navIcon")]);
        return {
          hidden: bars.reduce((n, bar) => n + bar.querySelectorAll(':scope > [data-nav-item][aria-hidden="true"]').length, 0),
          iconsShown: icons.map((i) => getComputedStyle(i).display !== "none"),
        };
      });
      // Iconițele: pe ambele jumătăți sau pe niciuna.
      expect(new Set(state.iconsShown).size, `${width}px`).toBeLessThanOrEqual(1);
      // Un item a trecut în „Mai mult” doar dacă bara arată deja numai etichetele.
      if (state.hidden > 0) expect(state.iconsShown.includes(true), `${width}px: ${state.hidden} itemi ascunși cu iconițele încă vizibile`).toBe(false);
    }
  } finally {
    await restoreNova(saved);
  }
});
