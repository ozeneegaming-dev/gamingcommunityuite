import { CLAN_LINK_KINDS, type GcsClanManage, type GcsUserRef } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import { GcsAvatar, GcsClanTag, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumHref, memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsClanForm } from "../../../_components/clans/GcsClanForm";
import { GcsClanDangerZone, GcsClanForumButton, GcsClanInvites, GcsClanMembersTable, GcsClanRequestList } from "../../../_components/clans/GcsClanManage";
import { GcsMemberLink } from "@/lib/member-names";

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ tab?: string }> };

export const dynamic = "force-dynamic";

const TABS = ["members", "requests", "settings", "danger"] as const;
type Tab = (typeof TABS)[number];

async function load(ref: string): Promise<GcsClanManage | null> {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  return services().clanQueries.manage(await currentActor(), parsed.id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).ref);
  const t = await getTranslations("clans.manage");
  return { title: data ? `${t("title")} · [${data.clan.tag}] ${data.clan.name}` : t("title") };
}

/** Avatarul și numele stilizat, pentru rândurile administrării. */
function Who({ user }: { user: GcsUserRef }) {
  return (
    <>
      <GcsAvatar name={user.name} size="s" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
      <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={memberHref(user)} />
    </>
  );
}

/**
 * Administrarea clanului (specul 2026-10-08-clanuri §7.3): tab-urile Membri, Cereri și invitații, Setări, Zona
 * periculoasă; fiecare apare doar cu dreptul lui (staff-ul le vede pe toate). Locul rezervat „Evenimente și turnee”.
 */
export default async function ClanManagePage({ params, searchParams }: Props) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const data = await load(ref);
  if (!data) notFound();
  const { clan, access } = data;
  if (ref !== `${clan.id}-${clan.slug}`) permanentRedirect(`${clan.href}/manage${sp.tab ? `?tab=${encodeURIComponent(sp.tab)}` : ""}`);
  const [t, tc, format, requireApproval] = await Promise.all([getTranslations("clans.manage"), getTranslations("clans"), getFormatter(), services().settings.get<boolean>("clans.require_approval")]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const isLeader = access.role === "LEADER";
  const visible: Record<Tab, boolean> = {
    members: true,
    requests: access.can.requests || access.can.invite,
    settings: access.can.edit || access.leader,
    danger: access.staff || isLeader,
  };
  const tab: Tab = TABS.includes(sp.tab as Tab) && visible[sp.tab as Tab] ? (sp.tab as Tab) : "members";
  const tabHref = (k: Tab) => (k === "members" ? `${clan.href}/manage` : `${clan.href}/manage?tab=${k}`);

  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/clans">
                <GcsIcon name="fa-solid fa-people-group" className="gcs-breadcrumb__home" />
                {tc("title")}
              </Link>
            </li>
            <li>
              <Link href={clan.href}>{clan.name}</Link>
            </li>
            <li aria-current="page">{t("title")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <div className="gcs-clanTitle">
            <GcsClanTag clan={clan} plain />
            <h1 className="gcs-display gcs-pageHeader__title">{t("title")}</h1>
          </div>
        </div>
        <nav className="gcs-segLinks" aria-label={t("tabs.label")} data-testid="gcs-clan-manage-tabs">
          {TABS.filter((k) => visible[k]).map((k) => (
            <Link key={k} href={tabHref(k)} className={`gcs-segLink${k === tab ? " gcs-segLink--active" : ""}`} aria-current={k === tab ? "page" : undefined}>
              {t(`tabs.${k}`)}
              {k === "requests" && data.requests.length > 0 && ` (${data.requests.length})`}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "members" && (
        <>
          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-manage-members">
            <h2 id="gcs-clan-manage-members" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-users" className="gcs-hIcon" />
              {t("membersTitle", { count: clan.members.length })}
            </h2>
            {data.steam && <p className="gcs-field__hint" style={{ margin: 0 }}>{t("steamHint")}</p>}
            <GcsClanMembersTable
              clanId={clan.id}
              canLead={access.leader}
              canKick={access.can.members}
              steam={data.steam}
              members={clan.members.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role, joined: date(m.joinedAt), link: <Who user={m.user} /> }))}
            />
          </section>
          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-manage-events">
            <h2 id="gcs-clan-manage-events" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-trophy" className="gcs-hIcon" />
              {t("events.title")}
            </h2>
            <p style={{ margin: 0 }}>{t("events.body")}</p>
            <p className="gcs-field__hint" data-testid="gcs-clan-events-who">
              {access.can.events ? t("events.youCan") : t("events.whoCan")}
            </p>
          </section>
        </>
      )}

      {tab === "requests" && (
        <>
          {access.can.requests && (
            <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-manage-requests">
              <h2 id="gcs-clan-manage-requests" className="gcs-titleBand gcs-clanBox__title">
                <GcsIcon name="fa-solid fa-envelope-open-text" className="gcs-hIcon" />
                {t("requestsTitle", { count: data.requests.length })}
              </h2>
              <GcsClanRequestList
                requests={data.requests.map((r) => ({ id: r.id, name: r.user.name, message: r.message, meta: t("requestMeta", { date: date(r.createdAt), expires: date(r.expiresAt) }), link: <Who user={r.user} /> }))}
              />
            </section>
          )}
          {access.can.invite && (
            <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-manage-invites">
              <h2 id="gcs-clan-manage-invites" className="gcs-titleBand gcs-clanBox__title">
                <GcsIcon name="fa-solid fa-paper-plane" className="gcs-hIcon" />
                {t("invitesTitle")}
              </h2>
              <GcsClanInvites
                clanId={clan.id}
                invites={data.invites.map((r) => ({
                  id: r.id,
                  name: r.user.name,
                  message: "",
                  meta: r.invitedBy ? t.rich("inviteMeta", { name: () => <GcsMemberLink user={r.invitedBy!} />, expires: date(r.expiresAt) }) : t("inviteMetaAnon", { expires: date(r.expiresAt) }),
                  link: <Who user={r.user} />,
                }))}
              />
            </section>
          )}
        </>
      )}

      {tab === "settings" && (
        <>
          <section className="gcs-card gcs-titledBox gcs-clanBox gcs-titledBox--roomy" aria-labelledby="gcs-clan-manage-settings">
            <h2 id="gcs-clan-manage-settings" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-sliders" className="gcs-hIcon" />
              {t("settingsTitle")}
            </h2>
            <GcsClanForm
              mode="edit"
              clanId={clan.id}
              leader={access.leader}
              initial={{
                tag: clan.tag,
                name: clan.name,
                description: data.descriptionJson ?? "",
                color: clan.color,
                color2: clan.color2,
                links: Object.fromEntries(CLAN_LINK_KINDS.map((k) => [k, clan.links[k] ?? ""])),
                joinMode: clan.joinMode,
                logo: data.logoId ? { id: data.logoId, url: `/files/${data.logoId}` } : null,
                banner: data.bannerId ? { id: data.bannerId, url: `/files/${data.bannerId}` } : null,
                officerRights: data.officerRights,
              }}
              options={{ ...data.options, requireApproval }}
            />
          </section>
          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-manage-forum">
            <h2 id="gcs-clan-manage-forum" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-comments" className="gcs-hIcon" />
              {t("forumTitle")}
            </h2>
            {clan.forum ? (
              <p style={{ margin: 0 }}>
                {t("forumExists")}{" "}
                <Link href={forumHref(clan.forum)} data-testid="gcs-clan-manage-forum-link">
                  {clan.forum.name}
                </Link>
              </p>
            ) : data.options.forumMode === "off" ? (
              <p className="gcs-muted" style={{ margin: 0 }}>
                {t("forumOff")}
              </p>
            ) : clan.status !== "ACTIVE" ? (
              <p className="gcs-muted" style={{ margin: 0 }}>
                {t("forumAfterApproval")}
              </p>
            ) : access.leader ? (
              <>
                <p style={{ margin: 0 }}>{t("forumText")}</p>
                <GcsClanForumButton clanId={clan.id} ready={data.forumParentReady} />
              </>
            ) : (
              <p className="gcs-muted" style={{ margin: 0 }}>
                {t("forumLeader")}
              </p>
            )}
          </section>
        </>
      )}

      {tab === "danger" && (
        <section className="gcs-card gcs-titledBox gcs-clanBox gcs-clanDanger" aria-labelledby="gcs-clan-manage-danger">
          <h2 id="gcs-clan-manage-danger" className="gcs-titleBand gcs-clanBox__title">
            <GcsIcon name="fa-solid fa-triangle-exclamation" className="gcs-hIcon" />
            {t("tabs.danger")}
          </h2>
          <GcsClanDangerZone
            clanId={clan.id}
            tag={clan.tag}
            staff={access.staff}
            archived={clan.status === "ARCHIVED" && (access.staff || (isLeader && !clan.locked))}
            canTransfer={access.leader}
            canDisband={access.staff || (isLeader && !clan.locked)}
            candidates={clan.members.filter((m) => m.role !== "LEADER").map((m) => ({ userId: m.user.id, name: m.user.name }))}
          />
        </section>
      )}
    </>
  );
}
