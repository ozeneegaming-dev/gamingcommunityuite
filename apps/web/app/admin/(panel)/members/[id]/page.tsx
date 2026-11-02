import { GDPR_ACP_SECTION, MEMBER_REMOVAL_ACP_SECTION } from "@gcs/core";
import { DONATIONS_ACP_SECTION } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { GcsGroupLink } from "@/lib/group-pills";
import { memberAccountLog, memberActivity, memberQuotas, type GcsActivityDay } from "@/lib/member-dashboard";
import { formatMoney } from "@/lib/donations";
import { GcsMemberLink } from "@/lib/member-names";
import { GcsMemberPanelBody, memberPanels } from "@/lib/member-panels";
import { permissionLabel } from "@/lib/permission-label";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { addSecondaryGroup, banMember, liftBan, removeSecondaryGroup, revokeWarning, setPrimaryGroup, setSecondaryExpiry, warnMember } from "../actions";
import { addMemberDonation, confirmDonation, deleteDonation } from "../../vip/donations/actions";
import { GcsDonationFields } from "../../vip/donations/GcsDonationFields";
import { disableMemberTwoFactor, forcePasswordReset, markSpammerAction, saveMemberPermissions, setSpammer, unlockMember, unlockMemberLogin, validateMember } from "./actions";
import { MemberProfileSections } from "./MemberProfileSections";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ ban?: string; reason?: string; tab?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await services().db.user.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: user?.name };
}

const BASE_TABS = [
  ["overview", "fa-solid fa-gauge-high"],
  ["profile", "fa-solid fa-id-card"],
  ["activity", "fa-solid fa-chart-line"],
  ["permissions", "fa-solid fa-key"],
  ["log", "fa-solid fa-clipboard-list"],
] as const;

function Section({ title, icon, children, testId, id, wide }: { title: string; icon: string; children: ReactNode; testId?: string; id?: string; wide?: boolean }) {
  return (
    <GcsCard as="section" aria-label={title} className={`gcs-mdCard${wide ? " gcs-mdCard--wide" : ""}`} data-testid={testId} id={id}>
      <div className="gcs-acpWidget__header">
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={icon} />
          {title}
        </h2>
      </div>
      <div className="gcs-mdCard__body">{children}</div>
    </GcsCard>
  );
}

/** Graficul de activitate pe zile: bare pe tokenurile temei (postări + chat), cu totalurile. */
function ActivityBars({ days, label }: { days: GcsActivityDay[]; label: (d: GcsActivityDay) => string }) {
  const max = Math.max(1, ...days.map((d) => d.posts + d.chat));
  return (
    <div className="gcs-activityBars" role="img" aria-label={days.map(label).join(", ")}>
      {days.map((d) => (
        <span key={d.day} className="gcs-activityBars__day" title={label(d)}>
          <span className="gcs-activityBars__chat" style={{ height: `${(d.chat / max) * 100}%` }} />
          <span className="gcs-activityBars__posts" style={{ height: `${(d.posts / max) * 100}%` }} />
        </span>
      ))}
    </div>
  );
}

/**
 * ACP → Membri → membrul, ca dashboard (Membri v2): cardul de identitate, „Acțiuni cont” și taburile Prezentare /
 * Profil / Activitate / Permisiuni / Jurnal, plus cardurile și taburile aduse de aplicații și pluginuri (apar doar cu
 * aplicația pornită).
 */
export default async function AcpMemberPage({ params, searchParams }: Props) {
  const panel = await requireAcpSection("members.members");
  const { id } = await params;
  // „Ban pe site…” din meniul de moderare al chat-ului: motivul vine completat, cu mesajul ca dovadă.
  const sp = (await searchParams) ?? {};
  const banReason = typeof sp.reason === "string" ? sp.reason.slice(0, 500) : "";
  const { members, db, memberRemoval, acp, permissions, registry, donations, vip, apps, loginLockout } = services();
  const member = await members.detail(id);
  if (!member) notFound();
  const [t, tr, tAll, format, panels] = await Promise.all([getTranslations("acp.member"), getTranslations("acp.removal"), getTranslations(), getFormatter(), memberPanels("acp", panel.actor)]);
  const tabs: { key: string; label: string; icon: string }[] = [
    ...BASE_TABS.map(([key, icon]) => ({ key, label: t(`tabs.${key}`), icon })),
    ...panels.filter((p) => p.kind === "tab").map((p) => ({ key: p.key, label: p.label, icon: p.icon })),
  ];
  const tab = tabs.some((x) => x.key === sp.tab) ? sp.tab! : "overview";
  const [canRemove, canGdpr, removal, rootGroup, hasPassword, canSpam, loginLockedUntil] = await Promise.all([
    acp.can(panel.actor, MEMBER_REMOVAL_ACP_SECTION, "delete"),
    acp.can(panel.actor, GDPR_ACP_SECTION, "view"),
    memberRemoval.activeFor(member.id),
    db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } }),
    db.account.count({ where: { userId: member.id, providerId: "credential", password: { not: null } } }),
    acp.can(panel.actor, "members.antispam", "edit"),
    // ACP → Setări → Securitate: contul blocat după parole greșite (expiră singur; staff-ul îl poate debloca).
    loginLockout.lockedUntil(member.id).catch(() => null),
  ]);
  const actorIsRoot = !!rootGroup && panel.actor.groupIds.includes(rootGroup.id);
  const now = new Date();
  const dateLong = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const tabHref = (key: string) => (key === "overview" ? `/admin/members/${member.id}` : `/admin/members/${member.id}?tab=${encodeURIComponent(key)}`);

  return (
    <>
      <Link href="/admin/members" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>

      <div className="gcs-memberHead">
        <GcsCard as="section" className="gcs-memberId" aria-label={t("identity.title")} data-testid="gcs-member-identity">
          <GcsAvatar name={member.name} size="l" className="gcs-memberId__avatar" {...(member.image ? { src: member.image } : {})} />
          <div className="gcs-memberId__main">
            <GcsAcpTitle icon="fa-solid fa-user" variant="plain">
              <GcsMemberLink user={member} href={null} size="full" />
            </GcsAcpTitle>
            <div className="gcs-memberId__groups">
              <GcsGroupLink groupId={member.primaryGroup.id} variant="filled" />
              {member.secondaryGroups.map((g) => (
                <GcsGroupLink key={g.id} groupId={g.id} size="sm" />
              ))}
            </div>
            <div className="gcs-memberId__badges">
              {member.bans.some((b) => !b.liftedAt && (!b.expiresAt || b.expiresAt > now)) && <GcsBadge tone="accent">{t("identity.banned")}</GcsBadge>}
              {member.isSpammer && <GcsBadge tone="accent">{t("identity.spammer")}</GcsBadge>}
              <GcsBadge tone={member.emailVerified ? "neutral" : "accent"}>{member.emailVerified ? t("identity.validated") : t("identity.unvalidated")}</GcsBadge>
              <GcsBadge tone="neutral">
                {t("info.twoFactor")}: {member.twoFactorEnabled ? t("info.yes") : t("info.no")}
              </GcsBadge>
              {member.twoFactorLocked && <GcsBadge tone="accent">{t("identity.locked")}</GcsBadge>}
              {loginLockedUntil && (
                <GcsBadge tone="accent" data-testid="gcs-member-login-locked">
                  {t("identity.loginLocked", { time: format.dateTime(loginLockedUntil, { timeStyle: "short" }) })}
                </GcsBadge>
              )}
              {member.passwordResetRequestedAt && <GcsBadge tone="accent">{t("identity.passwordReset")}</GcsBadge>}
            </div>
            <dl className="gcs-memberId__meta">
              <div>
                <dt>{t("info.email")}</dt>
                <dd>{member.email}</dd>
              </div>
              <div>
                <dt>{t("info.joined")}</dt>
                <dd>{dateLong(member.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("info.lastActive")}</dt>
                <dd>{member.lastActiveAt ? format.relativeTime(member.lastActiveAt) : "—"}</dd>
              </div>
              <div>
                <dt>{t("identity.posts")}</dt>
                <dd>{format.number(member.postsCount)}</dd>
              </div>
              <div>
                <dt>{t("identity.ip")}</dt>
                <dd className="gcs-memberId__mono">{member.ips[0] ?? "—"}</dd>
              </div>
              <div>
                <dt>{t("identity.logins")}</dt>
                <dd>{member.loginMethods.length ? member.loginMethods.map((m) => t(`identity.loginMethods.${["credential", "steam", "discord", "google"].includes(m) ? m : "other"}`)).join(", ") : "—"}</dd>
              </div>
            </dl>
            <Link href={`/members/${member.id}`} className="gcs-memberId__profile">
              <GcsIcon name="fa-solid fa-arrow-up-right-from-square" /> {t("info.viewProfile")}
            </Link>
          </div>
        </GcsCard>

        <GcsCard as="section" className="gcs-memberActions" aria-label={t("actions.title")} data-testid="gcs-member-danger">
          <div className="gcs-acpWidget__header">
            <h2 className="gcs-acpWidget__title">
              <GcsAcpTitleIcon name="fa-solid fa-bolt" />
              {t("actions.title")}
            </h2>
          </div>
          <div className="gcs-memberActions__grid">
            {!member.emailVerified && <GcsActionForm compact variant="ghost" action={validateMember.bind(null, member.id)} submitLabel={t("actions.validate")} submitKind="approve" confirm={t("actions.validateConfirm")} />}
            {member.isSpammer ? (
              <GcsActionForm compact variant="ghost" action={setSpammer.bind(null, member.id, false)} submitLabel={t("actions.unspammer")} submitKind="reset" confirm={t("actions.unspammerConfirm")} />
            ) : canSpam ? (
              // Anti-spam: acțiunea completă, cu opțiunile ei (IP, domeniu, conținut, raportare).
              <details className="gcs-memberSpam" data-testid="gcs-member-spammer">
                <summary className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                  <GcsIcon name="fa-solid fa-user-slash" className="gcs-btn__icon" />
                  {t("actions.spammer")}
                </summary>
                <GcsActionForm action={markSpammerAction.bind(null, member.id)} submitLabel={t("spammer.submit")} submitKind="ban" confirm={t("actions.spammerConfirm")}>
                  <label className="gcs-check">
                    <input type="checkbox" name="hide" defaultChecked /> {t("spammer.hide")}
                  </label>
                  <label className="gcs-check">
                    <input type="checkbox" name="banIp" defaultChecked /> {t("spammer.banIp")}
                  </label>
                  <label className="gcs-check">
                    <input type="checkbox" name="banDomain" /> {t("spammer.banDomain")}
                  </label>
                  <label className="gcs-check">
                    <input type="checkbox" name="report" /> {t("spammer.report")}
                  </label>
                  <label className="gcs-field">
                    {t("spammer.reason")}
                    <input className="gcs-input" name="reason" maxLength={300} placeholder="spam" />
                  </label>
                </GcsActionForm>
              </details>
            ) : (
              <GcsActionForm compact variant="ghost" action={setSpammer.bind(null, member.id, true)} submitLabel={t("actions.spammer")} submitKind="ban" confirm={t("actions.spammerConfirm")} />
            )}
            {member.twoFactorLocked && <GcsActionForm compact variant="ghost" action={unlockMember.bind(null, member.id)} submitLabel={t("actions.unlock")} submitKind="lift" confirm={t("actions.unlockConfirm")} />}
            {loginLockedUntil && <GcsActionForm compact variant="ghost" action={unlockMemberLogin.bind(null, member.id)} submitLabel={t("actions.unlockLogin")} submitKind="lift" confirm={t("actions.unlockLoginConfirm")} />}
            {hasPassword > 0 && <GcsActionForm compact variant="ghost" action={forcePasswordReset.bind(null, member.id)} submitLabel={t("actions.resetPassword")} submitKind="reset" confirm={t("actions.resetPasswordConfirm")} />}
            {actorIsRoot && member.twoFactorEnabled && (
              <GcsActionForm compact variant="ghost" action={disableMemberTwoFactor.bind(null, member.id)} submitLabel={t("actions.disable2fa")} submitKind="remove" confirm={t("actions.disable2faConfirm")} />
            )}
            <a href="#gcs-member-ban" className="gcs-btn gcs-btn--ghost gcs-btn--sm">
              <GcsIcon name="fa-solid fa-gavel" className="gcs-btn__icon" />
              {t("actions.ban")}
            </a>
            {canGdpr && (
              <a href={`/admin/members/${member.id}/gdpr.zip`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" download data-testid="gcs-member-gdpr-export">
                <GcsIcon name="fa-solid fa-file-zipper" className="gcs-btn__icon" />
                {t("actions.gdpr")}
              </a>
            )}
            {canRemove && (!removal || removal.status === "SCHEDULED") && (
              <>
                <Link href={`/admin/members/${member.id}/merge`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" data-testid="gcs-member-merge">
                  <GcsIcon name="fa-solid fa-code-merge" className="gcs-btn__icon" />
                  {tr("mergeOpen")}
                </Link>
                <Link href={`/admin/members/${member.id}/delete`} className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-memberActions__danger" data-testid="gcs-member-delete">
                  <GcsIcon name="fa-solid fa-user-xmark" className="gcs-btn__icon" />
                  {tr("deleteOpen")}
                </Link>
              </>
            )}
          </div>
          <p className="gcs-memberActions__hint">{t("actions.hint")}</p>
        </GcsCard>
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

      <nav className="gcs-tabs gcs-memberTabs" aria-label={t("tabs.label")} data-testid="gcs-member-tabs">
        {tabs.map((x) => (
          <Link key={x.key} href={tabHref(x.key)} className={`gcs-tab${tab === x.key ? " gcs-tab--active" : ""}`} aria-current={tab === x.key ? "page" : undefined} data-testid={`gcs-member-tab-${x.key}`}>
            <GcsIcon name={x.icon} className="gcs-tab__icon" /> {x.label}
          </Link>
        ))}
      </nav>

      <div className="gcs-memberTabPanel" key={tab} data-tab={tab}>
        {tab === "overview" && (
          <Overview
            memberId={member.id}
            member={member}
            banReason={banReason}
            autoFocusBan={sp.ban === "1"}
            panels={panels.filter((p) => p.kind === "card")}
            actor={panel.actor}
          />
        )}
        {tab === "profile" && (
          <div className="gcs-mdGrid">
            <MemberProfileSections userId={member.id} />
          </div>
        )}
        {tab === "activity" && <ActivityTab userId={member.id} />}
        {tab === "permissions" && <PermissionsTab userId={member.id} />}
        {tab === "log" && <LogTab userId={member.id} />}
        {panels
          .filter((p) => p.kind === "tab" && p.key === tab)
          .map((p) => (
            <Section key={p.key} title={p.label} icon={p.icon} testId={`gcs-member-panel-${p.key}`} wide>
              <GcsMemberPanelBody panel={p} userId={member.id} surface="acp" viewer={panel.actor} />
            </Section>
          ))}
      </div>
    </>
  );

  // ─── Taburile ───────────────────────────────────────────────────────────────────────────────────────────

  async function Overview(props: { memberId: string; member: NonNullable<Awaited<ReturnType<typeof members.detail>>>; banReason: string; autoFocusBan: boolean; panels: Awaited<ReturnType<typeof memberPanels>>; actor: typeof panel.actor }) {
    const m = props.member;
    const [groups, activity, content, quotas, extra, badges, active, donationRows, sponsor, donationMethods, donationCurrency, vipOn, canDonations, locale] = await Promise.all([
      db.group.findMany({ where: { key: { not: "guest" } }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
      memberActivity(m.id, 30),
      memberRemoval.contentSummary(m.id),
      memberQuotas(m.id),
      db.user.findUniqueOrThrow({ where: { id: m.id }, select: { points: true, reputation: true, rank: { select: { name: true } } } }),
      db.userBadge.findMany({ where: { userId: m.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, badge: { select: { name: true } } } }),
      vip.active(m.id),
      donations.mine(m.id),
      donations.sponsor(m.id),
      donations.methods(),
      donations.mainCurrency(),
      apps.enabled("vip"),
      acp.can(props.actor, DONATIONS_ACP_SECTION, "edit"),
      getLocale(),
    ]);
    const secondaryIds = new Set(m.secondaryGroups.map((g) => g.id));
    const addable = groups.filter((g) => g.id !== m.primaryGroup.id && !secondaryIds.has(g.id));
    const totals = activity.reduce((s, d) => ({ posts: s.posts + d.posts, chat: s.chat + d.chat }), { posts: 0, chat: 0 });
    const bySteps = new Map<string, typeof content>();
    for (const item of content) bySteps.set(item.step, [...(bySteps.get(item.step) ?? []), item]);
    const warnPoints = m.warnings.filter((w) => !w.revokedAt && (!w.expiresAt || w.expiresAt > now)).reduce((s, w) => s + w.points, 0);
    const warnReasons = await services().warnings.reasons();

    return (
      <div className="gcs-mdGrid">
        <Section title={t("cards.activity")} icon="fa-solid fa-chart-column" testId="gcs-member-card-activity">
          <ActivityBars days={activity} label={(d) => t("cards.activityDay", { day: d.day, posts: d.posts, chat: d.chat })} />
          <p className="gcs-mdCard__muted">
            <span className="gcs-legendDot gcs-legendDot--posts" /> {t("cards.activityPosts", { count: totals.posts })} · <span className="gcs-legendDot gcs-legendDot--chat" /> {t("cards.activityChat", { count: totals.chat })}
          </p>
        </Section>

        <Section title={t("cards.content")} icon="fa-solid fa-layer-group" testId="gcs-member-card-content">
          {content.length === 0 ? (
            <p className="gcs-mdCard__muted">{t("cards.contentEmpty")}</p>
          ) : (
            <ul className="gcs-memberContent">
              {[...bySteps.entries()].map(([step, items]) => (
                <li key={step}>
                  <strong>{tAll(`acp.removal.steps.${step}` as never)}</strong>
                  <span>{items.map((i) => `${tAll(`acp.removal.items.${i.key}` as never)}: ${format.number(i.count)}`).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t("cards.rank")} icon="fa-solid fa-ranking-star" testId="gcs-member-card-rank">
          <dl className="gcs-memberPanel__stats">
            <div>
              <dt>{t("cards.rankName")}</dt>
              <dd>{extra.rank?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("cards.points")}</dt>
              <dd>{format.number(extra.points)}</dd>
            </div>
            <div>
              <dt>{t("cards.reputation")}</dt>
              <dd>{format.number(extra.reputation)}</dd>
            </div>
            <div>
              <dt>{t("cards.posts")}</dt>
              <dd>{format.number(m.postsCount)}</dd>
            </div>
          </dl>
        </Section>

        <Section title={t("cards.badges")} icon="fa-solid fa-award" testId="gcs-member-card-badges">
          {badges.length === 0 ? (
            <p className="gcs-mdCard__muted">{t("cards.badgesEmpty")}</p>
          ) : (
            <div className="gcs-memberChips">
              {badges.map((b) => (
                <span key={b.id} className="gcs-memberChip">
                  <GcsIcon name="fa-solid fa-award" /> {b.badge.name}
                </span>
              ))}
            </div>
          )}
          <Link href={tabHref("profile")} className="gcs-mdCard__more">
            {t("cards.manage")}
          </Link>
        </Section>

        <Section title={t("cards.vip")} icon="fa-solid fa-crown" testId="gcs-member-card-vip">
          {active ? (
            <p className="gcs-mdCard__line">
              <GcsGroupLink groupId={active.groupId} /> {active.expiresAt ? t("cards.vipUntil", { date: dateLong(active.expiresAt) }) : t("cards.vipPermanent")}
            </p>
          ) : (
            <p className="gcs-mdCard__muted">{t("cards.vipNone")}</p>
          )}
          <Link href={tabHref("profile")} className="gcs-mdCard__more">
            {t("cards.manage")}
          </Link>
        </Section>

        <Section title={t("cards.quotas")} icon="fa-solid fa-gauge" testId="gcs-member-card-quotas">
          <ul className="gcs-memberQuotas">
            {quotas.map((q) => (
              <li key={q.key}>
                <span>{t(`cards.quota.${q.key}`)}</span>
                <strong>
                  {q.used !== null ? `${format.number(q.used)} / ` : ""}
                  {q.limit < 0 ? t("cards.unlimited") : t(`cards.unit.${q.unit}`, { value: q.limit })}
                </strong>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("groups.title")} icon="fa-solid fa-users" testId="gcs-member-groups">
          <GcsActionForm action={setPrimaryGroup.bind(null, m.id)} submitLabel={t("groups.save")} submitKind="save">
            <label className="gcs-field">
              {t("groups.primary")}
              <select className="gcs-input" name="groupId" defaultValue={m.primaryGroup.id}>
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
            {m.secondaryGroups.length === 0 && <p className="gcs-mdCard__muted">{t("groups.none")}</p>}
            {m.secondaryGroups.map((g) => (
              <div key={g.id} className="gcs-memberRow gcs-memberSecondary" data-testid="gcs-member-secondary" data-group={g.key}>
                <span className="gcs-memberSecondary__who">
                  <GcsGroupLink groupId={g.id} size="sm" />
                  <span className="gcs-mdCard__muted" data-testid="gcs-member-secondary-meta">
                    {g.expiresAt ? t("groups.expires", { date: dateLong(g.expiresAt) }) : t("groups.noExpiry")} · {t(`groups.sources.${["manual", "store", "servers", "promotion", "optin", "vip", "import"].includes(g.source) ? g.source : "other"}`)}
                  </span>
                </span>
                <span className="gcs-memberSecondary__actions">
                  <GcsActionForm compact variant="ghost" action={setSecondaryExpiry.bind(null, m.id, g.id)} submitLabel={t("groups.extend")} submitKind="extend">
                    <input className="gcs-input gcs-input--sm" type="date" name="expiresAt" aria-label={t("groups.expiresAt", { group: g.name })} defaultValue={g.expiresAt ? g.expiresAt.toISOString().slice(0, 10) : ""} />
                  </GcsActionForm>
                  <GcsActionForm compact variant="ghost" action={removeSecondaryGroup.bind(null, m.id, g.id)} submitLabel={t("groups.remove", { group: g.name })} submitKind="remove" />
                </span>
              </div>
            ))}
          </div>
          {addable.length > 0 && (
            <GcsActionForm action={addSecondaryGroup.bind(null, m.id)} submitLabel={t("groups.addSubmit")} submitKind="create" variant="ghost">
              <div className="gcs-memberSecondary__add">
                <label className="gcs-field">
                  {t("groups.add")}
                  <select className="gcs-input" name="groupId" data-testid="gcs-member-add-group">
                    {addable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gcs-field">
                  {t("groups.expiresAtLabel")}
                  <input className="gcs-input" type="date" name="expiresAt" data-testid="gcs-member-add-expiry" />
                </label>
              </div>
              <p className="gcs-mdCard__muted">{t("groups.expiryHint")}</p>
            </GcsActionForm>
          )}
        </Section>

        <Section title={t("warn.title")} icon="fa-solid fa-triangle-exclamation" testId="gcs-member-card-warnings">
          <p className="gcs-mdCard__line">
            <strong>{t("cards.warnPoints", { count: warnPoints })}</strong>
          </p>
          <GcsActionForm action={warnMember.bind(null, m.id)} submitLabel={t("warn.submit")} submitKind="warn">
            {warnReasons.length > 0 && (
              <label className="gcs-field">
                {t("warn.preset")}
                <select className="gcs-input" name="reasonId" defaultValue="" data-testid="gcs-warn-preset">
                  <option value="">{t("warn.presetNone")}</option>
                  {warnReasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {t("warn.presetOption", { name: r.name, points: r.points })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="gcs-field">
              {t("warn.points")}
              <input className="gcs-input" name="points" type="number" min={1} max={100} placeholder={t("warn.fromPreset")} />
            </label>
            <label className="gcs-field">
              {t("warn.reason")}
              <input className="gcs-input" name="reason" maxLength={500} placeholder={t("warn.fromPreset")} />
            </label>
            <label className="gcs-field">
              {t("warn.expiresDays")}
              <input className="gcs-input" name="expiresDays" type="number" min={0} placeholder={t("warn.fromPreset")} />
            </label>
          </GcsActionForm>
          <div>
            <span className="gcs-field">{t("warn.history")}</span>
            {m.warnings.length === 0 && <p className="gcs-mdCard__muted">{t("warn.none")}</p>}
            {m.warnings.map((w) => (
              <div key={w.id} className="gcs-memberRow">
                <span>
                  <strong>{w.points}</strong> · {w.reason}
                </span>
                <span className="gcs-mdCard__muted">
                  {w.issuedByName ? t("warn.by", { name: w.issuedByName }) : ""} · {dateLong(w.createdAt)}
                  {w.revokedAt ? ` · ${t("warn.revoked")}` : w.expiresAt && w.expiresAt <= now ? ` · ${t("warn.expired")}` : ""}
                </span>
                {!w.revokedAt && (!w.expiresAt || w.expiresAt > now) && (
                  <GcsActionForm compact variant="ghost" action={revokeWarning.bind(null, w.id)} submitLabel={t("warn.revoke")} submitKind="revoke" confirm={t("warn.revokeConfirm")} />
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title={t("ban.title")} icon="fa-solid fa-ban" id="gcs-member-ban">
          <GcsActionForm action={banMember.bind(null, m.id)} submitLabel={t("ban.submit")} submitKind="ban">
            <label className="gcs-field">
              {t("ban.reason")}
              <input className="gcs-input" name="reason" required maxLength={500} defaultValue={props.banReason} autoFocus={props.autoFocusBan} data-testid="gcs-acp-ban-reason" />
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
            {m.bans.length === 0 && <p className="gcs-mdCard__muted">{t("ban.none")}</p>}
            {m.bans.map((b) => {
              const status = b.liftedAt ? "lifted" : b.expiresAt && b.expiresAt <= now ? "expired" : "active";
              return (
                <div key={b.id} className="gcs-memberRow">
                  <span>
                    {b.reason} ·{" "}
                    <span className="gcs-mdCard__muted">
                      {b.expiresAt ? t("ban.until", { date: format.dateTime(b.expiresAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("ban.permanent")}
                    </span>
                  </span>
                  <span className="gcs-memberRow__end">
                    <GcsBadge tone={status === "active" ? "accent" : "neutral"}>{t(`ban.status.${status}`)}</GcsBadge>
                    {status === "active" && <GcsActionForm compact variant="ghost" action={liftBan.bind(null, b.id)} submitLabel={t("ban.lift")} submitKind="lift" />}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title={t("ips.title")} icon="fa-solid fa-network-wired">
          {m.ips.length === 0 ? <p className="gcs-mdCard__muted">{t("ips.none")}</p> : <p className="gcs-memberId__mono">{m.ips.join(", ")}</p>}
          <span className="gcs-field">{t("ips.shared")}</span>
          {m.sharedIpAccounts.length === 0 && <p className="gcs-mdCard__muted">{t("ips.sharedNone")}</p>}
          {m.sharedIpAccounts.map((a) => (
            <div key={a.id} className="gcs-memberRow">
              <GcsMemberLink user={a} href={`/admin/members/${a.id}`} />
              <span className="gcs-mdCard__muted">{a.ip}</span>
            </div>
          ))}
        </Section>

        {/* Donațiile membrului (VIP clasic › Donații): starea fiecăreia, confirmarea cererilor „Am donat”, adăugarea și
            insigna automată „Sponsor” (pragul și perioada din Donații › Setări). Lista completă e în ACP › Donații. */}
        {vipOn && (
          <Section title={t("donations.title")} icon="fa-solid fa-hand-holding-heart" testId="gcs-member-donations">
            <p className="gcs-mdCard__muted">
              {sponsor.sponsor ? t("donations.sponsor") : t("donations.hint")}{" "}
              <Link href={`/admin/vip/donations?q=${encodeURIComponent(m.name)}`}>{t("donations.all")}</Link>
            </p>
            {donationRows.map((d) => (
              <div key={d.id} className="gcs-memberRow" data-testid="gcs-member-donation" data-status={d.status}>
                <span>
                  <strong>{formatMoney(d.amount, d.currency, locale)}</strong>
                  <span className="gcs-mdCard__muted">
                    {" "}
                    · {t(`donations.status.${d.status}`)}
                    {d.method && ` · ${d.method}`}
                    {d.anonymous && ` · ${t("donations.anonymous")}`}
                    {d.note && ` · ${d.note}`}
                  </span>
                </span>
                <span className="gcs-memberRow__end">
                  <span className="gcs-mdCard__muted">{dateLong(d.donatedAt)}</span>
                  {canDonations && d.status === "PENDING" && (
                    <GcsActionForm compact variant="primary" action={confirmDonation.bind(null, d.id)} submitLabel={t("donations.confirm")} submitKind="approve" confirm={t("donations.confirmBody")} />
                  )}
                  {canDonations && <GcsActionForm compact variant="ghost" action={deleteDonation.bind(null, d.id)} submitLabel={t("donations.delete")} submitKind="delete" confirm={t("donations.confirmDelete")} />}
                </span>
              </div>
            ))}
            {canDonations && (
              <GcsActionForm action={addMemberDonation.bind(null, m.id)} submitLabel={t("donations.add")} submitKind="create" variant="ghost">
                <GcsDonationFields
                  idPrefix="gcs-member-don"
                  methods={donationMethods}
                  showMember={false}
                  values={{ member: "", donorName: "", amount: "", currency: donationCurrency, donatedAt: "", method: "", reference: "", note: "", anonymous: false, status: "CONFIRMED" }}
                />
              </GcsActionForm>
            )}
          </Section>
        )}

        {props.panels.map((p) => (
          <Section key={p.key} title={p.label} icon={p.icon} testId={`gcs-member-panel-${p.key}`}>
            <GcsMemberPanelBody panel={p} userId={props.memberId} surface="acp" viewer={props.actor} />
          </Section>
        ))}
      </div>
    );
  }

  async function ActivityTab({ userId }: { userId: string }) {
    const [activity, posts, devices] = await Promise.all([
      memberActivity(userId, 90),
      db.post.findMany({ where: { authorId: userId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, createdAt: true, topic: { select: { id: true, title: true } } } }),
      db.userDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 10 }),
    ]);
    return (
      <div className="gcs-mdGrid">
        <Section title={t("activity.chart")} icon="fa-solid fa-chart-column" wide testId="gcs-member-activity-chart">
          <ActivityBars days={activity} label={(d) => t("cards.activityDay", { day: d.day, posts: d.posts, chat: d.chat })} />
        </Section>
        <Section title={t("activity.posts")} icon="fa-solid fa-comments">
          {posts.length === 0 && <p className="gcs-mdCard__muted">{t("activity.none")}</p>}
          {posts.map((p) => (
            <div key={p.id} className="gcs-memberRow">
              <Link href={`/topic/${p.topic.id}/post/${p.id}`}>{p.topic.title}</Link>
              <span className="gcs-mdCard__muted">{format.relativeTime(p.createdAt)}</span>
            </div>
          ))}
        </Section>
        <Section title={t("activity.devices")} icon="fa-solid fa-laptop">
          {devices.length === 0 && <p className="gcs-mdCard__muted">{t("activity.none")}</p>}
          {devices.map((d) => (
            <div key={d.id} className="gcs-memberRow">
              <span>
                {d.browser} · {d.os}
              </span>
              <span className="gcs-mdCard__muted">
                {d.ip ?? "—"} {d.location ? `· ${d.location}` : ""} · {format.relativeTime(d.lastSeenAt)}
              </span>
            </div>
          ))}
        </Section>
      </div>
    );
  }

  async function PermissionsTab({ userId }: { userId: string }) {
    const overrides = await permissions.userPermissions(userId);
    const permDefs = registry.permissionDefs().filter((d) => d.scope === "group");
    return (
      <Section title={t("perms.title")} icon="fa-solid fa-key" wide>
        <p className="gcs-mdCard__muted">{t("perms.hint")}</p>
        <GcsActionForm action={saveMemberPermissions.bind(null, userId)} submitLabel={t("perms.save")} submitKind="save">
          <div className="gcs-permGrid" data-testid="gcs-member-permissions">
            {permDefs.map((def) => {
              const value = overrides[def.key];
              const numeric = typeof Object.values(def.default).find((v) => v !== undefined) === "number";
              const label = permissionLabel(def, tAll, registry);
              return (
                <label key={def.key} className="gcs-field gcs-permGrid__row">
                  <span>
                    {label} <code className="gcs-mdCard__muted">{def.key}</code>
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
    );
  }

  async function LogTab({ userId }: { userId: string }) {
    const rows = await memberAccountLog(userId);
    return (
      <Section title={t("log.title")} icon="fa-solid fa-clipboard-list" wide testId="gcs-member-log">
        {rows.length === 0 && <p className="gcs-mdCard__muted">{t("log.empty")}</p>}
        <ul className="gcs-memberLog">
          {rows.map((r) => (
            <li key={r.id} data-action={r.action}>
              <code>{r.action}</code>
              <span>{r.self ? t("log.self") : r.actorName ? t("log.by", { name: r.actorName }) : t("log.system")}</span>
              <span className="gcs-mdCard__muted">
                {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                {r.ip ? ` · ${r.ip}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <Link href={`/admin/logs?target=${encodeURIComponent(userId)}`} className="gcs-mdCard__more">
          {t("log.all")}
        </Link>
      </Section>
    );
  }
}
