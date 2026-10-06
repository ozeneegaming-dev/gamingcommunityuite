import type { GcsActor } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import { GcsChatRoom } from "./GcsChatRoom";
import { chatRoomProps } from "./chat-data";

/**
 * Shoutbox-ul (widget, macheta Main): canalul ales în configurarea widget-ului sau, implicit, primul canal marcat
 * „pe pagina principală”. Antetul chat-ului e chiar rândul de titlu al widget-ului (iconița în pătratul de accent,
 * titlul, apoi butoanele de sunet și setări), ca în chatbox-ul de referință. Cine nu poate citi canalul nu vede widget-ul.
 */
export async function GcsShoutbox({ actor, channelKey = null }: { actor: GcsActor; channelKey?: string | null }) {
  const { chatQueries } = services();
  const channel = channelKey
    ? (await chatQueries.channels(actor)).find((c) => c.key === channelKey)
    : (await chatQueries.channels(actor, { homeOnly: true }))[0];
  if (!channel) return null;
  const [t, props] = await Promise.all([getTranslations("chat"), chatRoomProps(actor, channel)]);
  const title = (
    <h2 id="gcs-side-shoutbox" className="gcs-display gcs-sideCard__title gcs-chat__heading">
      <span className="gcs-chat__headingIcon" aria-hidden="true">
        <GcsIcon name="fa-solid fa-comments" />
      </span>
      {t("shoutbox")}
    </h2>
  );
  return (
    <section className="gcs-card gcs-sideCard gcs-chatCard" aria-labelledby="gcs-side-shoutbox" data-testid="gcs-shoutbox">
      <GcsChatRoom {...props} compact title={title} />
    </section>
  );
}
