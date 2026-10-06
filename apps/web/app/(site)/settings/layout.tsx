import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { GcsSettingsNav } from "../_components/settings/GcsSettingsNav";

/** Secțiunile setărilor, cu iconițele lor (etapa 5). */
const SECTIONS = [
  ["profile", "fa-solid fa-user"],
  ["appearance", "fa-solid fa-palette"],
  ["language", "fa-solid fa-language"],
  ["signature", "fa-solid fa-signature"],
  ["privacy", "fa-solid fa-user-shield"],
  ["notifications", "fa-solid fa-bell"],
  ["security", "fa-solid fa-shield-halved"],
  ["ignored", "fa-solid fa-user-slash"],
  ["account", "fa-solid fa-gear"],
] as const;

/** Setările contului (specul etapei 3, §8; etapa 5: meniu cu iconițe și secțiuni noi): doar pentru membri autentificați. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const t = await getTranslations("settings");
  return (
    <div className="gcs-settingsLayout">
      <aside>
        <h1 className="gcs-display" style={{ margin: "0 0 12px", fontSize: 26 }}>
          {t("title")}
        </h1>
        <GcsSettingsNav label={t("title")} items={SECTIONS.map(([s, icon]) => ({ href: `/settings/${s}`, label: t(`nav.${s}`), icon: <GcsIcon name={icon} /> }))} />
      </aside>
      <GcsCard as="section" style={{ padding: "22px 24px", minWidth: 0 }}>
        {children}
      </GcsCard>
    </div>
  );
}
