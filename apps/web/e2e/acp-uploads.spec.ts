import { expect, test } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Popupul de încărcare al sistemului în ACP (în locul câmpurilor de fișier ale browserului): verificările dinainte de
 * trimitere (tipul după conținut, mărimea), fișierul ales trimis cu formularul (importul CSV al membrilor) și
 * încărcarea în masă din popup, cu lista verificărilor pe fișier (imaginile hărților).
 */

// O imagine PNG validă de 120 × 40 px.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.97.6");
});

test("importul CSV al membrilor: fișierul ales în popup (un tip greșit e oprit) pleacă odată cu formularul", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `UpCsv${id}`, `upcsv-${id}@example.com`);
  await page.goto("/admin/members");
  await page.getByTestId("gcs-member-import-open").click();
  const form = page.getByTestId("gcs-member-import");
  await form.getByTestId("gcs-member-import-file-open").click();
  const dialog = page.getByTestId("gcs-member-import-file-dialog");
  // O imagine nu e un CSV: verificarea tipului o oprește înainte de orice trimitere.
  await page.getByTestId("gcs-member-import-file-pick").setInputFiles({ name: "poza.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.locator('[data-check="errType"]')).toBeVisible();
  await expect(page.getByTestId("gcs-member-import-file-use")).toBeDisabled();

  const csv = ["name,email,password,group", `Csv${id},csv-${id}@example.com,parola-buna-1,`].join("\n");
  await page.getByTestId("gcs-member-import-file-pick").setInputFiles({ name: `membri-${id}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(dialog.locator('[data-check="okType"]')).toBeVisible();
  await page.getByTestId("gcs-member-import-file-use").click();
  await expect(dialog).toBeHidden();
  await expect(form.getByTestId("gcs-member-import-file")).toContainText(`membri-${id}.csv`);
  await form.getByRole("button", { name: "Importă" }).click();
  await expect(form.getByTestId("gcs-member-import-report")).toContainText("1 membru creat");
  const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE name = $1`, [`Csv${id}`]);
  expect(row!.n).toBe(1);
});

test("imaginile hărților: mai multe fișiere odată în popup, cele greșite se sar, cele bune se încarcă cu progres", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `UpMap${id}`, `upmap-${id}@example.com`);
  await page.goto("/admin/gaming/server-maps");
  const upload = page.getByTestId("gcs-map-upload");
  await upload.getByTestId("gcs-map-upload-files-open").click();
  await page.getByTestId("gcs-map-upload-files-pick").setInputFiles([
    { name: `de_up${id}.png`, mimeType: "image/png", buffer: PNG },
    { name: `de_rupt${id}.png`, mimeType: "image/png", buffer: Buffer.from("nu e o imagine") },
  ]);
  const list = page.getByTestId("gcs-map-upload-files-list");
  await expect(list.locator("li")).toHaveCount(2);
  await expect(list.locator('[data-check="ok"]')).toContainText(`de_up${id}.png`);
  await expect(list.locator('[data-check="errReal"]')).toContainText(`de_rupt${id}.png`);
  await page.getByTestId("gcs-map-upload-files-use").click();
  await expect(page.getByTestId("gcs-map-upload-result")).toContainText("1 imagine salvată.");
  await expect(page.getByTestId("gcs-map-upload-files-dialog")).toBeHidden();
  const maps = await sql<{ name: string; source: string | null }>(`SELECT name, source::text AS source FROM game_maps WHERE name IN ($1, $2)`, [`de_up${id}`, `de_rupt${id}`]);
  expect(maps).toEqual([{ name: `de_up${id}`, source: "UPLOAD" }]);
});
