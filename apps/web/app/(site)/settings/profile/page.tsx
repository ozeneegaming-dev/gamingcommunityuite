import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsImageSetting, GcsProfileFieldsForm } from "../../_components/settings/GcsProfileSettings";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.profile") };
}

export default async function ProfileSettingsPage() {
  const actor = await currentActor();
  const { db, profiles, permissions } = services();
  const t = await getTranslations("settings.profile");
  const [user, fields, values, canCover, animated] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { name: true, bio: true, image: true, coverAttachmentId: true, coverPositionY: true } }),
    profiles.fields(),
    db.profileFieldValue.findMany({ where: { userId: actor.userId! }, include: { field: { select: { key: true } } } }),
    permissions.can(actor, "profile.cover"),
    permissions.can(actor, "profile.animated_cover"),
  ]);
  const labels = {
    bio: t("bio"),
    bioHint: t("bioHint"),
    save: t("save"),
    saved: t("saved"),
    choose: t("choose"),
    about: t("about"),
    games: t("games"),
    avatar: t("avatar"),
    cover: animated ? t("coverAnimated") : t("cover"),
    upload: t("upload"),
    remove: t("remove"),
    position: t("position"),
    coverDenied: t("coverDenied"),
  };
  const accept = "image/png,image/jpeg,image/webp,image/gif";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.profile} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <GcsImageSetting kind="avatar" name={user.name} url={user.image} positionY={50} allowed accept={accept} labels={labels} />
        <GcsImageSetting
          kind="cover"
          name={user.name}
          url={user.coverAttachmentId ? `/files/${user.coverAttachmentId}` : null}
          positionY={user.coverPositionY}
          allowed={canCover}
          accept={accept}
          labels={labels}
        />
      </div>
      <GcsProfileFieldsForm
        fields={fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, maxLength: f.maxLength, section: f.section, optionImages: (f.optionImages ?? {}) as Record<string, string> }))}
        values={Object.fromEntries(values.map((v) => [v.field.key, v.value]))}
        bio={user.bio}
        labels={labels}
      />
    </div>
  );
}
