import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GcsIcon } from "@gcs/ui/icons";
import { currentActor } from "@/lib/actor";
import { roomOnlineView } from "@/lib/online";
import { services } from "@/lib/services";
import { GcsChatRoom } from "../_components/chat/GcsChatRoom";
import { GcsAnnounceForm, GcsChatOnline, GcsCreateRoom, GcsRoomTools } from "../_components/chat/GcsChatRooms";
import { GcsSlowModeControl } from "../_components/chat/GcsSlowModeControl";
import { chatRoomProps } from "../_components/chat/chat-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("chat"))("title"), robots: { index: false } };
}

/**
 * `/chat` (specul etapei 5): camerele în stânga (publice, private, „Creează cameră”), camera aleasă în mijloc (anunțurile,
 * mesajul fixat, reacțiile, editarea) și, în dreapta, cine e online în cameră, membrii unei camere private și
 * formularul de anunț global (staff).
 */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const { chatQueries, chat, permissions, apps } = services();
  // Aplicația Chat dezactivată din ACP → pagina nu există.
  if (!(await apps.enabled("chat"))) notFound();
  const [channels, t, canPublic, canPrivate, canAnnounce] = await Promise.all([
    chatQueries.channels(actor),
    getTranslations("chat"),
    permissions.can(actor, "chat.create_public"),
    permissions.can(actor, "chat.create_private"),
    permissions.can(actor, "chat.announce"),
  ]);
  const createLabels = {
    create: t("rooms.create"),
    name: t("rooms.name"),
    type: t("rooms.type"),
    public: t("rooms.public"),
    private: t("rooms.private"),
    invite: t("rooms.invite"),
    inviteHint: t("rooms.inviteHint"),
    submit: t("rooms.submit"),
    cancel: t("cancel"),
  };
  if (channels.length === 0) {
    return (
      <>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 30 }}>
          {t("title")}
        </h1>
        <p className="gcs-muted">{t("noChannels")}</p>
        <GcsCreateRoom canPublic={canPublic} canPrivate={canPrivate} labels={createLabels} />
      </>
    );
  }
  const wanted = (await searchParams).c;
  const channel = wanted ? channels.find((c) => c.key === wanted) : channels[0];
  if (!channel) notFound();
  const isPrivate = channel.type === "PRIVATE";
  const [props, canModerate, online, members] = await Promise.all([
    chatRoomProps(actor, channel),
    chat.canModerate(actor),
    roomOnlineView(`chat:${channel.key}`),
    isPrivate ? chatQueries.roomMembers(actor, channel.key) : Promise.resolve([]),
  ]);
  const owner = channel.ownerId !== null && channel.ownerId === actor.userId;
  const canManage = channel.ownerId !== null && (owner || canModerate);

  const roomLink = (c: (typeof channels)[number]) => (
    <li key={c.key}>
      <Link href={`/chat?c=${c.key}`} className={`gcs-chatRooms__link${c.key === channel.key ? " gcs-chatRooms__link--active" : ""}`} aria-current={c.key === channel.key ? "page" : undefined}>
        <GcsIcon name={c.type === "PRIVATE" ? "fa-solid fa-lock" : "fa-solid fa-hashtag"} />
        <span>{c.name}</span>
      </Link>
    </li>
  );
  const publicRooms = channels.filter((c) => c.type === "PUBLIC");
  const privateRooms = channels.filter((c) => c.type === "PRIVATE");

  return (
    <div className="gcs-chatPage">
      <aside className="gcs-chatRooms" aria-label={t("channels")}>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 26 }}>
          {t("title")}
        </h1>
        <nav aria-label={t("channels")}>
          <h2 className="gcs-chatRooms__title">{t("rooms.publicTitle")}</h2>
          <ul className="gcs-chatRooms__list">{publicRooms.map(roomLink)}</ul>
          {privateRooms.length > 0 && (
            <>
              <h2 className="gcs-chatRooms__title">{t("rooms.privateTitle")}</h2>
              <ul className="gcs-chatRooms__list">{privateRooms.map(roomLink)}</ul>
            </>
          )}
        </nav>
        <GcsCreateRoom canPublic={canPublic} canPrivate={canPrivate} labels={createLabels} />
      </aside>

      <section className="gcs-card gcs-chatPage__main" aria-label={channel.name}>
        <header className="gcs-chatPage__head">
          <h2 className="gcs-display" style={{ margin: 0, fontSize: 20 }}>
            {isPrivate && <GcsIcon name="fa-solid fa-lock" />} {channel.name}
          </h2>
          {channel.description && <p className="gcs-muted" style={{ margin: 0 }}>{channel.description}</p>}
          <GcsRoomTools
            channel={channel.key}
            name={channel.name}
            isPrivate={isPrivate}
            canManage={canManage}
            canLeave={isPrivate && !owner}
            labels={{
              rename: t("rooms.rename"),
              invite: t("rooms.inviteMore"),
              inviteHint: t("rooms.inviteHint"),
              leave: t("rooms.leave"),
              delete: t("rooms.delete"),
              confirmDelete: t("rooms.confirmDelete"),
              save: t("save"),
              cancel: t("cancel"),
              done: t("rooms.done"),
            }}
          />
          {canModerate && <GcsSlowModeControl channel={channel.key} seconds={channel.slowModeSeconds} label={t("slowModeLabel")} off={t("slowModeOff")} />}
        </header>
        <GcsChatRoom key={channel.key} {...props} />
      </section>

      <aside className="gcs-chatPage__side">
        <GcsChatOnline channel={channel.key} initial={online} title={t("online")} nobody={t("nobodyOnline")} />
        {isPrivate && (
          <section className="gcs-card gcs-sideCard" aria-label={t("rooms.members")} data-testid="gcs-chat-members">
            <h2 className="gcs-display gcs-sideCard__title">{t("rooms.members")}</h2>
            <ul className="gcs-recentList">
              {members.map((m) => (
                <li key={m.id}>{m.name}</li>
              ))}
            </ul>
          </section>
        )}
        {canAnnounce && (
          <GcsAnnounceForm labels={{ title: t("announce.title"), body: t("announce.body"), hours: t("announce.hours"), submit: t("announce.submit"), done: t("announce.done") }} />
        )}
      </aside>
    </div>
  );
}
