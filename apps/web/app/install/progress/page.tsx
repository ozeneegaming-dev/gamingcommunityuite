import { CRON_STALE_MS, GCS_INSTALL_RUN_STEPS, gcsEdition } from "@gcs/core";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cronLastRun, liteCronCommands } from "@/lib/cron";
import { hasInstallSession, installState, stepIndex, stepPath } from "@/lib/install";
import { GcsCronPanel } from "../_components/GcsCronPanel";
import { InstallShell } from "../_components/InstallShell";
import { RunStep } from "../_components/RunStep";

export const dynamic = "force-dynamic";

/** Pasul „Instalare”: rularea propriu-zisă, cu progres live (POST /install/run, Server-Sent Events). */
export default async function InstallProgressPage() {
  if (!(await hasInstallSession())) redirect("/install/code");
  const { step, data } = await installState().progress();
  if (stepIndex(step) < stepIndex("run")) redirect(stepPath(step));
  const t = await getTranslations("install");

  // Ediția Lite: după instalare, pasul final „Cron” (comanda pentru panoul gazdei și verificarea că rulează).
  let afterDone = null;
  if (gcsEdition() === "lite") {
    const site = (data.site ?? {}) as { url?: unknown };
    const tc = await getTranslations("install.cron");
    afterDone = (
      <GcsCronPanel
        commands={liteCronCommands(typeof site.url === "string" ? site.url : null)}
        initialLastRun={step === "done" ? await cronLastRun() : null}
        staleMs={CRON_STALE_MS}
        locale={await getLocale()}
        labels={{
          title: tc("title"),
          body: tc("body"),
          schedule: tc("schedule"),
          node: tc("node"),
          curl: tc("curl"),
          copy: tc("copy"),
          copied: tc("copied"),
          check: tc("check"),
          checking: tc("checking"),
          never: tc("never"),
          lastRun: tc.raw("lastRun") as string,
          stale: tc("stale"),
        }}
      />
    );
  }

  return (
    <InstallShell step="run">
      <RunStep
        stepLabels={Object.fromEntries(GCS_INSTALL_RUN_STEPS.map((s) => [s, t(`runSteps.${s}`)]))}
        labels={{
          start: t("steps.run.start"),
          retry: t("steps.run.retry"),
          copyLog: t("steps.run.copyLog"),
          copied: t("steps.run.copied"),
          progress: t("steps.run.progress"),
          failed: t.raw("steps.run.failed") as string,
          doneTitle: t("steps.done.title"),
          doneBody: t("steps.done.body"),
          enter: t("steps.done.enter"),
          back: t("back"),
        }}
        afterDone={afterDone}
      />
    </InstallShell>
  );
}
