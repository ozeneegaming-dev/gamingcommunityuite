"use client";

import { faDiscord, faGoogle, faSteam } from "@fortawesome/free-brands-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { authClient } from "@/lib/auth-client";

type Props = { returnTo: string; google: boolean; discord: boolean; labels: { steam: string; google: string; discord: string } };

/** Butoanele „dintr-un click” ale blocului pentru vizitatori: Steam mereu, Google / Discord când sunt configurate în ACP. */
export function GcsGuestSocial({ returnTo, google, discord, labels }: Props) {
  return (
    <>
      <GcsButton variant="ghost" size="sm" asChild className="gcs-btn--steam" icon={<GcsIconSvg icon={faSteam} />}>
        <a href={`/api/auth/steam/sign-in?callbackURL=${encodeURIComponent(returnTo)}`} data-testid="gcs-guest-steam">
          {labels.steam}
        </a>
      </GcsButton>
      {google && (
        <GcsButton
          variant="ghost"
          size="sm"
          className="gcs-btn--google"
          icon={<GcsIconSvg icon={faGoogle} />}
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL: returnTo, errorCallbackURL: "/login" })}
        >
          {labels.google}
        </GcsButton>
      )}
      {discord && (
        <GcsButton
          variant="ghost"
          size="sm"
          className="gcs-btn--discord"
          icon={<GcsIconSvg icon={faDiscord} />}
          onClick={() => authClient.signIn.social({ provider: "discord", callbackURL: returnTo, errorCallbackURL: "/login" })}
        >
          {labels.discord}
        </GcsButton>
      )}
    </>
  );
}
