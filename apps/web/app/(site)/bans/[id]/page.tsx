import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { sanctionAbilities } from "@/lib/sanction-form";
import { services } from "@/lib/services";
import { GcsIdentityTag, GcsPlayerLink, GcsSanctionStatus, GcsSanctionType } from "../../_components/servers/GcsBridgeBits";
import { GcsSanctionForm, GcsSanctionLift } from "../../_components/servers/GcsSanctionForm";
import { GcsSanctionTime } from "../../_components/servers/GcsSanctionTime";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const load = cache(async (raw: string) => {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) return null;
  const actor = await currentActor();
  const sanction = await bridge.sanctions.get(actor, Number(raw));
  return sanction ? { actor, sanction } : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).id);
  if (!data) return {};
  const t = await getTranslations("bridge.sanction.type");
  const s = data.sanction;
  return { title: `${t(s.type)}: ${s.player?.name || s.name || s.target.value || `#${s.id}`}`, robots: { index: false } };
}

/**
 * Detaliul unei sancțiuni (specul 2026-10-08-servere-pagini §4): ținta (jucătorul, identitatea, IP-ul doar cu
 * `servers.view_ips`), tipul, scopul, motivul, durata, adminul, sursa, ridicarea și dovezile. Cine o poate modifica
 * (`canSanction`) primește formularul și ridicarea; cel sancționat, butonul „Contestă”.
 */
export default async function SanctionPage({ params }: Props) {
  const data = await load((await params).id);
  if (!data) notFound();
  const { actor, sanction: s } = data;
  const { bridge } = services();
  const [t, format] = await Promise.all([getTranslations("bridge.ban"), getFormatter()]);
  const currentMinutes = s.expiresAt ? Math.round((Date.parse(s.expiresAt) - Date.parse(s.createdAt)) / 60_000) : 0;
  const [canEdit, canLift, canAppeal, abilities] = await Promise.all([
    s.status === "lifted" ? false : bridge.sanctions.canSanction(actor, { type: s.type, scope: s.scope, serverId: s.server?.id ?? null, minutes: currentMinutes }),
    s.status === "lifted" ? false : bridge.sanctions.canSanction(actor, { type: s.type, scope: s.scope, serverId: s.server?.id ?? null, minutes: 1 }),
    bridge.tickets.canAppeal(actor, s.id),
    sanctionAbilities(actor),
  ]);
  const who = s.player?.name || s.name || s.target.value || t("unknown");
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "long", timeStyle: "short" });

  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("bans")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/bans">
                <GcsIcon name="fa-solid fa-gavel" className="gcs-breadcrumb__home" />
                {t("bans")}
              </Link>
            </li>
            <li aria-current="page">#{s.id}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title" data-testid="gcs-ban-title">
            <GcsSanctionType type={s.type} />
            <span>{who}</span>
          </h1>
          <p className="gcs-pageHeader__desc gcs-banHead">
            <GcsSanctionStatus status={s.status} />
            <GcsSanctionTime sanction={s} now={Date.now()} />
          </p>
        </div>
        {canAppeal && (
          <div className="gcs-pageHeader__actions">
            <Link href={`/servers/tickets/new?kind=appeal&sanction=${s.id}`} className="gcs-btn gcs-btn--primary" data-testid="gcs-ban-appeal">
              <GcsIcon name="fa-solid fa-scale-balanced" />
              {t("appeal")}
            </Link>
          </div>
        )}
      </header>

      <div className="gcs-serverLayout">
        <div className="gcs-serverLayout__main">
          <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ban-details">
            <h2 id="gcs-ban-details" className="gcs-display gcs-titleBand gcs-serverBox__title">
              <GcsIcon name="fa-solid fa-circle-info" className="gcs-hIcon" />
              {t("details")}
            </h2>
            <dl className="gcs-serverDl gcs-banDl" data-testid="gcs-ban-details">
              <dt>{t("reason")}</dt>
              <dd className="gcs-banDl__reason">{s.reason}</dd>
              <dt>{t("player")}</dt>
              <dd>{s.player ? <GcsPlayerLink player={s.player} /> : (s.name ?? "—")}</dd>
              {s.target.kind && s.target.value && (
                <>
                  <dt>{t("identity")}</dt>
                  <dd>
                    <GcsIdentityTag kind={s.target.kind} trust={s.target.kind === "STEAM" ? "HIGH" : s.target.kind === "NONSTEAM" ? "MEDIUM" : "LOW"} value={s.target.value} />
                  </dd>
                </>
              )}
              {s.ip && (
                <>
                  <dt>{t("ip")}</dt>
                  <dd>
                    <code className="gcs-identity__id" data-testid="gcs-ban-ip">
                      {s.ip}
                    </code>
                  </dd>
                </>
              )}
              <dt>{t("scope")}</dt>
              <dd>{s.scope === "GLOBAL" ? t("global") : t("serverScope", { server: s.server?.name ?? "—" })}</dd>
              {s.scope === "GLOBAL" && s.server && (
                <>
                  <dt>{t("origin")}</dt>
                  <dd>{s.server.name}</dd>
                </>
              )}
              <dt>{t("created")}</dt>
              <dd>{date(s.createdAt)}</dd>
              <dt>{t("expires")}</dt>
              <dd>{s.expiresAt ? date(s.expiresAt) : t("permanent")}</dd>
              <dt>{t("admin")}</dt>
              <dd>{s.admin.name}</dd>
              <dt>{t("source")}</dt>
              <dd>{t(`sources.${s.source}`)}</dd>
              {s.lifted && (
                <>
                  <dt>{t("lifted")}</dt>
                  <dd data-testid="gcs-ban-lifted">{t("liftedValue", { by: s.lifted.by || "—", date: date(s.lifted.at), reason: s.lifted.reason || "—" })}</dd>
                </>
              )}
            </dl>
          </GcsCard>

          {canEdit && abilities && (
            <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ban-edit">
              <h2 id="gcs-ban-edit" className="gcs-display gcs-titleBand gcs-serverBox__title">
                <GcsIcon name="fa-solid fa-pen" className="gcs-hIcon" />
                {t("edit")}
              </h2>
              <GcsSanctionForm
                mode="edit"
                abilities={abilities}
                sanctionId={s.id}
                type={s.type}
                initial={{ scope: s.scope, serverId: s.server?.id ?? null, reason: s.reason, minutes: currentMinutes, evidence: s.evidence.map((e) => e.url) }}
              />
            </GcsCard>
          )}
        </div>
        <aside className="gcs-serverLayout__side">
          <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ban-evidence">
            <h2 id="gcs-ban-evidence" className="gcs-display gcs-titleBand gcs-serverBox__title">
              <GcsIcon name="fa-solid fa-paperclip" className="gcs-hIcon" />
              {t("evidence")}
            </h2>
            {s.evidence.length === 0 ? (
              <p className="gcs-serverNote">{t("noEvidence")}</p>
            ) : (
              <ul className="gcs-evidenceList" data-testid="gcs-ban-evidence">
                {s.evidence.map((e) => (
                  <li key={e.url}>
                    <GcsIcon name="fa-solid fa-link" className="gcs-hIcon" />
                    <a href={e.url} rel="nofollow noopener ugc" target="_blank">
                      {e.url.replace(/^https:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </GcsCard>
          {canLift && (
            <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ban-lift">
              <h2 id="gcs-ban-lift" className="gcs-display gcs-titleBand gcs-serverBox__title">
                <GcsIcon name="fa-solid fa-unlock" className="gcs-hIcon" />
                {t(`liftTitle.${s.type}`)}
              </h2>
              <GcsSanctionLift sanctionId={s.id} />
            </GcsCard>
          )}
        </aside>
      </div>
    </>
  );
}
