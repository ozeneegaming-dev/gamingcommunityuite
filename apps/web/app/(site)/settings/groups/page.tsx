import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { GcsGroupLink } from "@/lib/group-pills";
import { services } from "@/lib/services";
import { GcsOptInGroups } from "../../_components/settings/GcsOptInGroups";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.groups") };
}

/** Setări → Grupuri (Membri v2): grupurile publice în care membrul intră și din care iese singur. */
export default async function GroupsSettingsPage() {
  const actor = await currentActor();
  const t = await getTranslations("settings.groups");
  const groups = await services().optInGroups.list(actor.userId!);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.groups} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      {groups.length === 0 ? (
        <p className="gcs-muted" data-testid="gcs-optin-empty">
          {t("empty")}
        </p>
      ) : (
        <GcsOptInGroups groups={groups.map((g) => ({ id: g.id, name: g.name, joined: g.joined, canLeave: g.canLeave, primary: g.primary, pill: <GcsGroupLink groupId={g.id} /> }))} />
      )}
    </div>
  );
}
