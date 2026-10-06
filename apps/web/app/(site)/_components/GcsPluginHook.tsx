import { getLocale } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pluginHost, safeModeActive } from "@/lib/plugins";

/**
 * Un punct de extensie (etapa 6, ex. `postbit.after_fields`): HTML-ul pluginurilor care îl folosesc, sanitizat și în
 * ordinea priorității din ACP → Sistem → Hook-uri. Fără pluginuri pe punct, nu face niciun apel. Motorul de șabloane va
 * folosi același punct (`{% hook "postbit.after_fields" %}`).
 */
export async function GcsPluginHook({ point, data }: { point: string; data: Record<string, string | number | null> }) {
  const plugins = await pluginHost();
  if (!plugins.hasHook(point) || (await safeModeActive())) return null;
  const [actor, locale] = await Promise.all([currentActor(), getLocale()]);
  const parts = await plugins.renderHook(point, data, { actor, locale });
  if (parts.length === 0) return null;
  return (
    <div className="gcs-pluginHook" data-hook={point}>
      {parts.map((p) => (
        // HTML-ul pluginului, trecut prin sanitizer (listă albă) de gazda pluginurilor.
        <div key={p.key} dangerouslySetInnerHTML={{ __html: p.html }} />
      ))}
    </div>
  );
}
