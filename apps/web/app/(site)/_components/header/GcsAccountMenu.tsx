"use client";

import { faChevronDown, faMoon, faRightFromBracket, faSun } from "@fortawesome/free-solid-svg-icons";
import { gcsToast, GcsAvatar, GcsIconSvg, GcsMemberName } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { GcsAccountMenuData } from "@/lib/account-menu.server";
import { authClient } from "@/lib/auth-client";
import { useErrorMessage } from "@/lib/use-error-message";
import { setLocale, setThemeMode } from "../../actions";
import { openPageEditor } from "../../edit-actions";
import { setPresenceStatus } from "../../header-actions";
import { GcsCountUp } from "./GcsCountUp";
import { useHeaderPopover } from "./GcsHeaderPopover";
import { useHeaderState } from "./header-context";

/** Paginile cu zone de widget-uri (ca în meniul userului clasic). */
const WIDGET_PATHS = /^\/(?:$|forum\/|topic\/)/;
const RING_R = 23;
const RING_C = 2 * Math.PI * RING_R;

const form = (name: string, value: string) => {
  const fd = new FormData();
  fd.set(name, value);
  return fd;
};

/** Inelul de XP din jurul avatarului (progresul spre nivelul următor) și insigna nivelului. */
export function GcsXpRing({ percent, level, children, size = 52 }: { percent: number; level: number; children: ReactNode; size?: number }) {
  const t = useTranslations("header.account");
  const dash = (RING_C * Math.max(0, Math.min(100, percent))) / 100;
  return (
    <span className="gcs-xpRing" style={{ width: size, height: size }}>
      <svg viewBox="0 0 52 52" aria-hidden="true" className="gcs-xpRing__svg">
        <circle cx="26" cy="26" r={RING_R} className="gcs-xpRing__track" />
        {dash > 0 && <circle cx="26" cy="26" r={RING_R} className="gcs-xpRing__fill" strokeDasharray={`${dash} ${RING_C}`} transform="rotate(-90 26 26)" />}
      </svg>
      <span className="gcs-xpRing__avatar">{children}</span>
      {level > 0 && <span className="gcs-xpRing__level">{t("levelShort", { level })}</span>}
    </span>
  );
}

/**
 * Meniul contului (specul 2026-10-10-hero-cockpit §3): avatarul cu inelul de XP, insigna nivelului, numele stilizat și
 * „x% până la Nv n”; la click, cardul de rang (grupurile, statusul Online / Invizibil, nivelul și rangul, bara de XP,
 * cât mai rămâne, 3 statistici), secțiunile (Conținutul meu, Gaming, Setări, Staff) și rândul de jos (tema, limba,
 * ieșirea).
 */
export function GcsAccountMenu({
  data,
  mode,
  locales,
  locale,
  icons,
  compactTrigger = false,
}: {
  data: GcsAccountMenuData;
  /** Iconițele itemilor (randate pe server, după numele Font Awesome). */
  icons: Record<string, ReactNode>;
  mode: "dark" | "light" | "auto";
  locales: { code: string; label: string }[];
  locale: string;
  /** Esports: inelul mai mic și numele, fără linia de progres și săgeată (pe mobil, doar avatarul). */
  compactTrigger?: boolean;
}) {
  const t = useTranslations("header.account");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const errorMessage = useErrorMessage();
  const { dropdowns, device } = useHeaderState();
  const [status, setStatus] = useState(data.status);
  const [theme, setTheme] = useState(mode);
  const [, start] = useTransition();
  const pop = useHeaderPopover({ mode: dropdowns, trap: true });
  useEffect(() => setStatus(data.status), [data.status]);
  useEffect(() => pop.close(false), [pathname]);

  const { level, user } = data;
  const next = level.next;
  const unit = (u: "xp" | "posts" | "reputation") => t(`units.${u}`);
  const short = device === "mobile";
  const slim = compactTrigger && !short;

  const changeStatus = (s: "online" | "invisible") =>
    start(async () => {
      const prev = status;
      setStatus(s);
      const res = await setPresenceStatus({ status: s });
      if (!res.ok) {
        setStatus(prev);
        gcsToast({ title: errorMessage(res.error) });
      }
    });
  const changeTheme = (m: "dark" | "light") =>
    start(async () => {
      setTheme(m);
      document.documentElement.dataset.theme = m;
      await setThemeMode(form("mode", m));
      router.refresh();
    });
  const changeLocale = (code: string) =>
    start(async () => {
      await setLocale(form("locale", code));
      router.refresh();
    });
  const editPage = () =>
    start(async () => {
      const res = await openPageEditor({});
      if (!res.ok && res.error.params?.reason === "acp_gate") return router.push("/admin/reauth");
      if (!res.ok) return void gcsToast({ title: errorMessage(res.error) });
      if (WIDGET_PATHS.test(pathname)) router.refresh();
      else router.push("/");
    });
  const logout = () =>
    start(async () => {
      await authClient.signOut();
      window.location.assign("/");
    });

  const ringLabel = next ? t("ring", { level: level.level, percent: level.percent, next: next.level }) : t("ringMax", { level: level.level });

  return (
    <div className={`gcs-hb__pop gcs-am${short ? " gcs-am--short" : ""}${slim ? " gcs-am--slim" : ""}`} {...pop.rootProps}>
      <button {...pop.triggerProps} className="gcs-am__trigger" aria-label={ringLabel} aria-haspopup="dialog" data-testid="gcs-user-menu-trigger">
        <GcsXpRing percent={next ? level.percent : level.level > 0 ? 100 : 0} level={level.level} size={short ? 44 : slim ? 40 : 52}>
          <GcsAvatar name={user.name} size="m" userId={user.id} {...(user.image ? { src: user.image } : {})} />
        </GcsXpRing>
        {!short && (
          <span className="gcs-am__who">
            <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} size="full" className="gcs-am__name" data-testid="gcs-header-user" />
            {next && !slim && <span className="gcs-am__toNext">{t("toNext", { percent: level.percent, level: next.level })}</span>}
          </span>
        )}
        {!short && !slim && <GcsIconSvg icon={faChevronDown} className="gcs-am__chev" />}
      </button>
      {pop.mounted && (
        <div {...pop.panelProps} role="dialog" aria-label={t("menu")} className="gcs-hb__panel gcs-am__panel" data-testid="gcs-account-menu">
          <div className="gcs-am__card">
            <div className="gcs-am__id">
              <GcsAvatar name={user.name} size="m" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
              <span className="gcs-am__idText">
                <span className="gcs-am__cardName">
                  <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={user.href} />
                </span>
                <span className="gcs-am__groups">
                  {data.groups.map((g) => (
                    <a
                      key={g.id}
                      href={`/members?group=${g.id}`}
                      className="gcs-groupMention gcs-am__group"
                      data-group-id={g.id}
                      style={g.color ? ({ "--g": g.color } as React.CSSProperties) : undefined}
                      data-testid="gcs-account-group"
                    >
                      {g.name}
                    </a>
                  ))}
                </span>
              </span>
              <div className="gcs-am__status" role="radiogroup" aria-label={t("status.label")}>
                {(["online", "invisible"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    className={`gcs-am__statusBtn gcs-am__statusBtn--${s}`}
                    onClick={() => changeStatus(s)}
                    data-testid={`gcs-account-status-${s}`}
                  >
                    <span className="gcs-am__dot" aria-hidden="true" />
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="gcs-am__level">
              <div className="gcs-am__levelLine">
                <b>{level.rank ? t("levelRank", { level: level.level, rank: level.rank }) : t("level", { level: level.level })}</b>
                {next && next.need > 0 && (
                  <span className="gcs-am__muted">
                    {format.number(next.have)} / {format.number(next.need)} {unit(next.unit)}
                  </span>
                )}
              </div>
              <span className="gcs-am__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={next ? level.percent : 100} aria-label={ringLabel}>
                <span style={{ width: `${next ? level.percent : 100}%` }} />
              </span>
              <span className="gcs-am__muted" data-testid="gcs-account-remaining">
                {next ? t(`remaining.${next.unit}`, { count: next.remaining, rank: next.name }) : t("maxLevel")}
              </span>
            </div>
            <div className="gcs-am__stats">
              <span className="gcs-am__stat">
                <b>
                  <GcsCountUp value={data.stats.posts} format={(n) => format.number(n)} />
                </b>
                <span>{t("stats.posts")}</span>
              </span>
              <span className="gcs-am__stat">
                <b>
                  <GcsCountUp value={data.stats.reputation} format={(n) => format.number(n)} />
                </b>
                <span>{t("stats.reputation")}</span>
              </span>
              {data.stats.elo !== null && (
                <span className="gcs-am__stat" data-testid="gcs-account-elo">
                  <b>{format.number(data.stats.elo)}</b>
                  <span>{t("stats.elo")}</span>
                </span>
              )}
            </div>
          </div>
          {data.sections.map((sec) => (
            <nav key={sec.key} className="gcs-am__section" aria-label={t(`sections.${sec.key}`)} data-testid={`gcs-account-section-${sec.key}`}>
              <span className="gcs-am__sectionTitle">{t(`sections.${sec.key}`)}</span>
              {sec.items.map((it) =>
                it.key === "pageEditor" ? (
                  <button key={it.key} type="button" className="gcs-hb__menuItem" onClick={editPage} data-testid="gcs-menu-page-editor">
                    <span className="gcs-hb__menuIcon" aria-hidden="true">
                      {icons[it.icon]}
                    </span>
                    <span className="gcs-hb__menuLabel">{t(`items.${it.key}`)}</span>
                  </button>
                ) : (
                  <Link key={it.key} href={it.href} className="gcs-hb__menuItem" onClick={() => pop.close(false)} data-testid={`gcs-account-${it.key}`}>
                    <span className="gcs-hb__menuIcon" aria-hidden="true">
                      {icons[it.icon]}
                    </span>
                    <span className="gcs-hb__menuLabel">{t(`items.${it.key}`)}</span>
                    {it.count !== undefined && <span className="gcs-hb__count gcs-hb__count--inline">{it.count > 99 ? "99+" : it.count}</span>}
                    {it.note && <span className="gcs-am__note">{it.note}</span>}
                  </Link>
                ),
              )}
            </nav>
          ))}
          <div className="gcs-am__foot">
            <span className="gcs-am__seg" role="group" aria-label={t("theme.label")}>
              <button type="button" aria-pressed={theme !== "light"} onClick={() => changeTheme("dark")} data-testid="gcs-account-theme-dark">
                <GcsIconSvg icon={faMoon} />
                {t("theme.dark")}
              </button>
              <button type="button" aria-pressed={theme === "light"} onClick={() => changeTheme("light")} data-testid="gcs-account-theme-light">
                <GcsIconSvg icon={faSun} />
                {t("theme.light")}
              </button>
            </span>
            <label className="gcs-am__lang">
              <span className="gcs-srOnly">{t("language")}</span>
              <select value={locale} onChange={(e) => changeLocale(e.target.value)} data-testid="gcs-account-language">
                {locales.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="gcs-am__logout" onClick={logout} data-testid="gcs-menu-logout">
              <GcsIconSvg icon={faRightFromBracket} />
              {t("logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
