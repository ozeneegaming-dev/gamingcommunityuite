import { DONATION_INSTRUCTIONS_SETTING, DONATION_MEMBER_SUBMIT_SETTING, DONATION_RANGES, dayKey, type GcsDonationRangeKind, type GcsDonorView } from "@gcs/modules";
import { GcsAvatar, GcsBadge, GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { formatMoney } from "@/lib/donations";
import { donationCta } from "@/lib/donations.server";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsDonateForm } from "../_components/donations/GcsDonateForm";
import { GcsDonationGoal, GcsDonorName } from "../_components/donations/GcsDonationGoal";
import { GcsRelTime } from "../_components/forum/GcsRelTime";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("donations"))("title") };
}

type Search = { tab?: string; period?: string };
const MEDALS = ["gold", "silver", "bronze"] as const;

/** Avatarul unui donator (membrii au avatarul lor, ceilalți o inimă). */
function DonorAvatar({ donor }: { donor: GcsDonorView }) {
  if (donor.kind === "member") {
    return (
      <a href={memberHref(donor.user)} tabIndex={-1} aria-hidden="true" className="gcs-donRow__avatar">
        <GcsAvatar name={donor.user.name} size="s" userId={donor.user.id} {...(donor.user.image ? { src: donor.user.image } : {})} {...(donor.user.frameKey ? { frame: donor.user.frameKey } : {})} />
      </a>
    );
  }
  return (
    <span className="gcs-donRow__avatar gcs-donRow__avatar--blank" aria-hidden="true">
      <GcsIcon name="fa-solid fa-heart" />
    </span>
  );
}

/**
 * `/donatii` (VIP clasic): cardul obiectivului (progresul live), cum se donează (instrucțiunile și linkul extern din ACP),
 * „Am donat” pentru membri (cu cererile lor și starea), tab-urile „Ultimele donații” / „Top donatori” (lună / an / tot,
 * doar donațiile confirmate; anonimii apar „Anonim” și nu intră în top) și „Sala donatorilor”.
 */
export default async function DonationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { apps, donations, settings } = services();
  if (!(await apps.enabled("vip"))) notFound();
  const sp = await searchParams;
  const tab = sp.tab === "top" ? "top" : "latest";
  const period: GcsDonationRangeKind = DONATION_RANGES.includes(sp.period as GcsDonationRangeKind) ? (sp.period as GcsDonationRangeKind) : "month";
  const [t, format, locale, actor] = await Promise.all([getTranslations("donations"), getFormatter(), getLocale(), currentActor()]);
  const [goal, cta, instructions, submitOpen, currency, methods, list, top, hall, mine, tz] = await Promise.all([
    donations.goalView(actor, null),
    donationCta(),
    settings.get<string>(DONATION_INSTRUCTIONS_SETTING),
    settings.get<boolean>(DONATION_MEMBER_SUBMIT_SETTING),
    donations.mainCurrency(),
    donations.methods(),
    tab === "latest" ? donations.latest(20) : Promise.resolve([]),
    tab === "top" ? donations.top(period, 20) : Promise.resolve([]),
    donations.top("all", 24),
    actor.userId ? donations.mine(actor.userId) : Promise.resolve([]),
    settings.get<string>("site.timezone"),
  ]);
  const money = (amount: number, cur: string) => formatMoney(amount, cur, locale);
  const href = (patch: Search) => {
    const q = new URLSearchParams();
    const nextTab = patch.tab ?? tab;
    if (nextTab === "top") {
      q.set("tab", "top");
      if ((patch.period ?? period) !== "month") q.set("period", patch.period ?? period);
    }
    const s = q.toString();
    return s ? `/donatii?${s}#donatori` : "/donatii#donatori";
  };
  const statusTone = { CONFIRMED: "ok", PENDING: "warn", REJECTED: "neutral" } as const;

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-hand-holding-heart" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("lead")}</p>
        </div>
      </header>

      <div className="gcs-donPage">
        <div className="gcs-donPage__main">
          <GcsCard as="section" className="gcs-donCard" aria-labelledby="gcs-don-goal">
            <h2 id="gcs-don-goal" className="gcs-donCard__title">
              <GcsIcon name="fa-solid fa-bullseye" />
              {t("goalTitle")}
            </h2>
            {goal ? (
              <GcsDonationGoal initial={goal} goalParam="" showLast showCount cta={cta.external ? cta : null} variant="page" testId="gcs-donations-goal" />
            ) : (
              <p className="gcs-muted" data-testid="gcs-donations-no-goal">
                {t("noGoal")}
              </p>
            )}
          </GcsCard>

          <GcsCard as="section" className="gcs-donCard" aria-labelledby="gcs-don-list" id="donatori">
            <h2 id="gcs-don-list" className="gcs-srOnly">
              {t("tabs.label")}
            </h2>
            <div className="gcs-donTabs">
              <nav className="gcs-segLinks" aria-label={t("tabs.label")}>
                {(["latest", "top"] as const).map((k) => (
                  <Link key={k} href={href({ tab: k })} className={`gcs-segLink${k === tab ? " gcs-segLink--active" : ""}`} aria-current={k === tab ? "page" : undefined} data-testid={`gcs-donations-tab-${k}`}>
                    <GcsIcon name={k === "latest" ? "fa-solid fa-clock-rotate-left" : "fa-solid fa-ranking-star"} />
                    {t(`tabs.${k}`)}
                  </Link>
                ))}
              </nav>
              {tab === "top" && (
                <nav className="gcs-segLinks" aria-label={t("periods.label")}>
                  {DONATION_RANGES.map((p) => (
                    <Link key={p} href={href({ period: p })} className={`gcs-segLink${p === period ? " gcs-segLink--active" : ""}`} aria-current={p === period ? "page" : undefined} data-testid={`gcs-donations-period-${p}`}>
                      {t(`periods.${p}`)}
                    </Link>
                  ))}
                </nav>
              )}
            </div>

            <div className="gcs-donPanel" key={`${tab}-${period}`} data-testid={`gcs-donations-panel-${tab}`}>
              {tab === "latest" &&
                (list.length === 0 ? (
                  <p className="gcs-emptyState">{t("emptyLatest")}</p>
                ) : (
                  <ul className="gcs-donList">
                    {list.map((d) => (
                      <li key={d.id} className="gcs-donRow" data-testid="gcs-donations-row">
                        <DonorAvatar donor={d.donor} />
                        <span className="gcs-donRow__who">
                          <GcsDonorName donor={d.donor} />
                          <span className="gcs-donRow__when">
                            <GcsRelTime at={d.at} />
                          </span>
                        </span>
                        <span className="gcs-donRow__amount">{money(d.amount, d.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ))}
              {tab === "top" &&
                (top.length === 0 ? (
                  <p className="gcs-emptyState">{t("emptyTop")}</p>
                ) : (
                  <ol className="gcs-donList">
                    {top.map((r) => (
                      <li key={`${r.rank}`} className="gcs-donRow" data-testid="gcs-donations-top-row" data-medal={MEDALS[r.rank - 1]}>
                        <span className={`gcs-donRow__rank${r.rank <= 3 ? ` gcs-donRow__rank--${MEDALS[r.rank - 1]}` : ""}`} aria-label={t("place", { rank: r.rank })}>
                          {r.rank}
                        </span>
                        <DonorAvatar donor={r.donor} />
                        <span className="gcs-donRow__who">
                          <GcsDonorName donor={r.donor} />
                          <span className="gcs-donRow__when">{t("count", { count: r.count })}</span>
                        </span>
                        <span className="gcs-donRow__amount">{money(r.total, r.currency)}</span>
                      </li>
                    ))}
                  </ol>
                ))}
            </div>
          </GcsCard>

          <GcsCard as="section" className="gcs-donCard" aria-labelledby="gcs-don-hall">
            <h2 id="gcs-don-hall" className="gcs-donCard__title">
              <GcsIcon name="fa-solid fa-trophy" />
              {t("hall.title")}
            </h2>
            <p className="gcs-muted gcs-donCard__lead">{t("hall.lead")}</p>
            {hall.length === 0 ? (
              <p className="gcs-emptyState">{t("hall.empty")}</p>
            ) : (
              <ul className="gcs-donHall" data-testid="gcs-donations-hall">
                {hall.map((r) => (
                  <li key={`h${r.rank}`} className="gcs-donHall__item" data-medal={MEDALS[r.rank - 1]} data-testid="gcs-donations-hall-item">
                    {r.donor.kind === "member" ? (
                      <GcsAvatar name={r.donor.user.name} size="l" userId={r.donor.user.id} {...(r.donor.user.image ? { src: r.donor.user.image } : {})} {...(r.donor.user.frameKey ? { frame: r.donor.user.frameKey } : {})} />
                    ) : (
                      <span className="gcs-donHall__blank" aria-hidden="true">
                        <GcsIcon name="fa-solid fa-heart" />
                      </span>
                    )}
                    <span className="gcs-donHall__name">
                      <GcsDonorName donor={r.donor} />
                    </span>
                    <span className="gcs-donHall__total">{money(r.total, r.currency)}</span>
                    <span className="gcs-donHall__since">{t("hall.since", { date: format.dateTime(new Date(r.since), { month: "short", year: "numeric" }) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </GcsCard>
        </div>

        <aside className="gcs-donPage__side">
          <GcsCard as="section" className="gcs-donCard" aria-labelledby="gcs-don-how" id="cum-donez">
            <h2 id="gcs-don-how" className="gcs-donCard__title">
              <GcsIcon name="fa-solid fa-circle-info" />
              {t("how.title")}
            </h2>
            <p className="gcs-donCard__text" data-testid="gcs-donations-instructions">
              {instructions.trim() || t("how.default")}
            </p>
            {cta.external && (
              <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-hand-holding-heart" />}>
                <a href={cta.href} target="_blank" rel="noopener noreferrer" data-testid="gcs-donations-external">
                  {t("cta")}
                </a>
              </GcsButton>
            )}
          </GcsCard>

          {actor.userId && submitOpen && (
            <GcsCard as="section" className="gcs-donCard" aria-labelledby="gcs-don-submit" id="am-donat">
              <h2 id="gcs-don-submit" className="gcs-donCard__title">
                <GcsIcon name="fa-solid fa-paper-plane" />
                {t("form.title")}
              </h2>
              <p className="gcs-muted gcs-donCard__lead">{t("form.lead")}</p>
              <GcsDonateForm currency={currency} methods={methods} today={dayKey(new Date(), tz)} />
            </GcsCard>
          )}
          {!actor.userId && submitOpen && (
            <GcsCard as="section" className="gcs-donCard">
              <p className="gcs-muted" style={{ margin: 0 }}>
                {t("form.guest")}{" "}
                <Link href="/login">{t("form.login")}</Link>
              </p>
            </GcsCard>
          )}

          {mine.length > 0 && (
            <GcsCard as="section" className="gcs-donCard" aria-labelledby="gcs-don-mine">
              <h2 id="gcs-don-mine" className="gcs-donCard__title">
                <GcsIcon name="fa-solid fa-receipt" />
                {t("mine.title")}
              </h2>
              <ul className="gcs-donList gcs-donList--mine">
                {mine.map((d) => (
                  <li key={d.id} className="gcs-donRow" data-testid="gcs-donations-mine" data-status={d.status}>
                    <span className="gcs-donRow__who">
                      <strong>{money(d.amount, d.currency)}</strong>
                      <span className="gcs-donRow__when">
                        {format.dateTime(d.donatedAt, { dateStyle: "medium" })}
                        {d.reference && ` · ${d.reference}`}
                        {d.anonymous && ` · ${t("anonymous")}`}
                      </span>
                      {d.status === "REJECTED" && d.rejectReason && <span className="gcs-donRow__when">{d.rejectReason}</span>}
                    </span>
                    <GcsBadge tone={statusTone[d.status]}>{t(`status.${d.status}`)}</GcsBadge>
                  </li>
                ))}
              </ul>
            </GcsCard>
          )}
        </aside>
      </div>
    </>
  );
}
