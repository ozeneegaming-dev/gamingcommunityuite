import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";
import { GcsGuestSocial } from "./GcsGuestSocial";

/**
 * Blocul pentru vizitatori (macheta GuestCta), al sistemului, în orice temă: titlul, cardurile „Creează un cont” (doar cu
 * înregistrarea deschisă) și „Ai deja cont?”, apoi conectarea dintr-un click (Steam, Google, Discord). Apare doar
 * vizitatorilor: sub un topic, în locul formularului de răspuns, și ca widget (`core.guestCta`) oriunde îl pune adminul.
 */
export async function GcsGuestCta({ variant, returnTo = "/", headingId }: { variant: "reply" | "widget"; returnTo?: string; headingId: string }) {
  const { settings } = services();
  const [t, registrationOpen, googleId, discordId] = await Promise.all([
    getTranslations("guestCta"),
    settings.get<boolean>("auth.registration_open"),
    settings.get<string>("auth.google_client_id"),
    settings.get<string>("auth.discord_client_id"),
  ]);
  return (
    <section className="gcs-card gcs-guestCta gcs-widget" aria-labelledby={headingId} data-widget="core.guestCta" data-testid="gcs-guest-cta">
      <div className="gcs-guestCta__head">
        <span className="gcs-guestCta__icon" aria-hidden="true">
          <GcsIcon name={variant === "reply" ? "fa-regular fa-comment-dots" : "fa-solid fa-users"} />
        </span>
        <h2 id={headingId} className="gcs-guestCta__title">
          {t(`${variant}.title`)}
        </h2>
        <p className="gcs-guestCta__sub">{t(`${variant}.subtitle`)}</p>
      </div>
      <div className="gcs-guestCta__grid">
        {registrationOpen && (
          <div className="gcs-guestCta__card gcs-guestCta__card--register">
            <div className="gcs-guestCta__cardHead">
              <span className="gcs-guestCta__cardIcon" aria-hidden="true">
                <GcsIcon name="fa-solid fa-user-plus" />
              </span>
              <span>
                <b className="gcs-guestCta__cardTitle">{t("register.title")}</b>
                <span className="gcs-guestCta__cardText">{t("register.text")}</span>
              </span>
            </div>
            <GcsButton variant="primary" asChild>
              <Link href="/register" data-testid="gcs-guest-register">
                {t("register.button")}
              </Link>
            </GcsButton>
          </div>
        )}
        <div className="gcs-guestCta__card gcs-guestCta__card--login">
          <div className="gcs-guestCta__cardHead">
            <span className="gcs-guestCta__cardIcon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-right-to-bracket" />
            </span>
            <span>
              <b className="gcs-guestCta__cardTitle">{t("login.title")}</b>
              <span className="gcs-guestCta__cardText">{t(`${variant}.loginText`)}</span>
            </span>
          </div>
          <GcsButton variant="ghost" asChild>
            <Link href="/login" data-testid="gcs-guest-login">
              {t("login.button")}
            </Link>
          </GcsButton>
        </div>
      </div>
      <div className="gcs-guestCta__social">
        <span>{t("social")}</span>
        <GcsGuestSocial returnTo={returnTo} google={googleId !== ""} discord={discordId !== ""} labels={{ steam: "Steam", google: "Google", discord: "Discord" }} />
      </div>
    </section>
  );
}
