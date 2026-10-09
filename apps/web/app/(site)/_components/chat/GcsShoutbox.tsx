import type { GcsActor } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import { GcsChatProRoom } from "../chat-pro/GcsChatProRoom";
import { chatProRoomProps, usesChatPro } from "../chat-pro/chat-pro-data";
import { GcsChatRoom } from "./GcsChatRoom";
import { chatRoomProps } from "./chat-data";

/**
 * Shoutbox-ul (widget, macheta Main): canalul ales în configurarea widget-ului sau, implicit, primul canal marcat
 * „pe pagina principală”. Antetul chat-ului e chiar rândul de titlu al widget-ului (iconița în pătratul de accent,
 * titlul, apoi butoanele de sunet și setări), ca în chatbox-ul de referință. Cine nu poate citi canalul nu vede widget-ul.
 * Cu Chat Pro pornit, widget-ul e camera Chat Pro (bara de anunțuri, clasamentul alături, unde e loc); un membru care
 * și-a oprit chat-ul vede doar butonul de repornire.
 */
export async function GcsShoutbox({ actor, channelKey = null }: { actor: GcsActor; channelKey?: string | null }) {
  const { chatQueries } = services();
  const channel = channelKey
    ? (await chatQueries.channels(actor)).find((c) => c.key === channelKey)
    : (await chatQueries.channels(actor, { homeOnly: true }))[0];
  if (!channel) return null;
  const pro = await usesChatPro(actor);
  const [t, props] = await Promise.all([getTranslations("chat"), pro ? chatProRoomProps(actor, channel) : chatRoomProps(actor, channel)]);
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
      {pro ? <GcsChatProRoom {...(props as Awaited<ReturnType<typeof chatProRoomProps>>)} compact title={title} /> : <GcsChatRoom {...props} compact title={title} />}
    </section>
  );
}
