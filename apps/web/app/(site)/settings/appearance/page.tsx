import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { viewerTheme } from "@/lib/appearance";
import { services } from "@/lib/services";
import { GcsSkinPicker } from "../../_components/settings/GcsSkinPicker";
import { GcsAppearanceForm, GcsDisplayGroupForm } from "../../_components/settings/GcsSettingsForms";
import { resolveNameGroup } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.appearance") };
}

export default async function AppearanceSettingsPage() {
  const actor = await currentActor();
  const { db, cosmetics, themes, groupDisplay } = services();
  const t = await getTranslations("settings.appearance");
  const [user, available, allThemes, { theme: current }, displayChoices, displayInfo] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.userId! },
      select: { name: true, image: true, avatarFrameId: true, nameStyleId: true, accentColor: true, primaryGroup: { select: { key: true } } },
    }),
    cosmetics.available(actor.userId!),
    themes.list(),
    viewerTheme(),
    groupDisplay.choices(actor.userId!),
    groupDisplay.info(),
  ]);
  const activeThemes = allThemes.filter((th) => th.enabled);
  // „Grupul afișat”: grupurile membrului care permit alegerea; „Automat” arată grupul ales după prioritate.
  const selectable = displayChoices.groups.filter((g) => g.selectable);
  const autoId = resolveNameGroup(
    { primaryId: displayChoices.groups.find((g) => g.primary)?.id ?? displayChoices.current, groupIds: displayChoices.groups.filter((g) => !g.primary).map((g) => g.id) },
    displayInfo,
  );
  const keyOf = (id: number) => displayInfo.get(id)?.key ?? user.primaryGroup.key;
  const shownKey = keyOf(displayChoices.current);
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
        user={{ name: user.name, image: user.image, groupKey: shownKey }}
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
      {selectable.length > 0 && (
        <GcsDisplayGroupForm
          user={{ name: user.name }}
          groups={selectable.map((g) => ({ id: g.id, key: g.key, name: g.name }))}
          autoKey={keyOf(autoId)}
          current={displayChoices.choiceId !== null && selectable.some((g) => g.id === displayChoices.choiceId) ? displayChoices.choiceId : null}
          labels={{
            title: t("displayGroup"),
            hint: t("displayGroupHint"),
            auto: t("displayGroupAuto"),
            autoHint: t("displayGroupAutoHint"),
            save: t("displayGroupSave"),
            saved: t("saved"),
          }}
        />
      )}
    </div>
  );
}
