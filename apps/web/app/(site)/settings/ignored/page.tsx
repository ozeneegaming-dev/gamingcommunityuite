import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsIgnoredForm } from "../../_components/settings/GcsSettingsForms";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";
import { nameKeyOf, nameKeySelect } from "@gcs/modules";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.ignored") };
}

export default async function IgnoredSettingsPage() {
  const actor = await currentActor();
  const t = await getTranslations("settings.ignored");
  const rows = await services().db.userIgnore.findMany({
    where: { userId: actor.userId! },
    include: { ignored: { select: { id: true, name: true, ...nameKeySelect } } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.ignored} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("intro")}
      </p>
      <GcsIgnoredForm
        ignored={rows.map((r) => ({ id: r.ignored.id, name: r.ignored.name, nameKey: nameKeyOf(r.ignored), posts: r.posts, messages: r.messages }))}
        labels={Object.fromEntries(["saved", "name", "posts", "messages", "add", "empty", "remove"].map((k) => [k, t(k)]))}
      />
    </div>
  );
}
