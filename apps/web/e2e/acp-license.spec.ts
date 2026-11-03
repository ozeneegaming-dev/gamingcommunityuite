import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enterAcpAsRoot, useFreshIp } from "./helpers";

const LICENSE_KEY = process.env.GCS_E2E_LICENSE_KEY ?? "";
const CONFIG_DIR = process.env.GCS_CONFIG_DIR ?? "";

test.skip(!LICENSE_KEY || !CONFIG_DIR, "Rulează prin e2e/run.mts (cheia licenței de test și folderul de configurare).");

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

// Instanța principală rămâne fără licență pentru celelalte teste.
test.afterAll(() => {
  for (const file of ["license.token", "license.key", "license_online.json"]) rmSync(path.join(CONFIG_DIR, file), { force: true });
});

/** O licență de test (tokenul lung), semnată cu cheia de unică folosință a rulării; ca în `install.spec.ts`. */
function license(over: Record<string, unknown> = {}): string {
  const payload = {
    v: 1,
    kid: "e2e",
    id: "lic-acp",
    licensee: "Comunitatea E2E SRL",
    domains: ["localhost"],
    package: "standard",
    apps: [],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    ...over,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(`GCS-LICENSE-V1\n${body}`, "utf8"), createPrivateKey(readFileSync(LICENSE_KEY, "utf8")));
  return `GCS1.${body}.${signature.toString("base64url")}`;
}

test("ACP › Sistem › Licență: cheia scurtă (activarea oprită aici), formatul, domeniul, apoi un token lung", async ({ page }) => {
  await enterAcpAsRoot(page, "RootLicenta", "root-licenta@example.com");
  await page.goto("/admin/system/license");
  await expect(page.getByRole("heading", { name: "Licență", level: 1 })).toBeVisible();
  await expect(page.getByTestId("gcs-license-status")).toHaveText("Nicio licență salvată pe server.");

  const form = page.getByTestId("gcs-license-change");
  const field = form.getByLabel("Cheia de licență");
  const submit = (name: string) => form.getByRole("button", { name }).click();
  await field.fill("abc");
  await submit("Activează licența");
  await expect(form.getByRole("alert")).toHaveText("Cheia nu are formatul corect.");
  // Instanțele E2E nu vorbesc cu Data Center-ul (GCS_LICENSE_SERVER=off): cheia scurtă e recunoscută, activarea nu.
  await field.fill("gcs 7kq4 m2xd 9prh");
  await submit("Activează licența");
  await expect(form.getByRole("alert")).toContainText("Activarea online e oprită");
  await field.fill(license({ domains: ["alt-forum.ro"] }));
  await submit("Activează licența");
  await expect(form.getByRole("alert")).toHaveText("Licența nu e valabilă pentru domeniul acestui site.");

  await field.fill(license({ apps: ["servers"] }));
  await submit("Activează licența");
  await expect(form.getByRole("status")).toHaveText("Salvat");
  await expect(page.getByTestId("gcs-license-status")).toContainText("Comunitatea E2E SRL");
  await expect(page.getByTestId("gcs-license-key")).toContainText("Token lung");
  await expect(page.getByTestId("gcs-license-domains")).toHaveText("localhost");
  await expect(page.getByTestId("gcs-license-apps")).toContainText("Servere");
  await expect(form.getByRole("button", { name: "Schimbă licența" })).toBeVisible();

  // Pagina „Actualizare” arată doar starea și trimite aici.
  await page.goto("/admin/system/update");
  await expect(page.getByTestId("gcs-update-license")).toContainText("Comunitatea E2E SRL");
  await page.getByRole("link", { name: "Detalii și schimbarea licenței →" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/license$/);
});
