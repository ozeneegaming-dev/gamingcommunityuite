import { GCS_INSTALL_RUN_STEPS } from "@gcs/core";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasInstallSession, installState, stepIndex, stepPath } from "@/lib/install";
import { InstallShell } from "../_components/InstallShell";
import { RunStep } from "../_components/RunStep";

export const dynamic = "force-dynamic";

/** Pasul „Instalare”: rularea propriu-zisă, cu progres live (POST /install/run, Server-Sent Events). */
export default async function InstallProgressPage() {
  if (!(await hasInstallSession())) redirect("/install/code");
  const { step } = await installState().progress();
  if (stepIndex(step) < stepIndex("run")) redirect(stepPath(step));
  const t = await getTranslations("install");

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
      />
    </InstallShell>
  );
}
