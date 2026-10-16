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

/**
 * Setări → Editează profilul (setările contului v2): avatarul și coperta, apoi câmpurile pe grupurile din ACP (cu textele
 * de ajutor), ziua de naștere în grupul „De bază” (anul opțional) și contactele (doar handle-ul).
 */
export default async function ProfileSettingsPage() {
  const actor = await currentActor();
  const { db, profiles, permissions, profileFields } = services();
  const t = await getTranslations("settings.profile");
  const [user, fields, values, canCover, animated, groups, servers] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.userId! },
      select: { name: true, bio: true, image: true, coverAttachmentId: true, coverPositionY: true, birthday: true, birthdayVisible: true, birthdayShowYear: true },
    }),
    profiles.fields(),
    db.profileFieldValue.findMany({ where: { userId: actor.userId! }, include: { field: { select: { key: true } } } }),
    permissions.can(actor, "profile.cover"),
    permissions.can(actor, "profile.animated_cover"),
    profileFields.groups(),
    profiles.serverOptions(),
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
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(t("locale"), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, i, 1))));
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
        fields={fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          options: f.options,
          required: f.required,
          maxLength: f.maxLength,
          section: f.section,
          optionImages: (f.optionImages ?? {}) as Record<string, string>,
          groupId: f.groupId,
          helper: f.helper,
          linkTemplate: f.linkTemplate,
          position: f.position,
        }))}
        groups={groups.map((g) => ({ id: g.id, key: g.key, label: g.label, helper: g.helper, icon: g.icon, position: g.position }))}
        servers={servers}
        values={Object.fromEntries(values.map((v) => [v.field.key, v.value]))}
        // Câmpurile „Text lung”: documentul din editor (lipsă = textul vechi, deschis ca paragrafe).
        docs={Object.fromEntries(values.filter((v) => v.json !== null).map((v) => [v.field.key, v.json]))}
        bio={user.bio}
        birthday={{
          date: user.birthday ? user.birthday.toISOString().slice(0, 10) : null,
          visible: user.birthdayVisible,
          showYear: user.birthdayShowYear,
          labels: {
            title: t("birthday"),
            day: t("birthdayDay"),
            month: t("birthdayMonth"),
            year: t("birthdayYear"),
            yearHint: t("birthdayYearHint"),
            visible: t("birthdayVisible"),
            showYear: t("birthdayShowYear"),
            hint: t("birthdayHint"),
            months,
          },
        }}
        labels={labels}
      />
    </div>
  );
}
