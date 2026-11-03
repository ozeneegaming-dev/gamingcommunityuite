import { GCS_RICH_FIELDS } from "@gcs/core";
import { GcsBadgeArt, GcsCard } from "@gcs/ui";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsRichTextInput } from "@/app/(site)/_components/editor/GcsRichTextInput";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { awardBadge, extendVip, grantVip, revokeBadge, revokeVip, staffResetImage, staffSaveProfile } from "./actions";

function Section({ title, icon, children, testId }: { title: string; icon: string; children: ReactNode; testId: string }) {
  // `id` = ținta legăturilor „Administrează” din cardurile Insigne și VIP ale prezentării.
  return (
    <GcsCard as="section" aria-label={title} data-testid={testId} id={testId} className="gcs-mpCard">
      <div className="gcs-acpWidget__header gcs-mpCard__head">
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={icon} />
          {title}
        </h2>
      </div>
      <div className="gcs-mpCard__body">{children}</div>
    </GcsCard>
  );
}

/**
 * Fișa membrului în ACP, tabul „Profil” (etapa 3, §9): profilul editat de staff în stânga, insignele și VIP-ul în
 * dreapta (pe ecrane înguste, una sub alta).
 */
export async function MemberProfileSections({ userId }: { userId: string }) {
  const t = await getTranslations("acp.memberProfile");
  const format = await getFormatter();
  const { db, profiles, vip } = services();
  const [user, fields, values, userBadges, badges, vipGroups, active, [history]] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { bio: true, image: true, coverAttachmentId: true } }),
    profiles.fields(),
    db.profileFieldValue.findMany({ where: { userId }, include: { field: { select: { key: true } } } }),
    db.userBadge.findMany({ where: { userId }, include: { badge: true, }, orderBy: { createdAt: "asc" } }),
    db.badge.findMany({ orderBy: { position: "asc" } }),
    db.group.findMany({ where: { isVip: true }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    vip.active(userId),
    vip.history({ userId, page: 1, perPage: 20 }),
  ]);
  const valueOf = new Map(values.map((v) => [v.field.key, v.value]));
  // „Text lung”: documentul din editor (lipsă = textul vechi, deschis ca paragrafe).
  const docOf = new Map(values.filter((v) => v.json !== null).map((v) => [v.field.key, v.json]));
  const owned = new Set(userBadges.map((b) => b.badgeId));

  return (
    <div className="gcs-mpProfile">
      <Section title={t("profileTitle")} icon="fa-solid fa-id-card" testId="gcs-acp-member-profile">
        <GcsActionForm action={staffSaveProfile.bind(null, userId)} submitLabel={t("save")} submitKind="save">
          <label className="gcs-field">
            {t("bio")}
            <input className="gcs-input" name="bio" defaultValue={user.bio} maxLength={160} />
          </label>
          {fields.map((f) =>
            f.type === "TEXTAREA" ? (
              <div key={f.key} className="gcs-field">
                <span id={`gcs-acp-field-${f.key}-label`}>{f.label}</span>
                <GcsRichTextInput
                  name={`fieldDoc:${f.key}`}
                  id={`gcs-acp-field-${f.key}`}
                  initial={docOf.get(f.key) ?? valueOf.get(f.key) ?? ""}
                  allow={GCS_RICH_FIELDS.profileText}
                  maxLength={f.maxLength}
                  compact
                  labelledBy={`gcs-acp-field-${f.key}-label`}
                />
              </div>
            ) : (
              <label key={f.key} className="gcs-field">
                {f.label}
                {f.type === "SELECT" ? (
                  <select className="gcs-input" name={`field:${f.key}`} defaultValue={valueOf.get(f.key) ?? ""}>
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="gcs-input" name={`field:${f.key}`} defaultValue={valueOf.get(f.key) ?? ""} maxLength={f.maxLength} />
                )}
              </label>
            ),
          )}
        </GcsActionForm>
        <div className="gcs-mpInline">
          {user.image && (
            <GcsActionForm action={staffResetImage.bind(null, userId, "avatar")} submitLabel={t("resetAvatar")} submitKind="reset" variant="ghost" compact confirm={t("confirmReset")}>
              {null}
            </GcsActionForm>
          )}
          {user.coverAttachmentId && (
            <GcsActionForm action={staffResetImage.bind(null, userId, "cover")} submitLabel={t("resetCover")} submitKind="reset" variant="ghost" compact confirm={t("confirmReset")}>
              {null}
            </GcsActionForm>
          )}
        </div>
      </Section>

      <div className="gcs-mpProfile__side">
        <Section title={t("badgesTitle")} icon="fa-solid fa-award" testId="gcs-acp-member-badges">
          {userBadges.length === 0 && <span className="gcs-mpMuted">{t("noBadges")}</span>}
          {userBadges.map((b) => (
            <div key={b.id} className="gcs-mpRow">
              <span className="gcs-mpInline">
                <GcsBadgeArt badge={{ name: b.badge.name, art: badgeArtSrc(b.badge), image: b.badge.imageAttachmentId ? `/files/${b.badge.imageAttachmentId}` : null }} size={24} decorative />
                <strong>{b.badge.name}</strong>
                <span className="gcs-mpMuted">
                  · {format.dateTime(b.createdAt, { dateStyle: "medium" })}
                  {b.reason ? ` · ${b.reason}` : ""}
                </span>
              </span>
              <GcsActionForm action={revokeBadge.bind(null, userId, b.badgeId)} submitLabel={t("revoke")} submitKind="revoke" variant="ghost" compact confirm={t("confirmRevoke")}>
                {null}
              </GcsActionForm>
            </div>
          ))}
          <GcsActionForm action={awardBadge.bind(null, userId)} submitLabel={t("award")} submitKind="award">
            <div className="gcs-formGrid">
              <label className="gcs-field">
                {t("badge")}
                <select className="gcs-input" name="badgeId">
                  {badges
                    .filter((b) => !owned.has(b.id))
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.manual ? "" : ` (${t("automatic")})`}
                      </option>
                    ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("reason")}
                <input className="gcs-input" name="reason" required maxLength={200} />
              </label>
            </div>
          </GcsActionForm>
        </Section>

        <Section title={t("vipTitle")} icon="fa-solid fa-crown" testId="gcs-acp-member-vip">
          {active ? (
            <div className="gcs-mpRow" data-testid="gcs-acp-vip-active">
              <span>
                <strong>{vipGroups.find((g) => g.id === active.groupId)?.name}</strong>{" "}
                <span className="gcs-mpMuted">
                  · {active.expiresAt ? t("expires", { date: format.dateTime(active.expiresAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("permanent")}
                  {active.madePrimary ? ` · ${t("asPrimary")}` : ""}
                </span>
              </span>
              <div className="gcs-mpInline">
                {active.expiresAt && (
                  <GcsActionForm action={extendVip.bind(null, active.id)} submitLabel={t("extend")} submitKind="extend" variant="ghost" compact>
                    <input className="gcs-input gcs-input--sm gcs-mpDays" name="days" type="number" min={1} max={3650} defaultValue={30} aria-label={t("days")} />
                  </GcsActionForm>
                )}
                <GcsActionForm action={revokeVip.bind(null, active.id)} submitLabel={t("revokeVip")} submitKind="revoke" variant="ghost" compact confirm={t("confirmRevokeVip")}>
                  {null}
                </GcsActionForm>
              </div>
            </div>
          ) : (
            <span className="gcs-mpMuted">{t("noVip")}</span>
          )}
          <GcsActionForm action={grantVip.bind(null, userId)} submitLabel={t("grant")} submitKind="grant">
            <div className="gcs-formGrid">
              <label className="gcs-field">
                {t("tier")}
                <select className="gcs-input" name="groupId">
                  {vipGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("days")}
                <input className="gcs-input" name="days" type="number" min={1} max={3650} defaultValue={30} />
              </label>
              <label className="gcs-field gcs-formGrid__wide">
                {t("note")}
                <input className="gcs-input" name="note" maxLength={200} />
              </label>
            </div>
            <label className="gcs-toggleRow">
              <span>{t("permanent")}</span>
              <input type="checkbox" name="permanent" />
            </label>
            <label className="gcs-toggleRow">
              <span>{t("asPrimary")}</span>
              <input type="checkbox" name="asPrimary" defaultChecked />
            </label>
          </GcsActionForm>
          {history.length > 0 && (
            <div className="gcs-formSec">
              <h3>
                <GcsAcpTitleIcon name="fa-solid fa-clock-rotate-left" />
                {t("history")}
              </h3>
              {history.map((h) => (
                <div key={h.id} className="gcs-mpRow">
                  <span>
                    <strong>{t(`actions.${h.action}`)}</strong> · {h.group?.name ?? "—"}
                    {h.expiresAt ? ` · ${t("until", { date: format.dateTime(h.expiresAt, { dateStyle: "medium" }) })}` : ""}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                  <span className="gcs-mpMuted">{format.dateTime(h.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
