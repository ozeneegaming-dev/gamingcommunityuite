import { GDPR_ACP_SECTION, MEMBER_REMOVAL_ACP_SECTION, type GcsResult } from "@gcs/core";
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
import { GcsMemberPanelBody, memberPanels, type GcsMemberPanel } from "@/lib/member-panels";
import { permissionLabel } from "@/lib/permission-label";
import { services } from "@/lib/services";
import { GcsActionForm, type GcsActionKind } from "../../_components/GcsActionForm";
import { GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { addSecondaryGroup, banMember, liftBan, removeSecondaryGroup, revokeWarning, setPrimaryGroup, setSecondaryExpiry, warnMember } from "../actions";
import { addMemberDonation, confirmDonation, deleteDonation } from "../../vip/donations/actions";
import { GcsDonationFields } from "../../vip/donations/GcsDonationFields";
import { disableMemberTwoFactor, forcePasswordReset, markSpammerAction, saveMemberPermissions, setSpammer, unlockMember, unlockMemberLogin, validateMember } from "./actions";
import { GcsMemberActionButton, GcsMemberActions, GcsMemberCardAction, GcsMemberMoreMenu, type GcsMemberMenuItem, type GcsMemberModal } from "./GcsMemberActions";
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

/** Coloana din „Prezentare” în care stă cardul unei aplicații (restul, ex. pluginurile, în mijloc). */
const PANEL_COLUMN: Record<string, 0 | 1 | 2> = { game_identities: 0, mix_elo: 0, clan_membership: 0, connections: 2 };

/** Un card al fișei: titlul cu iconiță, opțional o legătură în dreapta lui (deschide popupul acțiunii), conținutul. */
function Card({ title, icon, children, testId, id, action, wide }: { title: string; icon: string; children: ReactNode; testId?: string; id?: string; action?: ReactNode; wide?: boolean }) {
  return (
    <GcsCard as="section" aria-label={title} className={`gcs-mpCard${wide ? " gcs-mpCard--wide" : ""}`} data-testid={testId} id={id}>
      <div className="gcs-acpWidget__header gcs-mpCard__head">
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={icon} />
          {title}
        </h2>
        {action}
      </div>
      <div className="gcs-mpCard__body">{children}</div>
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

/** Popupul unei acțiuni fără câmpuri: textul de confirmare și butonul (popupul e chiar pasul de confirmare). */
function ConfirmBody({ text, action, label, kind }: { text: string; action: (fd: FormData) => Promise<GcsResult<unknown>>; label: string; kind: GcsActionKind }) {
  return (
    <div className="gcs-mpModal__stack">
      <p className="gcs-mpModal__lead">{text}</p>
      <GcsActionForm action={action} submitLabel={label} submitKind={kind} />
    </div>
  );
}

/**
 * ACP → Membri → membrul (Membri v2): capul cu datele principale și bara de acțiuni (cele folosite des la vedere,
 * restul în „Mai multe”, „Șterge” separat; fiecare acțiune se deschide în popup), apoi taburile Prezentare / Profil /
 * Activitate / Permisiuni / Jurnal și taburile aplicațiilor. „Prezentare” are trei coloane de carduri doar cu
 * informații (fără formulare deschise), care se umplu fără goluri; cardurile aplicațiilor apar doar cu aplicația pornită.
 */
export default async function AcpMemberPage({ params, searchParams }: Props) {
  const panel = await requireAcpSection("members.members");
  const { id } = await params;
  // „Ban pe site…” din meniul de moderare al chat-ului: popupul Ban se deschide cu motivul completat.
  const sp = (await searchParams) ?? {};
  const banReason = typeof sp.reason === "string" ? sp.reason.slice(0, 500) : "";
  const { members, db, memberRemoval, acp, permissions, registry, donations, vip, apps, loginLockout, warnings } = services();
  const member = await members.detail(id);
  if (!member) notFound();
  const [t, tr, tAll, format, panels] = await Promise.all([getTranslations("acp.member"), getTranslations("acp.removal"), getTranslations(), getFormatter(), memberPanels("acp", panel.actor)]);
  const tabs: { key: string; label: string; icon: string }[] = [
    ...BASE_TABS.map(([key, icon]) => ({ key, label: t(`tabs.${key}`), icon })),
    ...panels.filter((p) => p.kind === "tab").map((p) => ({ key: p.key, label: p.label, icon: p.icon })),
  ];
  const tab = tabs.some((x) => x.key === sp.tab) ? sp.tab! : "overview";
  const [canRemove, canGdpr, removal, rootGroup, hasPassword, canSpam, loginLockedUntil, groups, warnReasons, donationRows, sponsor, donationMethods, donationCurrency, vipOn, canDonations, locale] =
    await Promise.all([
      acp.can(panel.actor, MEMBER_REMOVAL_ACP_SECTION, "delete"),
      acp.can(panel.actor, GDPR_ACP_SECTION, "view"),
      memberRemoval.activeFor(member.id),
      db.group.findUnique({ where: { key: "root_admin" }, select: { id: true } }),
      db.account.count({ where: { userId: member.id, providerId: "credential", password: { not: null } } }),
      acp.can(panel.actor, "members.antispam", "edit"),
      // ACP → Setări → Securitate: contul blocat după parole greșite (expiră singur; staff-ul îl poate debloca).
      loginLockout.lockedUntil(member.id).catch(() => null),
      db.group.findMany({ where: { key: { not: "guest" } }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
      warnings.reasons(),
      donations.mine(member.id),
      donations.sponsor(member.id),
      donations.methods(),
      donations.mainCurrency(),
      apps.enabled("vip"),
      acp.can(panel.actor, DONATIONS_ACP_SECTION, "edit"),
      getLocale(),
    ]);
  const actorIsRoot = !!rootGroup && panel.actor.groupIds.includes(rootGroup.id);
  const now = new Date();
  const m = member;
  const dateLong = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  const tabHref = (key: string) => (key === "overview" ? `/admin/members/${m.id}` : `/admin/members/${m.id}?tab=${encodeURIComponent(key)}`);
  const banned = m.bans.some((b) => !b.liftedAt && (!b.expiresAt || b.expiresAt > now));
  const activeWarning = (w: (typeof m.warnings)[number]) => !w.revokedAt && (!w.expiresAt || w.expiresAt > now);
  const warnPoints = m.warnings.filter(activeWarning).reduce((s, w) => s + w.points, 0);
  const banStatus = (b: (typeof m.bans)[number]) => (b.liftedAt ? "lifted" : b.expiresAt && b.expiresAt <= now ? "expired" : "active");
  const banUntil = (b: (typeof m.bans)[number]) => (b.expiresAt ? t("ban.until", { date: format.dateTime(b.expiresAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("ban.permanent"));
  const sourceLabel = (source: string) => t(`groups.sources.${["manual", "store", "servers", "promotion", "optin", "vip", "import"].includes(source) ? source : "other"}`);
  const secondaryIds = new Set(m.secondaryGroups.map((g) => g.id));
  const addable = groups.filter((g) => g.id !== m.primaryGroup.id && !secondaryIds.has(g.id));
  const donationsOn = vipOn && canDonations;
  const canDeleteOrMerge = canRemove && (!removal || removal.status === "SCHEDULED");

  // ─── Popupurile acțiunilor (formularele existente, deschise din bară, din „Mai multe” și din carduri) ──────────
  const modals: Record<string, GcsMemberModal> = {
    groups: {
      title: t("groups.title"),
      icon: <GcsIcon name="fa-solid fa-users" />,
      size: "lg",
      body: (
        <div className="gcs-mpModal__stack" data-testid="gcs-member-groups">
          <fieldset className="gcs-formSec">
            <legend>{t("groups.primary")}</legend>
            <GcsActionForm action={setPrimaryGroup.bind(null, m.id)} submitLabel={t("groups.save")} submitKind="save">
              <label className="gcs-field">
                {t("groups.group")}
                <select className="gcs-input" name="groupId" defaultValue={m.primaryGroup.id} data-testid="gcs-member-primary-group">
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            </GcsActionForm>
          </fieldset>
          <fieldset className="gcs-formSec">
            <legend>{t("groups.secondary")}</legend>
            {m.secondaryGroups.length === 0 && <p className="gcs-mpMuted">{t("groups.none")}</p>}
            {m.secondaryGroups.map((g) => (
              <div key={g.id} className="gcs-mpRow gcs-mpRow--top" data-testid="gcs-member-secondary-edit" data-group={g.key}>
                <span className="gcs-mpRow__who">
                  <GcsGroupLink groupId={g.id} size="sm" />
                  <span className="gcs-mpMuted">
                    {g.expiresAt ? t("groups.expires", { date: dateLong(g.expiresAt) }) : t("groups.noExpiry")} · {sourceLabel(g.source)}
                  </span>
                </span>
                <span className="gcs-mpRow__end">
                  <GcsActionForm compact variant="ghost" action={setSecondaryExpiry.bind(null, m.id, g.id)} submitLabel={t("groups.extend")} submitKind="extend">
                    <input className="gcs-input gcs-input--sm" type="date" name="expiresAt" aria-label={t("groups.expiresAt", { group: g.name })} defaultValue={g.expiresAt ? g.expiresAt.toISOString().slice(0, 10) : ""} />
                  </GcsActionForm>
                  <GcsActionForm compact variant="ghost" action={removeSecondaryGroup.bind(null, m.id, g.id)} submitLabel={t("groups.remove", { group: g.name })} submitKind="remove" />
                </span>
              </div>
            ))}
          </fieldset>
          {addable.length > 0 && (
            <fieldset className="gcs-formSec">
              <legend>{t("groups.add")}</legend>
              <GcsActionForm action={addSecondaryGroup.bind(null, m.id)} submitLabel={t("groups.addSubmit")} submitKind="create">
                <div className="gcs-formGrid">
                  <label className="gcs-field">
                    {t("groups.group")}
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
                <p className="gcs-mpMuted">{t("groups.expiryHint")}</p>
              </GcsActionForm>
            </fieldset>
          )}
        </div>
      ),
    },
    warn: {
      title: t("warn.modalTitle"),
      icon: <GcsIcon name="fa-solid fa-triangle-exclamation" />,
      body: (
        <div className="gcs-mpModal__stack">
          <p className="gcs-mpModal__lead">{t("cards.warnPoints", { count: warnPoints })}</p>
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
              {t("warn.reason")}
              <input className="gcs-input" name="reason" maxLength={500} placeholder={t("warn.fromPreset")} />
            </label>
            <div className="gcs-formGrid">
              <label className="gcs-field">
                {t("warn.points")}
                <input className="gcs-input" name="points" type="number" min={1} max={100} placeholder={t("warn.fromPreset")} />
              </label>
              <label className="gcs-field">
                {t("warn.expiresDays")}
                <input className="gcs-input" name="expiresDays" type="number" min={0} placeholder={t("warn.fromPreset")} />
              </label>
            </div>
          </GcsActionForm>
          {m.warnings.length > 0 && (
            <fieldset className="gcs-formSec">
              <legend>{t("warn.history")}</legend>
              {m.warnings.map((w) => (
                <div key={w.id} className="gcs-mpRow">
                  <span className="gcs-mpRow__who">
                    <span>
                      <strong>{w.points}</strong> · {w.reason}
                    </span>
                    <span className="gcs-mpMuted">
                      {w.issuedByName ? `${t("warn.by", { name: w.issuedByName })} · ` : ""}
                      {dateLong(w.createdAt)}
                      {w.revokedAt ? ` · ${t("warn.revoked")}` : w.expiresAt && w.expiresAt <= now ? ` · ${t("warn.expired")}` : ""}
                    </span>
                  </span>
                  {activeWarning(w) && <GcsActionForm compact variant="ghost" action={revokeWarning.bind(null, w.id)} submitLabel={t("warn.revoke")} submitKind="revoke" confirm={t("warn.revokeConfirm")} />}
                </div>
              ))}
            </fieldset>
          )}
        </div>
      ),
    },
    ban: {
      title: t("ban.modalTitle"),
      icon: <GcsIcon name="fa-solid fa-gavel" />,
      body: (
        <div className="gcs-mpModal__stack" id="gcs-member-ban">
          <GcsActionForm action={banMember.bind(null, m.id)} submitLabel={t("ban.submit")} submitKind="ban">
            <label className="gcs-field">
              {t("ban.reason")}
              <input className="gcs-input" name="reason" required maxLength={500} defaultValue={banReason} data-testid="gcs-acp-ban-reason" />
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
          {m.bans.length > 0 && (
            <fieldset className="gcs-formSec">
              <legend>{t("ban.history")}</legend>
              {m.bans.map((b) => {
                const status = banStatus(b);
                return (
                  <div key={b.id} className="gcs-mpRow">
                    <span className="gcs-mpRow__who">
                      <span>{b.reason}</span>
                      <span className="gcs-mpMuted">{banUntil(b)}</span>
                    </span>
                    <span className="gcs-mpRow__end">
                      <GcsBadge tone={status === "active" ? "accent" : "neutral"}>{t(`ban.status.${status}`)}</GcsBadge>
                      {status === "active" && <GcsActionForm compact variant="ghost" action={liftBan.bind(null, b.id)} submitLabel={t("ban.lift")} submitKind="lift" />}
                    </span>
                  </div>
                );
              })}
            </fieldset>
          )}
        </div>
      ),
    },
  };
  // Donațiile membrului (VIP clasic › Donații): confirmarea cererilor „Am donat”, ștergerea și adăugarea. Lista completă
  // e în ACP › Donații; insigna „Sponsor” vine automat peste pragul din Donații › Setări.
  if (donationsOn) {
    modals.donation = {
      title: t("donations.title"),
      icon: <GcsIcon name="fa-solid fa-hand-holding-heart" />,
      size: "lg",
      body: (
        <div className="gcs-mpModal__stack">
          <p className="gcs-mpMuted">
            {sponsor.sponsor ? t("donations.sponsor") : t("donations.hint")} <Link href={`/admin/vip/donations?q=${encodeURIComponent(m.name)}`}>{t("donations.all")}</Link>
          </p>
          {donationRows.length > 0 && (
            <fieldset className="gcs-formSec">
              <legend>{t("donations.list")}</legend>
              {donationRows.map((d) => (
                <div key={d.id} className="gcs-mpRow" data-testid="gcs-member-donation" data-status={d.status}>
                  <span className="gcs-mpRow__who">
                    <strong>{formatMoney(d.amount, d.currency, locale)}</strong>
                    <span className="gcs-mpMuted">
                      {t(`donations.status.${d.status}`)} · {dateLong(d.donatedAt)}
                      {d.method && ` · ${d.method}`}
                      {d.anonymous && ` · ${t("donations.anonymous")}`}
                      {d.note && ` · ${d.note}`}
                    </span>
                  </span>
                  <span className="gcs-mpRow__end">
                    {d.status === "PENDING" && (
                      <GcsActionForm compact variant="primary" action={confirmDonation.bind(null, d.id)} submitLabel={t("donations.confirm")} submitKind="approve" confirm={t("donations.confirmBody")} />
                    )}
                    <GcsActionForm compact variant="ghost" action={deleteDonation.bind(null, d.id)} submitLabel={t("donations.delete")} submitKind="delete" confirm={t("donations.confirmDelete")} />
                  </span>
                </div>
              ))}
            </fieldset>
          )}
          <fieldset className="gcs-formSec">
            <legend>{t("donations.add")}</legend>
            <GcsActionForm action={addMemberDonation.bind(null, m.id)} submitLabel={t("donations.add")} submitKind="create">
              <GcsDonationFields
                idPrefix="gcs-member-don"
                methods={donationMethods}
                showMember={false}
                values={{ member: "", donorName: "", amount: "", currency: donationCurrency, donatedAt: "", method: "", reference: "", note: "", anonymous: false, status: "CONFIRMED" }}
              />
            </GcsActionForm>
          </fieldset>
        </div>
      ),
    };
  }
  if (hasPassword > 0) {
    modals.password = { title: t("actions.resetPassword"), icon: <GcsIcon name="fa-solid fa-key" />, size: "sm", body: <ConfirmBody text={t("actions.resetPasswordConfirm")} action={forcePasswordReset.bind(null, m.id)} label={t("actions.resetPassword")} kind="reset" /> };
  }
  if (!m.emailVerified) {
    modals.validate = { title: t("actions.validate"), icon: <GcsIcon name="fa-solid fa-check" />, size: "sm", body: <ConfirmBody text={t("actions.validateConfirm")} action={validateMember.bind(null, m.id)} label={t("actions.validate")} kind="approve" /> };
  }
  if (m.isSpammer) {
    modals.unspammer = { title: t("actions.unspammer"), icon: <GcsIcon name="fa-solid fa-user-check" />, size: "sm", body: <ConfirmBody text={t("actions.unspammerConfirm")} action={setSpammer.bind(null, m.id, false)} label={t("actions.unspammer")} kind="reset" /> };
  } else if (canSpam) {
    // Anti-spam: acțiunea completă, cu opțiunile ei (conținut, IP, domeniu, raportare).
    modals.spammer = {
      title: t("actions.spammer"),
      icon: <GcsIcon name="fa-solid fa-user-slash" />,
      body: (
        <div className="gcs-mpModal__stack">
          <p className="gcs-mpModal__lead">{t("actions.spammerConfirm")}</p>
          <GcsActionForm action={markSpammerAction.bind(null, m.id)} submitLabel={t("spammer.submit")} submitKind="ban">
            <label className="gcs-toggleRow">
              <span>{t("spammer.hide")}</span>
              <input type="checkbox" name="hide" defaultChecked />
            </label>
            <label className="gcs-toggleRow">
              <span>{t("spammer.banIp")}</span>
              <input type="checkbox" name="banIp" defaultChecked />
            </label>
            <label className="gcs-toggleRow">
              <span>{t("spammer.banDomain")}</span>
              <input type="checkbox" name="banDomain" />
            </label>
            <label className="gcs-toggleRow">
              <span>{t("spammer.report")}</span>
              <input type="checkbox" name="report" />
            </label>
            <label className="gcs-field">
              {t("spammer.reason")}
              <input className="gcs-input" name="reason" maxLength={300} placeholder="spam" />
            </label>
          </GcsActionForm>
        </div>
      ),
    };
  } else {
    modals.spammer = { title: t("actions.spammer"), icon: <GcsIcon name="fa-solid fa-user-slash" />, size: "sm", body: <ConfirmBody text={t("actions.spammerConfirm")} action={setSpammer.bind(null, m.id, true)} label={t("actions.spammer")} kind="ban" /> };
  }
  if (m.twoFactorLocked) {
    modals.unlock = { title: t("actions.unlock"), icon: <GcsIcon name="fa-solid fa-unlock" />, size: "sm", body: <ConfirmBody text={t("actions.unlockConfirm")} action={unlockMember.bind(null, m.id)} label={t("actions.unlock")} kind="lift" /> };
  }
  if (loginLockedUntil) {
    modals.unlockLogin = { title: t("actions.unlockLogin"), icon: <GcsIcon name="fa-solid fa-unlock-keyhole" />, size: "sm", body: <ConfirmBody text={t("actions.unlockLoginConfirm")} action={unlockMemberLogin.bind(null, m.id)} label={t("actions.unlockLogin")} kind="lift" /> };
  }
  if (actorIsRoot && m.twoFactorEnabled) {
    modals.disable2fa = { title: t("actions.disable2fa"), icon: <GcsIcon name="fa-solid fa-shield-halved" />, size: "sm", body: <ConfirmBody text={t("actions.disable2faConfirm")} action={disableMemberTwoFactor.bind(null, m.id)} label={t("actions.disable2fa")} kind="remove" /> };
  }

  // „Mai multe”: acțiunile rare ale contului, apoi paginile cu confirmarea lor (unirea) și exportul GDPR.
  const more: GcsMemberMenuItem[] = [];
  const addModal = (which: string, icon: string, testId: string) => {
    const x = modals[which];
    if (x) more.push({ kind: "modal", which, label: x.title, icon: <GcsIcon name={icon} />, testId });
  };
  addModal("validate", "fa-solid fa-check", "gcs-member-validate");
  addModal("spammer", "fa-solid fa-user-slash", "gcs-member-spammer");
  addModal("unspammer", "fa-solid fa-user-check", "gcs-member-unspammer");
  addModal("unlock", "fa-solid fa-unlock", "gcs-member-unlock");
  addModal("unlockLogin", "fa-solid fa-unlock-keyhole", "gcs-member-unlock-login");
  addModal("disable2fa", "fa-solid fa-shield-halved", "gcs-member-disable2fa");
  if (canDeleteOrMerge || canGdpr) more.push({ kind: "separator" });
  if (canDeleteOrMerge) more.push({ kind: "link", href: `/admin/members/${m.id}/merge`, label: tr("mergeOpen"), icon: <GcsIcon name="fa-solid fa-code-merge" />, testId: "gcs-member-merge" });
  if (canGdpr) more.push({ kind: "link", href: `/admin/members/${m.id}/gdpr.zip`, label: t("actions.gdpr"), icon: <GcsIcon name="fa-solid fa-file-zipper" />, testId: "gcs-member-gdpr-export" });

  return (
    <>
      <Link href="/admin/members" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>

      <GcsMemberActions modals={modals} initial={sp.ban === "1" ? "ban" : null} closeLabel={t("modalClose")}>
        <GcsCard as="section" className="gcs-mpHead" aria-label={t("identity.title")} data-testid="gcs-member-identity">
          <div className="gcs-mpHead__top">
            <GcsAvatar name={m.name} size="l" className="gcs-mpHead__avatar" {...(m.image ? { src: m.image } : {})} />
            <div className="gcs-mpHead__who">
              <div className="gcs-mpHead__line">
                <h1 className="gcs-display gcs-mpHead__name">
                  <GcsMemberLink user={m} href={null} size="full" />
                </h1>
                <GcsGroupLink groupId={m.primaryGroup.id} variant="filled" />
                {banned && <GcsBadge tone="accent">{t("identity.banned")}</GcsBadge>}
                {m.isSpammer && <GcsBadge tone="accent">{t("identity.spammer")}</GcsBadge>}
                <GcsBadge tone={m.emailVerified ? "ok" : "warn"}>{m.emailVerified ? t("identity.validated") : t("identity.unvalidated")}</GcsBadge>
                <GcsBadge tone="neutral">{m.twoFactorEnabled ? t("identity.twoFactorOn") : t("identity.twoFactorOff")}</GcsBadge>
                {m.twoFactorLocked && <GcsBadge tone="accent">{t("identity.locked")}</GcsBadge>}
                {loginLockedUntil && (
                  <GcsBadge tone="accent" data-testid="gcs-member-login-locked">
                    {t("identity.loginLocked", { time: format.dateTime(loginLockedUntil, { timeStyle: "short" }) })}
                  </GcsBadge>
                )}
                {m.passwordResetRequestedAt && <GcsBadge tone="warn">{t("identity.passwordReset")}</GcsBadge>}
              </div>
              <dl className="gcs-mpHead__facts">
                <div>
                  <dt>{t("info.email")}</dt>
                  <dd>{m.email}</dd>
                </div>
                <div>
                  <dt>{t("info.joined")}</dt>
                  <dd>{dateLong(m.createdAt)}</dd>
                </div>
                <div>
                  <dt>{t("info.lastActive")}</dt>
                  <dd>{m.lastActiveAt ? format.relativeTime(m.lastActiveAt) : "—"}</dd>
                </div>
                <div>
                  <dt>{t("identity.posts")}</dt>
                  <dd>{format.number(m.postsCount)}</dd>
                </div>
                <div>
                  <dt>{t("identity.ip")}</dt>
                  <dd className="gcs-mpMono">{m.ips[0] ?? "—"}</dd>
                </div>
              </dl>
            </div>
            <Link href={`/members/${m.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-mpHead__profile">
              <span className="gcs-btn__icon" aria-hidden="true">
                <GcsIcon name="fa-solid fa-eye" />
              </span>
              {t("info.viewProfile")}
            </Link>
          </div>

          <div className="gcs-mpBar" role="group" aria-label={t("bar.label")} data-testid="gcs-member-danger">
            <GcsMemberActionButton which="groups" label={t("bar.groups")} icon={<GcsIcon name="fa-solid fa-users" />} testId="gcs-member-act-groups" />
            <GcsMemberActionButton which="warn" label={t("bar.warn")} icon={<GcsIcon name="fa-solid fa-triangle-exclamation" />} testId="gcs-member-act-warn" />
            <GcsMemberActionButton which="ban" label={t("bar.ban")} icon={<GcsIcon name="fa-solid fa-gavel" />} testId="gcs-member-act-ban" />
            {donationsOn && <GcsMemberActionButton which="donation" label={t("bar.donation")} icon={<GcsIcon name="fa-solid fa-hand-holding-dollar" />} testId="gcs-member-act-donation" />}
            {modals.password && <GcsMemberActionButton which="password" label={t("actions.resetPassword")} icon={<GcsIcon name="fa-solid fa-key" />} testId="gcs-member-act-password" />}
            {more.some((x) => x.kind !== "separator") && <GcsMemberMoreMenu label={t("bar.more")} items={more} testId="gcs-member-more" />}
            {canDeleteOrMerge && (
              <Link href={`/admin/members/${m.id}/delete`} className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-mpBar__delete" data-testid="gcs-member-delete">
                <span className="gcs-btn__icon" aria-hidden="true">
                  <GcsIcon name="fa-solid fa-user-xmark" />
                </span>
                {tr("deleteOpen")}
              </Link>
            )}
          </div>
        </GcsCard>

        {removal && (
          <p className="gcs-removalBanner" data-testid="gcs-member-removal-banner">
            <GcsIcon name={removal.status === "SCHEDULED" ? "fa-solid fa-hourglass-half" : "fa-solid fa-gears"} />
            {removal.status === "SCHEDULED"
              ? tr("memberScheduled", { date: format.dateTime(removal.runAfter ?? new Date(), { dateStyle: "medium", timeStyle: "short" }) })
              : removal.targetId === m.id
                ? tr("memberIsTarget", { name: removal.userName })
                : tr("memberInProgress")}
            {removal.status !== "SCHEDULED" && <Link href={`/admin/members/removals/${removal.id}`}>{tr("viewProgress")}</Link>}
          </p>
        )}

        <nav className="gcs-tabs gcs-memberTabs gcs-mpTabs" aria-label={t("tabs.label")} data-testid="gcs-member-tabs">
          {tabs.map((x) => (
            <Link key={x.key} href={tabHref(x.key)} className={`gcs-tab${tab === x.key ? " gcs-tab--active" : ""}`} aria-current={tab === x.key ? "page" : undefined} data-testid={`gcs-member-tab-${x.key}`}>
              <GcsIcon name={x.icon} className="gcs-tab__icon" /> {x.label}
            </Link>
          ))}
        </nav>

        <div className="gcs-memberTabPanel" key={tab} data-tab={tab}>
          {tab === "overview" && <Overview panels={panels.filter((p) => p.kind === "card")} />}
          {tab === "profile" && <MemberProfileSections userId={m.id} />}
          {tab === "activity" && <ActivityTab userId={m.id} />}
          {tab === "permissions" && <PermissionsTab userId={m.id} />}
          {tab === "log" && <LogTab userId={m.id} />}
          {panels
            .filter((p) => p.kind === "tab" && p.key === tab)
            .map((p) => (
              <Card key={p.key} title={p.label} icon={p.icon} testId={`gcs-member-panel-${p.key}`} wide>
                <GcsMemberPanelBody panel={p} userId={m.id} surface="acp" viewer={panel.actor} />
              </Card>
            ))}
        </div>
      </GcsMemberActions>
    </>
  );

  // ─── Taburile ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * „Prezentare”: trei coloane independente (fiecare își stivuiește cardurile, deci nu rămân goluri între rânduri);
   * pe ecrane mai înguste coloanele se topesc în două, apoi într-una. Cardurile doar arată; acțiunile se deschid în popup.
   */
  async function Overview(props: { panels: GcsMemberPanel[] }) {
    const [activity, content, quotas, extra, badges, active] = await Promise.all([
      memberActivity(m.id, 30),
      memberRemoval.contentSummary(m.id),
      memberQuotas(m.id),
      db.user.findUniqueOrThrow({ where: { id: m.id }, select: { points: true, reputation: true, rank: { select: { name: true } } } }),
      db.userBadge.findMany({ where: { userId: m.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, badge: { select: { name: true } } } }),
      vip.active(m.id),
    ]);
    const totals = activity.reduce((s, d) => ({ posts: s.posts + d.posts, chat: s.chat + d.chat }), { posts: 0, chat: 0 });
    const bySteps = new Map<string, typeof content>();
    for (const item of content) bySteps.set(item.step, [...(bySteps.get(item.step) ?? []), item]);
    // Donațiile: totalul confirmat pe monede, ultima donație și cererile care așteaptă confirmarea.
    const confirmed = new Map<string, number>();
    for (const d of donationRows) if (d.status === "CONFIRMED") confirmed.set(d.currency, (confirmed.get(d.currency) ?? 0) + d.amount);
    const pending = donationRows.filter((d) => d.status === "PENDING").length;
    const lastDonation = donationRows[0];

    const panelCard = (p: GcsMemberPanel) => (
      <Card key={p.key} title={p.label} icon={p.icon} testId={`gcs-member-panel-${p.key}`}>
        <GcsMemberPanelBody panel={p} userId={m.id} surface="acp" viewer={panel.actor} />
      </Card>
    );
    const panelsIn = (col: 0 | 1 | 2) => props.panels.filter((p) => (PANEL_COLUMN[p.key] ?? 1) === col).map(panelCard);

    return (
      <div className="gcs-mpOverview">
        <div className="gcs-mpCols">
          <div className="gcs-mpCol">
            <Card title={t("cards.activity")} icon="fa-solid fa-chart-column" testId="gcs-member-card-activity">
              <ActivityBars days={activity} label={(d) => t("cards.activityDay", { day: d.day, posts: d.posts, chat: d.chat })} />
              <p className="gcs-mpMuted">
                <span className="gcs-legendDot gcs-legendDot--posts" /> {t("cards.activityPosts", { count: totals.posts })} · <span className="gcs-legendDot gcs-legendDot--chat" /> {t("cards.activityChat", { count: totals.chat })}
              </p>
            </Card>

            <Card title={t("ips.title")} icon="fa-solid fa-network-wired" testId="gcs-member-card-ips">
              {m.ips.length === 0 ? (
                <p className="gcs-mpMuted">{t("ips.none")}</p>
              ) : (
                <ul className="gcs-mpList">
                  {m.ips.slice(0, 6).map((ip) => (
                    <li key={ip} className="gcs-mpMono">
                      {ip}
                    </li>
                  ))}
                  {m.ips.length > 6 && <li className="gcs-mpMuted">{t("ips.more", { count: m.ips.length - 6 })}</li>}
                </ul>
              )}
              {m.sharedIpAccounts.length === 0 ? (
                <p className="gcs-mpMuted">{t("ips.sharedNone")}</p>
              ) : (
                <div className="gcs-mpSub">
                  <span className="gcs-mpSub__title">{t("ips.shared")}</span>
                  {m.sharedIpAccounts.map((a) => (
                    <div key={a.id} className="gcs-mpKv">
                      <GcsMemberLink user={a} href={`/admin/members/${a.id}`} />
                      <span className="gcs-mpMono">{a.ip}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {panelsIn(0)}
          </div>

          <div className="gcs-mpCol">
            <Card title={t("cards.rank")} icon="fa-solid fa-ranking-star" testId="gcs-member-card-rank">
              <dl className="gcs-memberPanel__stats gcs-mpStats">
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
            </Card>

            <Card
              title={t("cards.badges")}
              icon="fa-solid fa-award"
              testId="gcs-member-card-badges"
              action={
                <Link href={`${tabHref("profile")}#gcs-acp-member-badges`} className="gcs-mpCard__action">
                  {t("cards.manage")}
                </Link>
              }
            >
              {badges.length === 0 ? (
                <p className="gcs-mpMuted">{t("cards.badgesEmpty")}</p>
              ) : (
                <div className="gcs-memberChips">
                  {badges.map((b) => (
                    <span key={b.id} className="gcs-memberChip">
                      <GcsIcon name="fa-solid fa-award" /> {b.badge.name}
                    </span>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title={t("cards.vip")}
              icon="fa-solid fa-crown"
              testId="gcs-member-card-vip"
              action={
                <Link href={`${tabHref("profile")}#gcs-acp-member-vip`} className="gcs-mpCard__action">
                  {t("cards.manage")}
                </Link>
              }
            >
              {active ? (
                <p className="gcs-mpLine">
                  <GcsGroupLink groupId={active.groupId} /> {active.expiresAt ? t("cards.vipUntil", { date: dateLong(active.expiresAt) }) : t("cards.vipPermanent")}
                </p>
              ) : (
                <p className="gcs-mpMuted">{t("cards.vipNone")}</p>
              )}
            </Card>

            <Card title={t("cards.quotas")} icon="fa-solid fa-gauge" testId="gcs-member-card-quotas">
              {quotas.map((q) => (
                <div key={q.key} className="gcs-mpKv">
                  <span>{t(`cards.quota.${q.key}`)}</span>
                  <strong>
                    {q.used !== null ? `${format.number(q.used)} / ` : ""}
                    {q.limit < 0 ? t("cards.unlimited") : t(`cards.unit.${q.unit}`, { value: q.limit })}
                  </strong>
                </div>
              ))}
            </Card>

            <Card title={t("cards.content")} icon="fa-solid fa-layer-group" testId="gcs-member-card-content">
              {content.length === 0 ? (
                <p className="gcs-mpMuted">{t("cards.contentEmpty")}</p>
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
            </Card>

            {panelsIn(1)}
          </div>

          <div className="gcs-mpCol">
            <Card title={t("groups.title")} icon="fa-solid fa-users" testId="gcs-member-card-groups" action={<GcsMemberCardAction which="groups" label={t("cards.manageGroups")} testId="gcs-member-card-groups-manage" />}>
              <div className="gcs-mpKv">
                <span>{t("cards.groupPrimary")}</span>
                <GcsGroupLink groupId={m.primaryGroup.id} size="sm" />
              </div>
              {m.secondaryGroups.length === 0 ? (
                <div className="gcs-mpKv">
                  <span>{t("cards.groupSecondary")}</span>
                  <span className="gcs-mpMuted">{t("groups.none")}</span>
                </div>
              ) : (
                m.secondaryGroups.map((g, i) => (
                  <div key={g.id} className="gcs-mpKv gcs-mpKv--top" data-testid="gcs-member-secondary" data-group={g.key}>
                    <span>{i === 0 ? t("cards.groupSecondary") : ""}</span>
                    <span className="gcs-mpKv__end">
                      <GcsGroupLink groupId={g.id} size="sm" />
                      <span className="gcs-mpMuted" data-testid="gcs-member-secondary-meta">
                        {g.expiresAt ? t("groups.expires", { date: dateLong(g.expiresAt) }) : t("groups.noExpiry")} · {sourceLabel(g.source)}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </Card>

            <Card title={t("cards.warnings")} icon="fa-solid fa-triangle-exclamation" testId="gcs-member-card-warnings" action={<GcsMemberCardAction which="warn" label={t("warn.submit")} testId="gcs-member-card-warn" />}>
              <p className="gcs-mpLine">
                <strong>{t("cards.warnPoints", { count: warnPoints })}</strong>
              </p>
              {m.warnings.length === 0 ? (
                <p className="gcs-mpMuted">{t("warn.none")}</p>
              ) : (
                <ul className="gcs-mpList">
                  {m.warnings.slice(0, 3).map((w) => (
                    <li key={w.id} className="gcs-mpKv">
                      <span className="gcs-mpKv__text">
                        <strong>{w.points}</strong> · {w.reason}
                      </span>
                      <span className="gcs-mpMuted">{w.revokedAt ? t("warn.revoked") : w.expiresAt && w.expiresAt <= now ? t("warn.expired") : dateLong(w.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t("cards.bans")} icon="fa-solid fa-ban" testId="gcs-member-card-bans" action={<GcsMemberCardAction which="ban" label={t("ban.submit")} testId="gcs-member-card-ban" />}>
              {m.bans.length === 0 ? (
                <p className="gcs-mpMuted">{t("ban.none")}</p>
              ) : (
                <ul className="gcs-mpList">
                  {m.bans.slice(0, 3).map((b) => {
                    const status = banStatus(b);
                    return (
                      <li key={b.id} className="gcs-mpKv" data-status={status}>
                        <span className="gcs-mpKv__text">
                          {b.reason} <span className="gcs-mpMuted">· {banUntil(b)}</span>
                        </span>
                        <GcsBadge tone={status === "active" ? "accent" : "neutral"}>{t(`ban.status.${status}`)}</GcsBadge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {vipOn && (
              <Card
                title={t("donations.title")}
                icon="fa-solid fa-hand-holding-heart"
                testId="gcs-member-donations"
                action={donationsOn ? <GcsMemberCardAction which="donation" label={t("cards.donationAdd")} testId="gcs-member-card-donation" /> : undefined}
              >
                {donationRows.length === 0 ? (
                  <p className="gcs-mpMuted">{t("cards.donationsNone")}</p>
                ) : (
                  <>
                    <div className="gcs-mpKv">
                      <span>{t("cards.donationsTotal")}</span>
                      <strong>{confirmed.size === 0 ? "—" : [...confirmed].map(([c, a]) => formatMoney(a, c, locale)).join(" + ")}</strong>
                    </div>
                    {lastDonation && (
                      <div className="gcs-mpKv">
                        <span>{t("cards.donationsLast")}</span>
                        <strong>
                          {formatMoney(lastDonation.amount, lastDonation.currency, locale)} · {dateLong(lastDonation.donatedAt)}
                        </strong>
                      </div>
                    )}
                    {pending > 0 && <p className="gcs-mpLine">{t("cards.donationsPending", { count: pending })}</p>}
                  </>
                )}
                {sponsor.sponsor && <p className="gcs-mpMuted">{t("donations.sponsor")}</p>}
              </Card>
            )}

            {panelsIn(2)}
          </div>
        </div>
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
      <div className="gcs-mpStack">
        <Card title={t("activity.chart")} icon="fa-solid fa-chart-column" wide testId="gcs-member-activity-chart">
          <ActivityBars days={activity} label={(d) => t("cards.activityDay", { day: d.day, posts: d.posts, chat: d.chat })} />
        </Card>
        <div className="gcs-mpSplit">
          <Card title={t("activity.posts")} icon="fa-solid fa-comments">
            {posts.length === 0 && <p className="gcs-mpMuted">{t("activity.none")}</p>}
            {posts.map((p) => (
              <div key={p.id} className="gcs-mpKv">
                <Link href={`/topic/${p.topic.id}/post/${p.id}`} className="gcs-mpKv__text">
                  {p.topic.title}
                </Link>
                <span className="gcs-mpMuted">{format.relativeTime(p.createdAt)}</span>
              </div>
            ))}
          </Card>
          <Card title={t("activity.devices")} icon="fa-solid fa-laptop">
            {devices.length === 0 && <p className="gcs-mpMuted">{t("activity.none")}</p>}
            {devices.map((d) => (
              <div key={d.id} className="gcs-mpKv gcs-mpKv--top">
                <span>
                  {d.browser} · {d.os}
                </span>
                <span className="gcs-mpMuted">
                  {d.ip ?? "—"} {d.location ? `· ${d.location}` : ""} · {format.relativeTime(d.lastSeenAt)}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    );
  }

  async function PermissionsTab({ userId }: { userId: string }) {
    const overrides = await permissions.userPermissions(userId);
    const permDefs = registry.permissionDefs().filter((d) => d.scope === "group");
    return (
      <Card title={t("perms.title")} icon="fa-solid fa-key" wide>
        <p className="gcs-mpMuted">{t("perms.hint")}</p>
        <GcsActionForm action={saveMemberPermissions.bind(null, userId)} submitLabel={t("perms.save")} submitKind="save">
          <div className="gcs-permGrid" data-testid="gcs-member-permissions">
            {permDefs.map((def) => {
              const value = overrides[def.key];
              const numeric = typeof Object.values(def.default).find((v) => v !== undefined) === "number";
              const label = permissionLabel(def, tAll, registry);
              return (
                <label key={def.key} className="gcs-field gcs-permGrid__row">
                  <span>
                    {label} <code className="gcs-mpMuted">{def.key}</code>
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
      </Card>
    );
  }

  async function LogTab({ userId }: { userId: string }) {
    const rows = await memberAccountLog(userId);
    return (
      <Card
        title={t("log.title")}
        icon="fa-solid fa-clipboard-list"
        wide
        testId="gcs-member-log"
        action={
          <Link href={`/admin/logs?target=${encodeURIComponent(userId)}`} className="gcs-mpCard__action">
            {t("log.all")}
          </Link>
        }
      >
        {rows.length === 0 && <p className="gcs-mpMuted">{t("log.empty")}</p>}
        <ul className="gcs-memberLog">
          {rows.map((r) => (
            <li key={r.id} data-action={r.action}>
              <code>{r.action}</code>
              <span>{r.self ? t("log.self") : r.actorName ? t("log.by", { name: r.actorName }) : t("log.system")}</span>
              <span className="gcs-mpMuted">
                {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                {r.ip ? ` · ${r.ip}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
}
