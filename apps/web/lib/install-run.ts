import "server-only";
import { gcsEdition, runInstall, type GcsInstallInput, type GcsInstallRunStep } from "@gcs/core";
import { installState } from "./install";
import { migrationsDir } from "./migrations";
import { resetServices, services } from "./services";

/**
 * Rularea instalării, comună wizard-ului (`POST /install/run`) și CLI-ului (`gcs install`).
 * Apelantul ține lock-ul de rulare. Întoarce tokenul de unică folosință pentru login-ul automat.
 */
export async function performInstall(opts: {
  input: GcsInstallInput;
  databaseUrl: string;
  external: boolean;
  onProgress: (e: { stepKey: GcsInstallRunStep; pct: number }) => void;
}): Promise<{ finishToken: string }> {
  const state = installState();
  await state.advance("run");
  const lite = gcsEdition() === "lite";
  if (lite && process.env.DATABASE_URL !== opts.databaseUrl) {
    // Ediția Lite ține cheile, cache-ul și joburile în baza de date: serviciile trec pe baza aleasă înainte de rulare.
    process.env.DATABASE_URL = opts.databaseUrl;
    await resetServices();
  }
  const { registry, cache, bus } = services();
  await runInstall(opts.input, opts.onProgress, { databaseUrl: opts.databaseUrl, migrationsDir: migrationsDir(), registry, cache, bus, state });
  if (opts.external) {
    // Baza externă devine baza aplicației: rămâne în `.env.runtime`, citit la pornire.
    await state.writeSecrets({ DATABASE_URL: opts.databaseUrl });
    process.env.DATABASE_URL = opts.databaseUrl;
  }
  // `cron.mjs` (ediția Lite) apelează `/api/cron` la adresa site-ului, citită din `.env.runtime`.
  if (lite && opts.input.site.url && !process.env.GCS_BASE_URL) {
    await state.writeSecrets({ GCS_BASE_URL: opts.input.site.url.replace(/\/+$/, "") });
    process.env.GCS_BASE_URL = opts.input.site.url.replace(/\/+$/, "");
  }
  await state.clearInstallSecrets();
  await resetServices();
  // Prima verificare online a licenței (apoi zilnic, jobul `license.check`): înregistrează instanța la Data Center.
  void services().licenseOnline.run().catch(() => {});
  return { finishToken: await state.createFinishToken(opts.input.admin.email) };
}
