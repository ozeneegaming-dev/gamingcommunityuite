import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAppearanceForm } from "../../_components/settings/GcsSettingsForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.appearance") };
}

export default async function AppearanceSettingsPage() {
  const actor = await currentActor();
  const { db, cosmetics } = services();
  const t = await getTranslations("settings.appearance");
  const [user, available] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.userId! },
      select: { name: true, image: true, avatarFrameId: true, nameStyleId: true, accentColor: true, primaryGroup: { select: { key: true } } },
    }),
    cosmetics.available(actor.userId!),
  ]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">{t("title")}</h2>
      {available.frames.length === 0 && available.styles.length === 0 && (
        <p className="gcs-muted" data-testid="gcs-no-cosmetics">
          {t("vipHint")}
        </p>
      )}
      <GcsAppearanceForm
        user={{ name: user.name, image: user.image, groupKey: user.primaryGroup.key }}
        frames={available.frames.map((f) => ({ id: f.id, key: f.key, name: f.name }))}
        styles={available.styles.map((s) => ({ id: s.id, key: s.key, name: s.name }))}
        current={{ avatarFrameId: user.avatarFrameId, nameStyleId: user.nameStyleId, accentColor: user.accentColor }}
        labels={{
          frame: t("frame"),
          noFrame: t("noFrame"),
          style: t("style"),
          groupStyle: t("groupStyle"),
          accent: t("accent"),
          defaultAccent: t("defaultAccent"),
          save: t("save"),
          saved: t("saved"),
          preview: t("preview"),
        }}
      />
    </div>
  );
}
