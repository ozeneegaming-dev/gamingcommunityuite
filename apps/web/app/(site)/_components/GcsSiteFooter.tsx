import { footerRichText, type GcsFooterLink } from "@gcs/modules";
import { GcsIcon, isGcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { themeMode, viewerTheme, viewerThemeToggle } from "@/lib/appearance";
import { footerView } from "@/lib/footer";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { siteTemplate } from "@/lib/templates";
import { setLocale, setSkinChoice, setThemeMode } from "../actions";
import { GcsPoweredGuard } from "./GcsPoweredGuard";

/** Iconițele modurilor temei din footer. */
const THEME_ICONS = { dark: "fa-solid fa-moon", light: "fa-solid fa-sun", auto: "fa-solid fa-circle-half-stroke" } as const;

/** Un link al subsolului: intern (Next `Link`), extern (filă nouă) sau `mailto:`. */
function FooterAnchor({ link, className, children, testId }: { link: Pick<GcsFooterLink, "href">; className: string; children: ReactNode; testId?: string }) {
  if (link.href.startsWith("/")) {
    return (
      <Link href={link.href} className={className} data-testid={testId}>
        {children}
      </Link>
    );
  }
  const external = /^https?:/i.test(link.href);
  return (
    <a href={link.href} className={className} data-testid={testId} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

/** Titlul unei coloane: textul și partea în culoarea de accent. */
function FooterTitle({ id, title, accent }: { id: string; title: string; accent: string }) {
  return (
    <h2 id={id} className="gcs-siteFooter__title gcs-display">
      {title}
      {accent && (
        <>
          {" "}
          <span className="gcs-siteFooter__accent">{accent}</span>
        </>
      )}
    </h2>
  );
}

/**
 * Footer-ul (specul 2026-10-10-tema-nova §5, configurat în ACP → Aspect → Subsol): coloana „Despre” (titlul cu partea
 * de accent, textul cu cuvinte evidențiate, cardul-link), coloanele de linkuri ca pastile cu iconițe, apoi bara de jos
 * într-o casetă rotunjită: mențiunea produsului „Powered by GamingCommunitySuite” (protejată: apare oricum), cercurile
 * rețelelor sociale (ACP → Setări → Generale), limba, linkurile legale, conținutul necitit și comutatorul temei.
 * Formularele (limba, modul) merg și fără JavaScript. Șablonul `layout.footer` (ACP → Aspect → Șabloane) poate schimba
 * markup-ul: părțile de mai sus îi ajung prin sloturi, iar mențiunea produsului apare oricum.
 */
export async function GcsSiteFooter() {
  const actor = await currentActor();
  const [t, tf, locale, mode, locales, siteName, view, skins, viewer, toggle] = await Promise.all([
    getTranslations("site"),
    getTranslations("footer"),
    getLocale(),
    themeMode(),
    localeOptions(),
    services().settings.get<string>("site.name"),
    footerView(actor),
    services()
      .themes.list()
      .then((all) => all.filter((x) => x.enabled))
      .catch(() => []),
    viewerTheme(),
    viewerThemeToggle(),
  ]);
  const { config, socials } = view;
  const year = new Date().getFullYear();
  const current = locales.find((l) => l.code === locale);
  const about = config.about;
  const bottom = config.bottom;

  // Formularele (limba, modul) și mențiunea produsului rămân componente React: șablonul le pune prin sloturi.
  const localeButtons = (withNames: boolean) =>
    locales.map((l) => (
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
        {withNames && <span className="gcs-siteFooter__langName"> {l.label}</span>}
      </button>
    ));
  // Slotul `language` (șabloanele modificate): butoanele limbilor, pe un rând.
  const language = (
    <form action={setLocale} aria-label={t("language")} className="gcs-seg__group">
      <span className="gcs-seg__lead" aria-hidden="true">
        <GcsIcon name="fa-solid fa-language" />
      </span>
      {localeButtons(false)}
    </form>
  );
  // Slotul `languageMenu` (subsolul implicit): un meniu `<details>` în bara de jos.
  const languageMenu = bottom.language ? (
    <details className="gcs-siteFooter__menu" data-testid="gcs-footer-language">
      <summary className="gcs-siteFooter__barLink">
        <GcsIcon name="fa-solid fa-language" />
        {t("language")}
        <span className="gcs-siteFooter__code">{(current?.code ?? locale).toUpperCase()}</span>
      </summary>
      <form action={setLocale} aria-label={t("language")} className="gcs-seg__group gcs-siteFooter__menuList">
        {localeButtons(true)}
      </form>
    </details>
  ) : null;
  // Meniul temelor (doar cu cel puțin două teme active): oricine schimbă tema direct din forum, fără Setări → Aspect.
  const skinMenu =
    skins.length > 1 ? (
      // Cheia = tema afișată: după alegere meniul se reface închis.
      <details key={viewer.theme.key} className="gcs-siteFooter__menu" data-testid="gcs-footer-skin">
        <summary className="gcs-siteFooter__barLink">
          <GcsIcon name="fa-solid fa-palette" />
          {t("skin")}
          <span className="gcs-siteFooter__code">{viewer.theme.name}</span>
        </summary>
        <form action={setSkinChoice} aria-label={t("skin")} className="gcs-seg__group gcs-siteFooter__menuList">
          {skins.map((x) => (
            <button
              key={x.key}
              type="submit"
              name="skin"
              value={x.key}
              className={x.key === viewer.theme.key ? "gcs-seg gcs-seg--active" : "gcs-seg"}
              aria-pressed={x.key === viewer.theme.key}
            >
              <span className="gcs-themeSwatch" style={{ background: x.settings.dark.accent }} aria-hidden="true" />
              {x.name}
            </button>
          ))}
        </form>
      </details>
    ) : null;
  // Comutatorul lună / soare: cu perechea de teme din ACP (implicit GCS Dark ↔ GCS White) trece între cele două teme
  // (merge și fără JavaScript); fără pereche, comutatorul de mod al temei (tema îl poate ascunde, subsolul îl poate opri).
  const pairSwitch =
    bottom.theme && toggle ? (
      <form action={setSkinChoice} aria-label={t("theme")} className="gcs-seg__group gcs-siteFooter__pair" data-testid="gcs-footer-theme-pair">
        {(["dark", "light"] as const).map((m) => (
          <button key={m} type="submit" name="skin" value={toggle[m]} className={m === toggle.side ? "gcs-seg gcs-seg--active" : "gcs-seg"} aria-pressed={m === toggle.side} title={t(`themes.${m}`)}>
            <GcsIcon name={THEME_ICONS[m]} />
            <span className="gcs-siteFooter__schemeText">{t(`themes.${m}`)}</span>
          </button>
        ))}
      </form>
    ) : null;
  const modeSwitch = pairSwitch ?? (bottom.theme ? (
    <form action={setThemeMode} aria-label={t("theme")} className="gcs-seg__group gcs-siteFooter__scheme">
      {(["dark", "light", "auto"] as const).map((m) => (
        <button key={m} type="submit" name="mode" value={m} className={m === mode ? "gcs-seg gcs-seg--active" : "gcs-seg"} aria-pressed={m === mode} title={t(`themes.${m}`)}>
          <GcsIcon name={THEME_ICONS[m]} />
          <span className="gcs-siteFooter__schemeText">{t(`themes.${m}`)}</span>
        </button>
      ))}
    </form>
  ) : null);
  // Slotul `scheme`: meniul temelor și comutatorul de mod (șabloanele modificate le primesc pe amândouă).
  const scheme =
    skinMenu || modeSwitch ? (
      <>
        {skinMenu}
        {modeSwitch}
      </>
    ) : null;
  const powered = (
    <p className="gcs-siteFooter__powered" data-gcs-powered="">
      <GcsIcon name="fa-solid fa-copyright" />
      Powered by{" "}
      <a href="https://gamingcommunitysuite.com" rel="noopener" target="_blank">
        GamingCommunitySuite
      </a>
    </p>
  );

  // Coloana „Despre” și coloanele de linkuri.
  const columns = (
    <div className="gcs-siteFooter__top">
      <section className="gcs-siteFooter__about" aria-labelledby="gcs-footer-about">
        <FooterTitle id="gcs-footer-about" title={about.title} accent={about.accent} />
        {about.text && (
          <p className="gcs-siteFooter__text" data-testid="gcs-footer-about-text">
            {footerRichText(about.text).map((part, i) =>
              "br" in part ? (
                <br key={i} />
              ) : part.hl ? (
                <strong key={i} className="gcs-siteFooter__hl">
                  {part.text}
                </strong>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </p>
        )}
        {about.cta && (
          <FooterAnchor link={about.cta} className="gcs-siteFooter__cta" testId="gcs-footer-cta">
            <span className="gcs-siteFooter__ctaIcon" aria-hidden="true">
              <GcsIcon name={isGcsIcon(about.cta.icon) ? about.cta.icon : "fa-solid fa-arrow-right"} />
            </span>
            <span>{about.cta.label}</span>
            <GcsIcon name="fa-solid fa-arrow-right" className="gcs-siteFooter__ctaArrow" />
          </FooterAnchor>
        )}
      </section>
      {config.columns.map((col, i) => (
        <nav key={i} className="gcs-siteFooter__col" aria-labelledby={`gcs-footer-col-${i}`} data-testid="gcs-footer-column">
          <FooterTitle id={`gcs-footer-col-${i}`} title={col.title} accent={col.accent} />
          <ul className="gcs-siteFooter__list">
            {col.links.map((link, j) => (
              <li key={j}>
                <FooterAnchor link={link} className="gcs-siteFooter__pill">
                  <span className="gcs-siteFooter__pillIcon" aria-hidden="true">
                    <GcsIcon name={isGcsIcon(link.icon) ? link.icon : "fa-solid fa-link"} />
                  </span>
                  <span className="gcs-siteFooter__pillText">{link.label}</span>
                </FooterAnchor>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </div>
  );
  // Cercurile colorate ale rețelelor sociale (doar cele completate în ACP → Setări → Generale).
  const social =
    socials.length > 0 ? (
      <ul className="gcs-siteFooter__social" aria-label={tf("bar.social")} data-testid="gcs-footer-social">
        {socials.map((s) => (
          <li key={s.key}>
            <a href={s.href} className="gcs-siteFooter__socialLink" style={{ background: s.color }} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label} data-network={s.key}>
              <GcsIcon name={s.icon} />
            </a>
          </li>
        ))}
      </ul>
    ) : null;
  // Linkurile legale și „Conținut necitit” (doar pentru membri).
  const legal = [
    { key: "privacy", href: bottom.privacy, icon: "fa-solid fa-user-shield" },
    { key: "contact", href: bottom.contact, icon: "fa-solid fa-envelope" },
    { key: "cookies", href: bottom.cookies, icon: "fa-solid fa-cookie-bite" },
  ].filter((l) => l.href);
  const links = (
    <>
      {legal.map((l) => (
        <FooterAnchor key={l.key} link={l} className="gcs-siteFooter__barLink">
          <GcsIcon name={l.icon} />
          {tf(`bar.${l.key}`)}
        </FooterAnchor>
      ))}
      {bottom.unread && actor.userId && (
        <Link href="/activity?unread=1" className="gcs-siteFooter__barLink" data-testid="gcs-footer-unread">
          <GcsIcon name="fa-solid fa-eye" />
          {tf("bar.unread")}
        </Link>
      )}
    </>
  );

  const custom = await siteTemplate("layout.footer", { year }, { columns, social, links, language, language_menu: languageMenu, scheme, powered });
  if (custom) {
    return (
      <>
        {custom}
        <GcsPoweredGuard />
      </>
    );
  }

  return (
    <footer className="gcs-siteFooter" data-testid="gcs-site-footer">
      <div className="gcs-siteFooter__inner">
        {columns}
        <div className="gcs-siteFooter__bar">
          <div className="gcs-siteFooter__barStart">
            {powered}
            <span className="gcs-siteFooter__copy">
              © {year} {siteName}
            </span>
          </div>
          {social}
          <nav className="gcs-siteFooter__barLinks" aria-label={t("footerNav")}>
            {languageMenu}
            {links}
            {scheme}
          </nav>
        </div>
      </div>
      <GcsPoweredGuard />
    </footer>
  );
}
