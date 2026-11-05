"use client";

import { faSatelliteDish, faServer } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import type { GcsFeedTab, GcsNowCommunityData } from "@/lib/cockpit";
import { GcsServerLiveProvider } from "../servers/GcsServerLive";
import { Dots, FeedPanel, LivePanel, PlayNow } from "./GcsCockpit";

/**
 * Widget-ul „Acum în comunitate” (aplicația premium Comunitate Live, macheta HomeComplete): banda cu titlul, jucătorii de
 * pe servere și „Joacă acum”, feed-ul cu tab-urile alese de admin (Tot / Forum / Servere / Mix) și cardul „Live acum”
 * (meciul mix în desfășurare sau recomandatele). Fără lista serverelor: serverele se văd prin widget-ul „Servere” și
 * Zona serverelor. Pe telefon, panourile devin un șir de carduri cu puncte, ca în consolă.
 */
export function GcsNowCommunity({ id, data, tabs, limit }: { id: string; data: GcsNowCommunityData; tabs: readonly GcsFeedTab[]; limit: number }) {
  const t = useTranslations("cockpit");
  const track = useRef<HTMLDivElement>(null);
  const headingId = `gcs-widget-${id}`;
  const count = data.live ? 2 : 1;
  const servers = data.servers.length > 0;
  return (
    <section className="gcs-nowCommunity gcs-widget" aria-labelledby={headingId} data-widget="community_live.now" data-testid="gcs-now-community">
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
              <>
                <span className="gcs-ck__chip" data-testid="gcs-now-community-players">
                  <GcsIconSvg icon={faServer} />
                  {t("playersOnServers", { count: data.players })}
                </span>
                <PlayNow servers={data.servers} className="gcs-btn gcs-btn--primary gcs-btn--sm gcs-nowCommunity__play" ns="gcs-now-community" />
              </>
            )}
          </header>
          <div className="gcs-ck__panels" data-count={count} ref={track}>
            <FeedPanel initial={data.feed} bare ns="gcs-now-community" tabs={tabs} limit={limit} />
            {data.live && <LivePanel data={data.live} ns="gcs-now-community" />}
          </div>
          {count > 1 && <Dots track={track} count={count} />}
        </div>
      </GcsServerLiveProvider>
    </section>
  );
}
