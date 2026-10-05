import "server-only";
import { runInstall, type GcsInstallInput, type GcsInstallRunStep } from "@gcs/core";
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
  const { registry, cache, bus } = services();
  await runInstall(opts.input, opts.onProgress, { databaseUrl: opts.databaseUrl, migrationsDir: migrationsDir(), registry, cache, bus, state });
  if (opts.external) {
    // Baza externă devine baza aplicației: rămâne în `.env.runtime`, citit la pornire.
    await state.writeSecrets({ DATABASE_URL: opts.databaseUrl });
    process.env.DATABASE_URL = opts.databaseUrl;
  }
  await state.clearInstallSecrets();
  await resetServices();
  return { finishToken: await state.createFinishToken(opts.input.admin.email) };
}
