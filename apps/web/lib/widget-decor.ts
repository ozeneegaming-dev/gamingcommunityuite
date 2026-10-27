import "server-only";
import type { GcsWidgetDecor } from "@gcs/core";
import { safeModeActive } from "./plugins";
import { services } from "./services";

/**
 * Aspectul benzii de titlu a unui widget (Aspect forumuri): stilul și eticheta din valorile extensiilor salvate în
 * configurarea amplasării. În modul sigur pluginurile nu contribuie nimic.
 */
export async function widgetDecor(config: Record<string, unknown>): Promise<GcsWidgetDecor> {
  return services().widgets.decor(config, { plugins: !(await safeModeActive()) });
}
