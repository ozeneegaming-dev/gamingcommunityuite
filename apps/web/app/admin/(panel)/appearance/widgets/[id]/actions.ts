"use server";

import { WIDGETS_ACP_SECTION, type GcsResult } from "@gcs/core";
import { runAcpAction } from "@/lib/acp-actions";
import { forumExtOptions } from "@/lib/forum-ext-options";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";

/** Un tab de aspect al unui widget (Aspect forumuri): valorile din formular, validate și salvate în amplasare. */
export async function saveWidgetAspect(placementId: number, extension: string, tab: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(WIDGETS_ACP_SECTION, "edit", async (actor) => {
    const values: Record<string, unknown> = {};
    for (const [key, value] of fd.entries()) if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
    const { widgets } = services();
    const plugins = !(await safeModeActive());
    const placement = await widgets.placement(placementId);
    const view = placement ? (await widgets.editTabs(placement.config, { plugins })).find((x) => x.extension === extension && x.tab.key === tab) : undefined;
    const options = Object.fromEntries(Object.entries(await forumExtOptions(view?.tab.fields ?? [])).map(([k, list]) => [k, list.map((o) => o.value)]));
    await widgets.saveExtension(actor, { placementId, extension, tab, values, options }, { plugins });
    return null;
  });
}
