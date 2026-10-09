import type { GcsGroupsScope } from "@gcs/modules";
import { GcsAvatar, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsCountUp, GcsGroupsPageRow } from "../../_components/groups-pro/GcsGroupsPageRow";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("groupsPro.page"))("title") };
}

type Search = { q?: string; scope?: string; cat?: string };
const SCOPES: readonly GcsGroupsScope[] = ["all", "primary", "secondary"];

/**
 * `/members/groups` — „Grupurile comunității” (aplicația premium Grupuri Pro; oprită → 404): grupurile publice pe
 * categorii, cu căutare (grup sau membru), filtrul principal / secundar, filtrul pe categorie și, la fiecare grup,
 * numărătorile și primii membri, cu eticheta „principal” / „secundar”.
 */
export default async function GroupsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await currentActor();
  const { apps, permissions, groupsPro, groupDirectory } = services();
  if (!(await apps.canAccess(actor, "groups_pro"))) notFound();
  if (actor.isBanned || !(await permissions.can(actor, "core.members_list"))) notFound();
  const sp = await searchParams;
  const scope: GcsGroupsScope = SCOPES.includes(sp.scope as GcsGroupsScope) ? (sp.scope as GcsGroupsScope) : "all";
  const q = (sp.q ?? "").slice(0, 40);
  const categories = await groupsPro.categories();
  const cat = categories.some((c) => c.key === sp.cat) ? sp.cat! : null;
  const [data, t, tc, tl, tg] = await Promise.all([
    groupsPro.page({ q, scope, category: cat }),
    getTranslations("groupsPro.page"),
    getTranslations("groupsPro.category"),
    getTranslations("groupsPro.legend"),
    getTranslations("groups"),
  ]);
  const labelOf = (c: { key: string; label: string }) => c.label || (tc.has(c.key as never) ? tc(c.key as never) : c.key);
  const href = (next: { scope?: GcsGroupsScope; cat?: string | null }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const s = next.scope ?? scope;
    if (s !== "all") p.set("scope", s);
    const c = next.cat === undefined ? cat : next.cat;
    if (c) p.set("cat", c);
    const qs = p.toString();
    return qs ? `/members/groups?${qs}` : "/members/groups";
  };
  const icons = new Map((await groupDirectory.groups()).map((g) => [g.id, g.icon]));

  return (
    <div className="gcs-groupsPage" data-testid="gcs-groups-page">
      <header className="gcs-pageHeader gcs-groupsPage__header">
        <div className="gcs-groupsPage__titles">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-layer-group" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-muted gcs-groupsPage__subtitle">
            {t("subtitle", { groups: tl("groups", { count: data.totals.groups }), members: tl("categoryTotal", { count: data.totals.members }) })}
          </p>
        </div>
        <form method="get" action="/members/groups" className="gcs-groupsPage__search" role="search">
          {scope !== "all" && <input type="hidden" name="scope" value={scope} />}
          {cat && <input type="hidden" name="cat" value={cat} />}
          <GcsIcon name="fa-solid fa-magnifying-glass" />
          <input className="gcs-input" type="search" name="q" defaultValue={q} placeholder={t("search")} aria-label={t("searchLabel")} maxLength={40} data-testid="gcs-groups-search" />
        </form>
      </header>

      <div className="gcs-groupsPage__toolbar">
        <nav className="gcs-groupsPage__seg" aria-label={t("scope")} data-testid="gcs-groups-scope">
          {SCOPES.map((s) => (
            <Link key={s} href={href({ scope: s })} className={`gcs-groupsPage__segItem${s === scope ? " gcs-groupsPage__segItem--on" : ""}`} aria-current={s === scope ? "true" : undefined}>
              {t(s === "all" ? "scopeAll" : s === "primary" ? "scopePrimary" : "scopeSecondary")}
            </Link>
          ))}
        </nav>
        <nav className="gcs-groupsPage__chips" aria-label={t("categories")}>
          <Link href={href({ cat: null })} className={`gcs-groupsPage__chip${cat === null ? " gcs-groupsPage__chip--on" : ""}`} aria-current={cat === null ? "true" : undefined}>
            {t("allCategories")}
          </Link>
          {categories.map((c) => (
            <Link key={c.key} href={href({ cat: c.key })} className={`gcs-groupsPage__chip${cat === c.key ? " gcs-groupsPage__chip--on" : ""}`} aria-current={cat === c.key ? "true" : undefined}>
              {labelOf(c)}
            </Link>
          ))}
        </nav>
      </div>

      {data.categories.length === 0 ? (
        <GcsCard style={{ padding: 24 }} data-testid="gcs-groups-empty">
          {t("empty")}
        </GcsCard>
      ) : (
        <div className="gcs-groupsPage__list" key={`${scope}:${cat ?? ""}:${q}`}>
          {data.categories.map((c) => (
            <section key={c.key} className="gcs-groupsPage__box" aria-labelledby={`gcs-groups-${c.key}`}>
              <header className="gcs-groupsPage__band">
                <h2 id={`gcs-groups-${c.key}`}>{labelOf(c)}</h2>
                <span className="gcs-muted">{tl("groups", { count: c.groups.length })}</span>
              </header>
              <div className="gcs-groupsPage__well">
                {c.groups.map((g) => (
                  <GcsGroupsPageRow
                    key={g.id}
                    color={g.color}
                    defaultOpen={q !== ""}
                    testId={`gcs-groups-row-${g.key}`}
                    head={
                      <>
                        <span className="gcs-groupsPage__icon" aria-hidden="true">
                          <GcsIcon name={icons.get(g.id) ?? "fa-solid fa-users"} />
                        </span>
                        <span className="gcs-groupsPage__name">
                          <b className={`gcs-name--${g.key}`}>{g.name}</b>
                          {(g.description || g.children.length > 0) && (
                            <span className="gcs-muted">
                              {[g.description, g.children.length > 0 ? t("includes", { names: g.children.join(", ") }) : ""].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </span>
                        <span className="gcs-groupsPage__stats">
                          <span>
                            <b>
                              <GcsCountUp value={g.members} />
                            </b>
                            <span>{t("members")}</span>
                          </span>
                          <span>
                            <b>
                              <GcsCountUp value={g.secondary} />
                            </b>
                            <span>{t("asSecondary")}</span>
                          </span>
                          <span className="gcs-groupsPage__onlineStat">
                            <b>
                              <GcsCountUp value={g.online} />
                            </b>
                            <span>{t("online")}</span>
                          </span>
                        </span>
                        <span className="gcs-groupsPage__chev" aria-hidden="true">
                          <GcsIcon name="fa-solid fa-chevron-down" />
                        </span>
                      </>
                    }
                  >
                    {g.list.length === 0 ? (
                      <p className="gcs-muted gcs-groupsPage__none">{t("noMembers")}</p>
                    ) : (
                      <ul className="gcs-groupsPage__members">
                        {g.list.map((m) => (
                          <li key={m.id} className="gcs-groupsPage__member" data-testid="gcs-groups-member">
                            <span className="gcs-groupsPage__avatar">
                              <GcsAvatar name={m.name} size="s" {...(m.image ? { src: m.image } : {})} />
                              {m.online && <i className="gcs-groupsPage__onlineDot" aria-hidden="true" />}
                            </span>
                            <span className="gcs-groupsPage__memberText">
                              <GcsMemberName userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
                              <span className={`gcs-memberCard__tag${m.secondary ? "" : " gcs-memberCard__tag--primary"}`}>{m.secondary ? tg("secondaryTag") : tg("primaryTag")}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="gcs-groupsPage__foot">
                      <span className="gcs-muted">{t("shown", { shown: g.list.length, total: g.matched })}</span>
                      <a href={`/members?group=${g.id}`} className="gcs-groupsPage__all">
                        {t("allMembers")} <GcsIcon name="fa-solid fa-arrow-right" />
                      </a>
                    </div>
                  </GcsGroupsPageRow>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
