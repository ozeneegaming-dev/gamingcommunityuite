import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { themeMode } from "@/lib/appearance";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { setLocale, setThemeMode } from "../actions";

/** Iconițele modurilor temei din footer. */
const THEME_ICONS = { dark: "fa-solid fa-moon", light: "fa-solid fa-sun", auto: "fa-solid fa-circle-half-stroke" } as const;

/**
 * Footer-ul (specul etapei 5): numele site-ului, linkurile utile, limba și tema (formulare simple, merg și fără
 * JavaScript) și mențiunea produsului, „Powered by GamingCommunitySuite” (specul principal §1.1).
 */
export async function GcsSiteFooter() {
  const [t, locale, mode, locales, siteName] = await Promise.all([
    getTranslations("site"),
    getLocale(),
    themeMode(),
    localeOptions(),
    services().settings.get<string>("site.name"),
  ]);
  const year = new Date().getFullYear();
  return (
    <footer className="gcs-siteFooter">
      <div className="gcs-siteFooter__inner">
        <div className="gcs-siteFooter__brand">
          <strong className="gcs-display">{siteName}</strong>
          <span>
            © {year} {siteName}
          </span>
        </div>
        <nav aria-label={t("footerNav")} className="gcs-siteFooter__links">
          <Link href="/members">
            <GcsIcon name="fa-solid fa-users" />
            {t("nav.members")}
          </Link>
          <Link href="/staff">
            <GcsIcon name="fa-solid fa-shield-halved" />
            {t("nav.staff")}
          </Link>
          <Link href="/search">
            <GcsIcon name="fa-solid fa-magnifying-glass" />
            {t("searchLabel")}
          </Link>
        </nav>
        <div className="gcs-siteFooter__prefs">
          <form action={setLocale} aria-label={t("language")} className="gcs-seg__group">
            <span className="gcs-seg__lead" aria-hidden="true">
              <GcsIcon name="fa-solid fa-language" />
            </span>
            {locales.map((l) => (
              <button
                key={l.code}
                type="submit"
                name="locale"
                value={l.code}
                className={l.code === locale ? "gcs-seg gcs-seg--active" : "gcs-seg"}
                aria-pressed={l.code === locale}
                lang={l.code}
                title={l.label}
              >
                {l.code.toUpperCase()}
              </button>
            ))}
          </form>
          <form action={setThemeMode} aria-label={t("theme")} className="gcs-seg__group">
            {(["dark", "light", "auto"] as const).map((m) => (
              <button key={m} type="submit" name="mode" value={m} className={m === mode ? "gcs-seg gcs-seg--active" : "gcs-seg"} aria-pressed={m === mode}>
                <GcsIcon name={THEME_ICONS[m]} />
                {t(`themes.${m}`)}
              </button>
            ))}
          </form>
        </div>
        <p className="gcs-siteFooter__powered">
          Powered by{" "}
          <a href="https://gamingcommunitysuite.com" rel="noopener" target="_blank">
            GamingCommunitySuite
          </a>
        </p>
      </div>
    </footer>
  );
}
