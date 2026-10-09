import "server-only";
import { FOOTER_SETTING, SOCIAL_NETWORKS, communityRules, footerConfigError, type GcsFooterColumn, type GcsFooterConfig, type GcsFooterLink } from "@gcs/modules";
import type { GcsActor } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import { forumIndexHref } from "./landing";
import { services } from "./services";

export type GcsFooterSocial = { key: string; href: string; icon: string; color: string; label: string };

/** Ce afișează subsolul: configurația salvată (sau cea implicită) și profilurile sociale completate. */
export type GcsFooterView = { config: GcsFooterConfig; socials: GcsFooterSocial[]; isDefault: boolean };

type Translator = Awaited<ReturnType<typeof getTranslations<"footer">>>;

/**
 * Subsolul implicit (fără configurație salvată): textul „Despre” cu numele site-ului și coloanele de linkuri ale
 * aplicațiilor pornite și accesibile (Forum, Activitate, Membri, Staff, Clasament; Servere, Meciuri, Banuri, Clanuri;
 * Chat, VIP, Reguli, Căutare). Coloanele rămase fără linkuri dispar.
 */
export async function defaultFooterConfig(actor: GcsActor | null, t?: Translator): Promise<GcsFooterConfig> {
  const tr = t ?? (await getTranslations("footer"));
  const { settings, apps } = services();
  const [siteName, usable, forumHref, rules] = await Promise.all([
    settings.get<string>("site.name"),
    actor ? apps.accessFilter(actor) : apps.enabledFilter(),
    forumIndexHref(),
    communityRules(settings),
  ]);
  const l = (key: string, href: string, icon: string): GcsFooterLink => ({ label: tr(`links.${key}`), href, icon });
  const only = (app: string, links: GcsFooterLink[]) => (usable(app) ? links : []);
  const columns: GcsFooterColumn[] = [
    {
      title: tr("columns.discover.title"),
      accent: tr("columns.discover.accent"),
      links: [
        ...only("forums", [l("forum", forumHref, "fa-solid fa-comments")]),
        l("activity", "/activity", "fa-solid fa-bolt"),
        l("members", "/members", "fa-solid fa-user-group"),
        l("staff", "/staff", "fa-solid fa-shield-halved"),
        l("leaderboard", "/leaderboard", "fa-solid fa-ranking-star"),
      ],
    },
    {
      title: tr("columns.gaming.title"),
      accent: tr("columns.gaming.accent"),
      links: [
        ...only("servers", [
          l("servers", "/servers", "fa-solid fa-server"),
          l("matches", "/servers/matches", "fa-solid fa-crosshairs"),
          l("serverRanking", "/servers/leaderboard", "fa-solid fa-chart-simple"),
          l("bans", "/bans", "fa-solid fa-ban"),
        ]),
        ...only("clans", [l("clans", "/clans", "fa-solid fa-people-group")]),
      ],
    },
    {
      title: tr("columns.more.title"),
      accent: tr("columns.more.accent"),
      links: [
        ...only("chat", [l("chat", "/chat", "fa-solid fa-message")]),
        ...only("vip", [l("vip", "/vip", "fa-solid fa-gem")]),
        ...(rules ? [l("rules", "/rules", "fa-solid fa-scale-balanced")] : []),
        l("search", "/search", "fa-solid fa-magnifying-glass"),
      ],
    },
  ].filter((c) => c.links.length > 0);
  return {
    about: {
      title: tr("about.title"),
      accent: siteName,
      text: tr("about.text", { site: siteName }),
      cta: { label: tr("about.cta"), href: "/staff", icon: "fa-solid fa-shield-halved" },
    },
    columns,
    bottom: { privacy: "", contact: "", cookies: "", language: true, unread: true, theme: true },
  };
}

/** Profilurile sociale completate în ACP → Setări → Generale, în ordinea din subsol. */
export async function footerSocials(): Promise<GcsFooterSocial[]> {
  const { settings } = services();
  const values = await Promise.all(SOCIAL_NETWORKS.map((n) => settings.get<string>(n.setting).catch(() => "")));
  return SOCIAL_NETWORKS.flatMap((n, i) => (values[i] ? [{ key: n.key, href: values[i]!, icon: n.icon, color: n.color, label: n.label }] : []));
}

/** Subsolul pentru viewer: configurația salvată (validată din nou) sau cea implicită. */
export async function footerView(actor: GcsActor | null): Promise<GcsFooterView> {
  const saved = await services()
    .settings.get<GcsFooterConfig | null>(FOOTER_SETTING)
    .catch(() => null);
  const [config, socials] = await Promise.all([saved && footerConfigError(saved) === null ? saved : defaultFooterConfig(actor), footerSocials()]);
  return { config, socials, isDefault: !saved };
}
