"use client";

import { faSatelliteDish, faServer } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import type { GcsNowCommunityData } from "@/lib/cockpit";
import { GcsServerLiveProvider } from "../servers/GcsServerLive";
import { Dots, FeedPanel, LivePanel, ServerStrips } from "./GcsCockpit";

/**
 * Widget-ul „Acum în comunitate” (macheta HomeComplete): banda cu titlul și jucătorii de pe servere, feed-ul cu tab-urile
 * Tot / Forum / Servere / Mix, cardul meciului mix live (sau recomandatele) și pastilele serverelor cu „Joacă acum”.
 * Aceleași panouri ca în consola din temă, dar ca widget pe care adminul îl pune unde vrea (sus, coloana din stânga,
 * jos). Pe telefon, panourile devin un șir de carduri cu puncte, ca în consolă.
 */
export function GcsNowCommunity({ id, data }: { id: string; data: GcsNowCommunityData }) {
  const t = useTranslations("cockpit");
  const track = useRef<HTMLDivElement>(null);
  const headingId = `gcs-widget-${id}`;
  const count = data.live ? 2 : 1;
  const servers = data.servers.length > 0;
  return (
    <section className="gcs-nowCommunity gcs-widget" aria-labelledby={headingId} data-widget="core.nowCommunity" data-testid="gcs-now-community">
      <GcsServerLiveProvider initial={data.statuses} pollSeconds={data.pollSeconds}>
        <div className="gcs-ck__console">
          <header className="gcs-ck__band">
            <span className="gcs-ck__ico" aria-hidden="true">
              <GcsIconSvg icon={faSatelliteDish} />
            </span>
            <h2 id={headingId} className="gcs-ck__bandTitle">
              {t("title")}
            </h2>
            {servers && (
              <span className="gcs-ck__chip" data-testid="gcs-now-community-players">
                <GcsIconSvg icon={faServer} />
                {t("playersOnServers", { count: data.players })}
              </span>
            )}
          </header>
          <div className="gcs-ck__panels" data-count={count} ref={track}>
            <FeedPanel initial={data.feed} bare ns="gcs-now-community" />
            {data.live && <LivePanel data={data.live} ns="gcs-now-community" />}
          </div>
          {count > 1 && <Dots track={track} count={count} />}
          {servers && <ServerStrips servers={data.servers} ns="gcs-now-community" />}
        </div>
      </GcsServerLiveProvider>
    </section>
  );
}
