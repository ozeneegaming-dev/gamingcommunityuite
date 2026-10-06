import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { viewerTheme } from "@/lib/appearance";
import { services } from "@/lib/services";
import { GcsSkinPicker } from "../../_components/settings/GcsSkinPicker";
import { GcsAppearanceForm } from "../../_components/settings/GcsSettingsForms";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.appearance") };
}

export default async function AppearanceSettingsPage() {
  const actor = await currentActor();
  const { db, cosmetics, themes } = services();
  const t = await getTranslations("settings.appearance");
  const [user, available, allThemes, { theme: current }] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.userId! },
      select: { name: true, image: true, avatarFrameId: true, nameStyleId: true, accentColor: true, primaryGroup: { select: { key: true } } },
    }),
    cosmetics.available(actor.userId!),
    themes.list(),
    viewerTheme(),
  ]);
  const activeThemes = allThemes.filter((th) => th.enabled);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.appearance} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {activeThemes.length > 1 && (
        <GcsSkinPicker
          themes={activeThemes.map((th) => ({ key: th.key, name: th.name }))}
          current={current.key}
          labels={{ skin: t("skin"), saved: t("skinSaved") }}
        />
      )}
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
