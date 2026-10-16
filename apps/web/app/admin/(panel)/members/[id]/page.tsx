import { MEMBER_REMOVAL_ACP_SECTION } from "@gcs/core";
import { GcsAvatar, GcsBadge, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { permissionLabel } from "@/lib/permission-label";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { MemberProfileSections } from "./MemberProfileSections";
import { addSecondaryGroup, banMember, liftBan, removeSecondaryGroup, setPrimaryGroup, warnMember } from "../actions";
import { saveMemberPermissions } from "./actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { GcsMemberLink } from "@/lib/member-names";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ ban?: string; reason?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await services().db.user.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: user?.name };
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <GcsCard as="section" aria-label={title}>
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

const muted = { color: "var(--gcs-muted)", fontSize: 13 } as const;
const listRow = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--gcs-border)", fontSize: 13 } as const;

export default async function AcpMemberPage({ params, searchParams }: Props) {
  const panel = await requireAcpSection("members.members");
  const { id } = await params;
  // „Ban pe site…” din meniul de moderare al chat-ului: motivul vine completat, cu mesajul ca dovadă.
  const sp = (await searchParams) ?? {};
  const banReason = typeof sp.reason === "string" ? sp.reason.slice(0, 500) : "";
  const { members, db, memberRemoval } = services();
  const member = await members.detail(id);
  if (!member) notFound();
  const t = await getTranslations("acp.member");
  const tr = await getTranslations("acp.removal");
  const format = await getFormatter();
  // Ștergerea și unirea (specul 2026-10-09-stergere-unire-membri): dreptul `delete` pe membri; o operație în curs apare ca bandă.
  const canRemove = await services().acp.can(panel.actor, MEMBER_REMOVAL_ACP_SECTION, "delete");
  const removal = await memberRemoval.activeFor(member.id);
  const groups = await db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } });
  const { permissions, registry } = services();
  const [overrides, tAll] = await Promise.all([permissions.userPermissions(member.id), getTranslations()]);
  const permDefs = registry.permissionDefs().filter((d) => d.scope === "group");
  const now = new Date();
  const secondaryIds = new Set(member.secondaryGroups.map((g) => g.id));
  const addable = groups.filter((g) => g.id !== member.primaryGroup.id && !secondaryIds.has(g.id));

  return (
    <>
      <Link href="/admin/members" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <GcsAvatar name={member.name} size="l" {...(member.image ? { src: member.image } : {})} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <GcsAcpTitle icon="fa-solid fa-user" variant="plain">
            <GcsMemberLink user={member} href={null} size="full" />
          </GcsAcpTitle>
          <span style={muted}>
            {member.primaryGroup.name} · {t("info.email")}: {member.email} · {t("info.twoFactor")}: {member.twoFactorEnabled ? t("info.yes") : t("info.no")}
          </span>
          <span style={muted}>
            {t("info.joined")}: {format.dateTime(member.createdAt, { dateStyle: "medium" })} · {t("info.lastActive")}:{" "}
            {member.lastActiveAt ? format.relativeTime(member.lastActiveAt) : "—"} · <Link href={`/members/${member.id}`}>{t("info.viewProfile")}</Link>
          </span>
        </div>
      </div>

      {removal && (
        <p className="gcs-removalBanner" data-testid="gcs-member-removal-banner">
          <GcsIcon name={removal.status === "SCHEDULED" ? "fa-solid fa-hourglass-half" : "fa-solid fa-gears"} />
          {removal.status === "SCHEDULED"
            ? tr("memberScheduled", { date: format.dateTime(removal.runAfter ?? new Date(), { dateStyle: "medium", timeStyle: "short" }) })
            : removal.targetId === member.id
              ? tr("memberIsTarget", { name: removal.userName })
              : tr("memberInProgress")}
          {removal.status !== "SCHEDULED" && <Link href={`/admin/members/removals/${removal.id}`}>{tr("viewProgress")}</Link>}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 20, alignItems: "start" }}>
        <Section title={t("groups.title")} icon="fa-solid fa-users">
          <GcsActionForm action={setPrimaryGroup.bind(null, member.id)} submitLabel={t("groups.save")} submitKind="save">
            <label className="gcs-field">
              {t("groups.primary")}
              <select className="gcs-input" name="groupId" defaultValue={member.primaryGroup.id}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </GcsActionForm>
          <div>
            <span className="gcs-field">{t("groups.secondary")}</span>
            {member.secondaryGroups.length === 0 && <p style={muted}>{t("groups.none")}</p>}
            {member.secondaryGroups.map((g) => (
              <div key={g.id} style={listRow}>
                <span>{g.name}</span>
                <GcsActionForm
                  compact
                  variant="ghost"
                  action={removeSecondaryGroup.bind(null, member.id, g.id)}
                  submitLabel={t("groups.remove", { group: g.name })} submitKind="remove"
                />
              </div>
            ))}
          </div>
          {addable.length > 0 && (
            <GcsActionForm action={addSecondaryGroup.bind(null, member.id)} submitLabel={t("groups.addSubmit")} submitKind="create" variant="ghost">
              <label className="gcs-field">
                {t("groups.add")}
                <select className="gcs-input" name="groupId">
                  {addable.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            </GcsActionForm>
          )}
        </Section>

        <Section title={t("ban.title")} icon="fa-solid fa-ban">
          <GcsActionForm action={banMember.bind(null, member.id)} submitLabel={t("ban.submit")} submitKind="ban">
            <label className="gcs-field">
              {t("ban.reason")}
              <input className="gcs-input" name="reason" required maxLength={500} defaultValue={banReason} autoFocus={sp.ban === "1"} data-testid="gcs-acp-ban-reason" />
            </label>
            <label className="gcs-field">
              {t("ban.duration")}
              <select className="gcs-input" name="duration" defaultValue="permanent">
                {(["permanent", "d1", "d7", "d30"] as const).map((d) => (
                  <option key={d} value={d}>
                    {t(`ban.durations.${d}`)}
                  </option>
                ))}
              </select>
            </label>
          </GcsActionForm>
          <div>
            <span className="gcs-field">{t("ban.history")}</span>
            {member.bans.length === 0 && <p style={muted}>{t("ban.none")}</p>}
            {member.bans.map((b) => {
              const status = b.liftedAt ? "lifted" : b.expiresAt && b.expiresAt <= now ? "expired" : "active";
              return (
                <div key={b.id} style={listRow}>
                  <span>
                    {b.reason} ·{" "}
                    <span style={muted}>
                      {b.expiresAt ? t("ban.until", { date: format.dateTime(b.expiresAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("ban.permanent")}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <GcsBadge tone={status === "active" ? "accent" : "neutral"}>{t(`ban.status.${status}`)}</GcsBadge>
                    {status === "active" && (
                      <GcsActionForm compact variant="ghost" action={liftBan.bind(null, b.id)} submitLabel={t("ban.lift")} submitKind="lift" />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={t("warn.title")} icon="fa-solid fa-triangle-exclamation">
          <GcsActionForm action={warnMember.bind(null, member.id)} submitLabel={t("warn.submit")} submitKind="warn">
            <label className="gcs-field">
              {t("warn.points")}
              <input className="gcs-input" name="points" type="number" min={1} max={100} defaultValue={1} required />
            </label>
            <label className="gcs-field">
              {t("warn.reason")}
              <input className="gcs-input" name="reason" required maxLength={500} />
            </label>
            <label className="gcs-field">
              {t("warn.expiresDays")}
              <input className="gcs-input" name="expiresDays" type="number" min={0} defaultValue={30} />
            </label>
          </GcsActionForm>
          <div>
            <span className="gcs-field">{t("warn.history")}</span>
            {member.warnings.length === 0 && <p style={muted}>{t("warn.none")}</p>}
            {member.warnings.map((w) => (
              <div key={w.id} style={listRow}>
                <span>
                  <strong>{w.points}</strong> · {w.reason}
                </span>
                <span style={muted}>
                  {w.issuedByName ? t("warn.by", { name: w.issuedByName }) : ""} · {format.dateTime(w.createdAt, { dateStyle: "medium" })}
                  {w.expiresAt && w.expiresAt <= now ? ` · ${t("warn.expired")}` : ""}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t("ips.title")} icon="fa-solid fa-network-wired">
          {member.ips.length === 0 ? (
            <p style={muted}>{t("ips.none")}</p>
          ) : (
            <p style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{member.ips.join(", ")}</p>
          )}
          <span className="gcs-field">{t("ips.shared")}</span>
          {member.sharedIpAccounts.length === 0 && <p style={muted}>{t("ips.sharedNone")}</p>}
          {member.sharedIpAccounts.map((a) => (
            <div key={a.id} style={listRow}>
              <GcsMemberLink user={a} href={`/admin/members/${a.id}`} />
              <span style={muted}>{a.ip}</span>
            </div>
          ))}
        </Section>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16, alignItems: "start" }}>
        <MemberProfileSections userId={member.id} />
      </div>
      <Section title={t("perms.title")} icon="fa-solid fa-key">
        <p style={muted}>{t("perms.hint")}</p>
        <GcsActionForm action={saveMemberPermissions.bind(null, member.id)} submitLabel={t("perms.save")} submitKind="save">
          <div className="gcs-permGrid" data-testid="gcs-member-permissions">
            {permDefs.map((def) => {
              const value = overrides[def.key];
              const numeric = typeof Object.values(def.default).find((v) => v !== undefined) === "number";
              const label = permissionLabel(def, tAll, registry);
              return (
                <label key={def.key} className="gcs-field gcs-permGrid__row">
                  <span>
                    {label} <code style={muted}>{def.key}</code>
                  </span>
                  {numeric ? (
                    <input className="gcs-input" type="number" min={-1} name={`perm:${def.key}`} defaultValue={typeof value === "number" ? value : ""} placeholder={t("perms.inherit")} />
                  ) : (
                    <select className="gcs-input" name={`perm:${def.key}`} defaultValue={value === true ? "true" : value === false ? "false" : ""}>
                      <option value="">{t("perms.inherit")}</option>
                      <option value="true">{t("perms.allow")}</option>
                      <option value="false">{t("perms.deny")}</option>
                    </select>
                  )}
                </label>
              );
            })}
          </div>
        </GcsActionForm>
      </Section>
      {canRemove && (!removal || removal.status === "SCHEDULED") && (
        <GcsCard as="section" aria-label={tr("dangerTitle")} className="gcs-dangerZone" data-testid="gcs-member-danger">
          <div className="gcs-acpWidget__header">
            <h2 className="gcs-acpWidget__title">
              <GcsAcpTitleIcon name="fa-solid fa-triangle-exclamation" />
              {tr("dangerTitle")}
            </h2>
          </div>
          <div style={{ padding: 16 }}>
            <div className="gcs-dangerZone__row">
              <div className="gcs-dangerZone__text">
                <strong>{tr("mergeTitle")}</strong>
                <span>{tr("mergeHint")}</span>
              </div>
              <Link href={`/admin/members/${member.id}/merge`} className="gcs-btn gcs-btn--ghost" data-testid="gcs-member-merge">
                <GcsIcon name="fa-solid fa-code-merge" className="gcs-btn__icon" />
                {tr("mergeOpen")}
              </Link>
            </div>
            <div className="gcs-dangerZone__row">
              <div className="gcs-dangerZone__text">
                <strong>{tr("deleteTitle")}</strong>
                <span>{tr("deleteHint")}</span>
              </div>
              <Link href={`/admin/members/${member.id}/delete`} className="gcs-btn gcs-btn--ghost" data-testid="gcs-member-delete">
                <GcsIcon name="fa-solid fa-user-xmark" className="gcs-btn__icon" />
                {tr("deleteOpen")}
              </Link>
            </div>
          </div>
        </GcsCard>
      )}
    </>
  );
}
