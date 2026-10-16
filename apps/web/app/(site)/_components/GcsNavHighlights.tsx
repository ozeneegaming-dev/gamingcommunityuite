import type { GcsActor } from "@gcs/core";
import { services } from "@/lib/services";

/** O valoare de atribut CSS sigură între ghilimele (linkurile sunt deja validate: căi interne sau http/https). */
const cssString = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, "")}"`;

/**
 * Stilul de evidențiere al itemilor de meniu (Manager meniu v2): reguli pentru linkurile itemilor marcați `accent` /
 * `glow`, oricare ar fi antetul temei (clasic, constructorul Nova, sertarul de pe mobil, dropdown-urile), fără să
 * schimbe componentele antetului. Culorile vin din tokenurile temei.
 */
export async function GcsNavHighlights({ actor, locale }: { actor: GcsActor; locale: string }) {
  const { nav, settings } = services();
  const tree = await nav.tree(actor, locale, await settings.get<string>("site.locale").catch(() => "ro")).catch(() => []);
  const marked = tree.flatMap((i) => [i, ...i.children]).filter((i) => i.highlight === "accent" || i.highlight === "glow");
  if (marked.length === 0) return null;
  const rules = marked.map((i) => {
    const sel = `:is(header, .gcs-drawer, .gcs-dropdown, .gcs-mega) a[href=${cssString(i.href)}]`;
    return i.highlight === "accent"
      ? `${sel}{color:var(--gcs-accentInk,var(--gcs-accent));background-color:color-mix(in srgb,var(--gcs-accent) 16%,transparent);border-radius:8px}`
      : `${sel}{color:var(--gcs-accentInk,var(--gcs-accent));text-shadow:0 0 10px color-mix(in srgb,var(--gcs-accent) 70%,transparent)}`;
  });
  return <style data-gcs-nav-highlights="">{rules.join("\n")}</style>;
}
