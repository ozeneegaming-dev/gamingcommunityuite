import { GcsCard } from "@gcs/ui";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { GcsSettingsNav } from "../_components/settings/GcsSettingsNav";

const SECTIONS = ["profile", "appearance", "privacy", "ignored", "account"] as const;

/** Setările contului (specul etapei 3, §8): doar pentru membri autentificați. */
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
        <GcsSettingsNav label={t("title")} items={SECTIONS.map((s) => ({ href: `/settings/${s}`, label: t(`nav.${s}`) }))} />
      </aside>
      <GcsCard as="section" style={{ padding: "22px 24px", minWidth: 0 }}>
        {children}
      </GcsCard>
    </div>
  );
}
