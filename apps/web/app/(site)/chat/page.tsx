import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsChatRoom } from "../_components/chat/GcsChatRoom";
import { GcsSlowModeControl } from "../_components/chat/GcsSlowModeControl";
import { chatRoomLabels, viewerMute } from "../_components/chat/chat-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("chat"))("title"), robots: { index: false } };
}

/** `/chat` (specul etapei 4 §8): canalele accesibile, ca tab-uri, cu istoric și unelte de moderare. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const { chatQueries, chat } = services();
  const channels = await chatQueries.channels(actor);
  const t = await getTranslations("chat");
  if (channels.length === 0) {
    return (
      <>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 30 }}>
          {t("title")}
        </h1>
        <p className="gcs-muted">{t("noChannels")}</p>
      </>
    );
  }
  const wanted = (await searchParams).c;
  const channel = wanted ? channels.find((c) => c.key === wanted) : channels[0];
  if (!channel) notFound();
  const [initial, canModerate, mute, labels] = await Promise.all([
    chatQueries.recent(actor, channel.key),
    chat.canModerate(actor),
    viewerMute(actor, channel.key),
    chatRoomLabels(),
  ]);

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 30 }}>
        {t("title")}
      </h1>
      <nav aria-label={t("channels")} className="gcs-tabs">
        {channels.map((c) => (
          <Link key={c.key} href={`/chat?c=${c.key}`} className={`gcs-tab${c.key === channel.key ? " gcs-tab--active" : ""}`} aria-current={c.key === channel.key ? "page" : undefined}>
            {c.name}
          </Link>
        ))}
      </nav>
      <section className="gcs-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {channel.description && <p className="gcs-muted" style={{ margin: 0 }}>{channel.description}</p>}
        {canModerate && <GcsSlowModeControl channel={channel.key} seconds={channel.slowModeSeconds} label={t("slowModeLabel")} off={t("slowModeOff")} />}
        <GcsChatRoom key={channel.key} channel={channel} initial={initial} canModerate={canModerate} mute={mute} labels={labels} />
      </section>
    </>
  );
}
