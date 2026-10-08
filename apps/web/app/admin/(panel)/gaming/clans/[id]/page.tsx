import { CLANS_ACP_SECTION } from "@gcs/modules";
import { GcsCard, GcsClanTag, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";
import { approveClan, disbandClanAcp, rejectClan, setClanArchived, setClanLock, setClanMemberLimit, transferClanLeader } from "../actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const clan = /^\d+$/.test(id) ? await services().db.clan.findUnique({ where: { id: Number(id) }, select: { tag: true, name: true } }) : null;
  return { title: clan ? `[${clan.tag}] ${clan.name}` : (await getTranslations("acp.clans"))("title") };
}

/**
 * Fișa unui clan în ACP (specul 2026-10-08-clanuri §8): aprobarea (în așteptare), blocarea cu motiv, arhivarea /
 * reactivarea, limita de membri, transferul conducerii, desființarea și jurnalul clanului. Descrierea și imaginile se
 * editează din administrarea de pe site (staff-ul are acces la orice clan).
 */
export default async function AcpClanPage({ params }: Props) {
  const { actor } = await requireAcpSection(CLANS_ACP_SECTION);
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const data = await services().clanAdmin.detail(actor, Number(id));
  if (!data) notFound();
  const { clan, members, audit } = data;
  const [t, format, canDelete] = await Promise.all([getTranslations("acp.clans"), getFormatter(), services().acp.can(actor, CLANS_ACP_SECTION, "delete")]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const box = { padding: 20, display: "flex", flexDirection: "column" as const, gap: 12 };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-people-group"
        description={t(`status.${clan.locked ? "LOCKED" : clan.status}`)}
        actions={
          <span style={{ display: "flex", gap: 8 }}>
            <Link className="gcs-btn gcs-btn--ghost" href="/admin/gaming/clans">
              <GcsIcon name="fa-solid fa-arrow-left" />
              {t("back")}
            </Link>
            <Link className="gcs-btn gcs-btn--ghost" href={`${clan.href}/manage?tab=settings`} data-testid="gcs-acp-clan-site">
              <GcsIcon name="fa-solid fa-pen" />
              {t("editOnSite")}
            </Link>
          </span>
        }
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <GcsClanTag clan={clan} plain />
          {clan.name}
        </span>
      </GcsAcpTitle>

      {clan.status === "PENDING" && (
        <GcsCard as="section" style={box} aria-label={t("pendingTitle")}>
          <h2 className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-hourglass-half" />
            {t("pendingTitle")}
          </h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <GcsActionForm action={approveClan.bind(null, clan.id)} submitLabel={t("approve")} submitKind="approve" compact />
            <GcsActionForm action={rejectClan.bind(null, clan.id)} submitLabel={t("reject")} submitKind="reject" variant="ghost" compact redirectTo="/admin/gaming/clans" confirm={t("rejectConfirm", { name: clan.name })}>
              <input className="gcs-input" name="reason" maxLength={500} placeholder={t("rejectReason")} aria-label={t("rejectReason")} style={{ width: 280 }} />
            </GcsActionForm>
          </div>
        </GcsCard>
      )}

      <GcsCard as="section" style={box} aria-label={t("moderationTitle")}>
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-gavel" />
          {t("moderationTitle")}
        </h2>
        {clan.locked ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{clan.lockReason ? t("lockedReason", { reason: clan.lockReason }) : t("locked")}</span>
            <GcsActionForm action={setClanLock.bind(null, clan.id, false)} submitLabel={t("unlock")} submitKind="lift" variant="ghost" compact />
          </div>
        ) : (
          <GcsActionForm action={setClanLock.bind(null, clan.id, true)} submitLabel={t("lock")} submitKind="ban" variant="ghost" compact>
            <input className="gcs-input" name="reason" maxLength={300} placeholder={t("lockReason")} aria-label={t("lockReason")} style={{ width: 280 }} data-testid="gcs-acp-clan-lock-reason" />
          </GcsActionForm>
        )}
        {clan.status === "ACTIVE" && <GcsActionForm action={setClanArchived.bind(null, clan.id, true)} submitLabel={t("archive")} submitKind="hide" variant="ghost" compact />}
        {clan.status === "ARCHIVED" && <GcsActionForm action={setClanArchived.bind(null, clan.id, false)} submitLabel={t("reactivate")} submitKind="reset" variant="ghost" compact />}
        <GcsActionForm action={setClanMemberLimit.bind(null, clan.id)} submitLabel={t("save")} submitKind="save" variant="ghost" compact>
          <label className="gcs-field" style={{ width: 280 }}>
            {t("memberLimit")}
            <input className="gcs-input" type="number" name="memberLimit" min={1} max={10000} defaultValue={clan.memberLimit ?? ""} placeholder={clan.effectiveLimit === null ? t("unlimited") : String(clan.effectiveLimit)} />
            <span className="gcs-field__hint">{t("memberLimitHint")}</span>
          </label>
        </GcsActionForm>
      </GcsCard>

      <GcsCard as="section" style={box} aria-label={t("membersTitle", { count: members.length })}>
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-users" />
          {t("membersTitle", { count: members.length })}
        </h2>
        <ul className="gcs-acpList" style={{ margin: "0 -20px" }}>
          {members.map((m) => (
            <li key={m.user.id} className="gcs-acpList__row">
              <span className="gcs-acpList__main">
                <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
              </span>
              <span className="gcs-acpList__meta">
                {t(`roles.${m.role}`)} — {format.dateTime(new Date(m.joinedAt), { dateStyle: "medium" })}
              </span>
            </li>
          ))}
        </ul>
        {members.length > 1 && (
          <GcsActionForm action={transferClanLeader.bind(null, clan.id)} submitLabel={t("transfer")} submitKind="grant" variant="ghost" compact>
            <select className="gcs-input" name="userId" aria-label={t("transferTo")} style={{ width: 240 }}>
              {members
                .filter((m) => m.role !== "LEADER")
                .map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
            </select>
          </GcsActionForm>
        )}
      </GcsCard>

      {canDelete && (
        <GcsCard as="section" style={box} aria-label={t("disbandTitle")}>
          <h2 className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-triangle-exclamation" />
            {t("disbandTitle")}
          </h2>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("disbandText")}</p>
          <GcsActionForm action={disbandClanAcp.bind(null, clan.id)} submitLabel={t("disband")} submitKind="delete" compact redirectTo="/admin/gaming/clans" confirm={t("disbandConfirm", { name: clan.name })} />
        </GcsCard>
      )}

      <GcsCard as="section" style={{ ...box, padding: "20px 0 8px" }} aria-label={t("auditTitle")}>
        <h2 className="gcs-acpWidget__title" style={{ padding: "0 20px" }}>
          <GcsAcpTitleIcon name="fa-solid fa-clock-rotate-left" />
          {t("auditTitle")}
        </h2>
        <ul className="gcs-acpList" data-testid="gcs-acp-clan-audit">
          {audit.map((a) => (
            <li key={a.id} className="gcs-acpList__row">
              <span className="gcs-acpList__main">
                <span className="gcs-acpList__code">{a.action}</span>
                {a.actor ? <GcsUserLink userId={a.actor.id} name={a.actor.name} nameKey={a.actor.nameKey} href={memberHref(a.actor)} /> : <span className="gcs-muted">{t("system")}</span>}
              </span>
              <span className="gcs-acpList__meta">{date(a.at)}</span>
            </li>
          ))}
        </ul>
      </GcsCard>
    </>
  );
}
