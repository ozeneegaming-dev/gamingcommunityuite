import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { GcsSettingsNav } from "../_components/settings/GcsSettingsNav";
import { SETTINGS_SECTIONS } from "../_components/settings/sections";

/** Setările contului (specul etapei 3, §8; etapa 5: meniu cu iconițe și secțiuni noi): doar pentru membri autentificați. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const t = await getTranslations("settings");
  return (
    <div className="gcs-settingsLayout">
      <aside>
        <h1 className="gcs-display" style={{ margin: "0 0 12px", fontSize: 26 }}>
          <GcsIcon name="fa-solid fa-gear" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <GcsSettingsNav label={t("title")} items={SETTINGS_SECTIONS.map(([s, icon]) => ({ href: `/settings/${s}`, label: t(`nav.${s}`), icon: <GcsIcon name={icon} /> }))} />
      </aside>
      <GcsCard as="section" style={{ padding: "22px 24px", minWidth: 0 }}>
        {children}
      </GcsCard>
    </div>
  );
}
