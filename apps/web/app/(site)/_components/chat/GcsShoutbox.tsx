import type { GcsActor } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import { GcsChatRoom } from "./GcsChatRoom";
import { chatRoomLabels, viewerMute } from "./chat-data";

/** Shoutbox-ul paginii principale (macheta Main): primul canal marcat „pe pagina principală”. Vizitatorii nu-l văd. */
export async function GcsShoutbox({ actor }: { actor: GcsActor }) {
  const { chatQueries, chat } = services();
  const [channel] = await chatQueries.channels(actor, { homeOnly: true });
  if (!channel) return null;
  const [t, initial, canModerate, mute, labels] = await Promise.all([
    getTranslations("chat"),
    chatQueries.recent(actor, channel.key),
    chat.canModerate(actor),
    viewerMute(actor, channel.key),
    chatRoomLabels(),
  ]);
  return (
    <section className="gcs-card gcs-sideCard" aria-labelledby="gcs-side-shoutbox" data-testid="gcs-shoutbox">
      <h2 id="gcs-side-shoutbox" className="gcs-display gcs-sideCard__title">
        {t("shoutbox")}
      </h2>
      <GcsChatRoom channel={channel} initial={initial} canModerate={canModerate} mute={mute} labels={labels} compact />
    </section>
  );
}
