import { GcsBadgeArt, GcsCard } from "@gcs/ui";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { awardBadge, extendVip, grantVip, revokeBadge, revokeVip, staffResetImage, staffSaveProfile } from "./actions";

function Section({ title, icon, children, testId }: { title: string; icon: string; children: ReactNode; testId: string }) {
  return (
    <GcsCard as="section" aria-label={title} data-testid={testId}>
      <div className="gcs-acpWidget__header">
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={icon} />
          {title}
        </h2>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </GcsCard>
  );
}

const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--gcs-border)", fontSize: 13 } as const;

/** Fișa membrului în ACP, etapa 3: profilul (editat de staff), badge-urile și VIP-ul (specul etapei 3, §9). */
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
  const owned = new Set(userBadges.map((b) => b.badgeId));

  return (
    <>
      <Section title={t("profileTitle")} icon="fa-solid fa-id-card" testId="gcs-acp-member-profile">
        <GcsActionForm action={staffSaveProfile.bind(null, userId)} submitLabel={t("save")} submitKind="save">
          <label className="gcs-field">
            {t("bio")}
            <input className="gcs-input" name="bio" defaultValue={user.bio} maxLength={160} />
          </label>
          {fields.map((f) => (
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
          ))}
        </GcsActionForm>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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

      <Section title={t("badgesTitle")} icon="fa-solid fa-award" testId="gcs-acp-member-badges">
        {userBadges.length === 0 && <span className="gcs-muted">{t("noBadges")}</span>}
        {userBadges.map((b) => (
          <div key={b.id} style={row}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <GcsBadgeArt badge={{ name: b.badge.name, art: badgeArtSrc(b.badge), image: b.badge.imageAttachmentId ? `/files/${b.badge.imageAttachmentId}` : null }} size={24} decorative />
              <strong>{b.badge.name}</strong>
              <span className="gcs-muted">
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 220 }}>
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
            <label className="gcs-field" style={{ flex: "1 1 240px" }}>
              {t("reason")}
              <input className="gcs-input" name="reason" required maxLength={200} />
            </label>
          </div>
        </GcsActionForm>
      </Section>

      <Section title={t("vipTitle")} icon="fa-solid fa-crown" testId="gcs-acp-member-vip">
        {active ? (
          <div style={row} data-testid="gcs-acp-vip-active">
            <span>
              <strong>{vipGroups.find((g) => g.id === active.groupId)?.name}</strong>{" "}
              <span className="gcs-muted">
                · {active.expiresAt ? t("expires", { date: format.dateTime(active.expiresAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("permanent")}
                {active.madePrimary ? ` · ${t("asPrimary")}` : ""}
              </span>
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {active.expiresAt && (
                <GcsActionForm action={extendVip.bind(null, active.id)} submitLabel={t("extend")} submitKind="extend" variant="ghost" compact>
                  <input className="gcs-input" name="days" type="number" min={1} max={3650} defaultValue={30} aria-label={t("days")} style={{ width: 90 }} />
                </GcsActionForm>
              )}
              <GcsActionForm action={revokeVip.bind(null, active.id)} submitLabel={t("revokeVip")} submitKind="revoke" variant="ghost" compact confirm={t("confirmRevokeVip")}>
                {null}
              </GcsActionForm>
            </div>
          </div>
        ) : (
          <span className="gcs-muted">{t("noVip")}</span>
        )}
        <GcsActionForm action={grantVip.bind(null, userId)} submitLabel={t("grant")} submitKind="grant">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 180 }}>
              {t("tier")}
              <select className="gcs-input" name="groupId">
                {vipGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field" style={{ width: 110 }}>
              {t("days")}
              <input className="gcs-input" name="days" type="number" min={1} max={3650} defaultValue={30} />
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="permanent" />
              {t("permanent")}
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="asPrimary" defaultChecked />
              {t("asPrimary")}
            </label>
            <label className="gcs-field" style={{ flex: "1 1 200px" }}>
              {t("note")}
              <input className="gcs-input" name="note" maxLength={200} />
            </label>
          </div>
        </GcsActionForm>
        {history.length > 0 && (
          <div>
            <h3 className="gcs-acpWidget__title" style={{ fontSize: 13, margin: "8px 0" }}>
              <GcsAcpTitleIcon name="fa-solid fa-clock-rotate-left" />
              {t("history")}
            </h3>
            {history.map((h) => (
              <div key={h.id} style={row}>
                <span>
                  <strong>{t(`actions.${h.action}`)}</strong> · {h.group?.name ?? "—"}
                  {h.expiresAt ? ` · ${t("until", { date: format.dateTime(h.expiresAt, { dateStyle: "medium" }) })}` : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </span>
                <span className="gcs-muted">{format.dateTime(h.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
