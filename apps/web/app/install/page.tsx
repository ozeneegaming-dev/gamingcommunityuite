import { redirect } from "next/navigation";
import { hasInstallSession, installState, stepPath } from "@/lib/install";

export const dynamic = "force-dynamic";

/** `/install` → pasul la care a rămas instalarea (reluare după refresh sau restart). */
export default async function InstallIndexPage() {
  if (!(await hasInstallSession())) redirect("/install/code");
  const { step } = await installState().progress();
  redirect(step === "code" || step === "done" ? "/install/checks" : stepPath(step));
}
