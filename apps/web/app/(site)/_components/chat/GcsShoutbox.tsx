import type { GcsActor } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import { GcsChatRoom } from "./GcsChatRoom";
import { chatRoomProps } from "./chat-data";

/**
 * Shoutbox-ul (widget, macheta Main): canalul ales în configurarea widget-ului sau, implicit, primul canal marcat
 * „pe pagina principală”. Cine nu poate citi canalul nu vede widget-ul.
 */
export async function GcsShoutbox({ actor, channelKey = null }: { actor: GcsActor; channelKey?: string | null }) {
  const { chatQueries } = services();
  const channel = channelKey
    ? (await chatQueries.channels(actor)).find((c) => c.key === channelKey)
    : (await chatQueries.channels(actor, { homeOnly: true }))[0];
  if (!channel) return null;
  const [t, props] = await Promise.all([getTranslations("chat"), chatRoomProps(actor, channel)]);
  return (
    <section className="gcs-card gcs-sideCard" aria-labelledby="gcs-side-shoutbox" data-testid="gcs-shoutbox">
      <h2 id="gcs-side-shoutbox" className="gcs-display gcs-sideCard__title">
        {t("shoutbox")}
      </h2>
      <GcsChatRoom {...props} compact />
    </section>
  );
}
