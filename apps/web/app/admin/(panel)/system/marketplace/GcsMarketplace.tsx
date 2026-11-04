"use client";

import { faArrowUpRightFromSquare, faCircleCheck, faCube, faMagnifyingGlass, faPowerOff, faRotate, faStore } from "@fortawesome/free-solid-svg-icons";
import type { GcsMarketItem } from "@gcs/core";
import { GcsBadge, GcsButton, GcsCard, GcsDrawer, GcsIconSvg, GcsImageViewer, type GcsImageViewerLabels } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { activateMarketApp, buyMarketItem, checkMarketOrder, stageMarketPackage } from "./actions";

/**
 * Starea unui element pentru această instalare:
 * - `buy` / `get`: de cumpărat / gratuit; `pending`: comanda așteaptă plata (pagina de plată, „Verifică plata”);
 * - `activate` / `enabled`: aplicație premium cumpărată, oprită / pornită;
 * - `install` / `update` / `installed`: pachet cumpărat, de instalat / cu versiune nouă / la zi;
 * - `unavailable`: cumpărat, dar fără ce instala în această versiune.
 */
export type GcsMarketState = "buy" | "get" | "pending" | "activate" | "enabled" | "install" | "update" | "installed" | "unavailable";
export type GcsMarketCard = GcsMarketItem & { state: GcsMarketState; installedVersion: string | null };

type Props = {
  items: GcsMarketCard[];
  categories: { key: string; label: string; count: number }[];
  card: boolean;
  error: string | null;
  canBuy: boolean;
  canInstall: boolean;
  locale: string;
  viewerLabels: GcsImageViewerLabels;
  /** „Doar ce am” bifat la deschidere (linkul „Verifică actualizări” din ACP › Aplicații). */
  initialMine?: boolean;
};

/** Paragrafele descrierii (rând gol = paragraf nou, „- ” = listă), ca text: nimic HTML de la Data Center. */
function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="gcs-market__prose">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{l.replace(/^\s*[-•]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}

export function GcsMarketplace({ items, categories, card, error, canBuy, canInstall, locale, viewerLabels, initialMine = false }: Props) {
  const t = useTranslations("acp.marketplace");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(initialMine);
  const [openId, setOpenId] = useState<number | null>(null);

  const price = (item: GcsMarketItem) => {
    if (item.price.cents === 0) return t("free");
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: item.price.currency }).format(item.price.cents / 100);
    } catch {
      return `${(item.price.cents / 100).toFixed(2)} ${item.price.currency}`;
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!category || i.category === category) &&
        (!mine || i.owned) &&
        (!q || i.name.toLowerCase().includes(q) || i.short.toLowerCase().includes(q) || i.vendor.toLowerCase().includes(q)),
    );
  }, [items, category, query, mine]);
  const filtered = Boolean(category || query.trim() || mine);
  const spotlight = !filtered ? items.find((i) => i.featured && i.cover) : undefined;
  const grid = spotlight ? visible.filter((i) => i.id !== spotlight.id) : visible;
  const open = items.find((i) => i.id === openId) ?? null;

  if (error) {
    const known = ["licence_missing", "licence_unmanaged", "licence_invalid", "licence_inactive", "domain", "disabled"].includes(error);
    return (
      <GcsCard className="gcs-market__notice" data-testid="gcs-market-error" role="alert">
        <GcsIconSvg icon={faStore} />
        <div>
          <strong>{t(known ? `errors.${error}.title` : "errors.unreachable.title")}</strong>
          <p>{t(known ? `errors.${error}.body` : "errors.unreachable.body")}</p>
          {error.startsWith("licence") || error === "domain" ? (
            <GcsButton variant="ghost" size="sm" asChild>
              <Link href="/admin/system/license">{t("goLicense")}</Link>
            </GcsButton>
          ) : null}
        </div>
      </GcsCard>
    );
  }

  return (
    <div className="gcs-market" data-testid="gcs-market">
      <div className="gcs-market__bar">
        <div className="gcs-market__cats" role="group" aria-label={t("categoriesLabel")}>
          <button type="button" aria-pressed={category === ""} className="gcs-market__cat" onClick={() => setCategory("")}>
            {t("all")} <span>{items.length}</span>
          </button>
          {categories.map((c) => (
            <button key={c.key} type="button" aria-pressed={category === c.key} className="gcs-market__cat" onClick={() => setCategory(c.key)} data-testid={`gcs-market-cat-${c.key}`}>
              {c.label} <span>{c.count}</span>
            </button>
          ))}
        </div>
        <label className="gcs-market__search">
          <GcsIconSvg icon={faMagnifyingGlass} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
        </label>
        <label className="gcs-market__mine">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t("mine")}
        </label>
      </div>

      {!card && items.some((i) => i.state === "buy" || i.state === "pending") && <p className="gcs-market__hint">{t("manualPayments")}</p>}

      {spotlight && (
        <button type="button" className="gcs-market__spotlight" onClick={() => setOpenId(spotlight.id)} data-testid="gcs-market-spotlight">
          <span className="gcs-market__spotCover" style={{ backgroundImage: `url("${spotlight.cover}")` }} aria-hidden="true" />
          <span className="gcs-market__spotText">
            <span className="gcs-market__spotKicker">{t("featured")}</span>
            <span className="gcs-market__spotName">{spotlight.name}</span>
            <span className="gcs-market__spotShort">{spotlight.short}</span>
            <span className="gcs-market__spotFoot">
              <strong>{spotlight.owned ? t(`state.${spotlight.state}`) : price(spotlight)}</strong>
              <span className="gcs-market__spotCta">{t("seeDetails")}</span>
            </span>
          </span>
        </button>
      )}

      {grid.length === 0 && !spotlight ? (
        <p className="gcs-market__empty">{items.length === 0 ? t("empty") : t("noMatch")}</p>
      ) : (
        <ul className="gcs-market__grid">
          {grid.map((item) => (
            <li key={item.id}>
              <button type="button" className="gcs-market__card" onClick={() => setOpenId(item.id)} data-testid={`gcs-market-item-${item.slug}`}>
                <span className="gcs-market__cover" style={item.cover ? { backgroundImage: `url("${item.cover}")` } : undefined} aria-hidden="true">
                  {!item.cover && <span className="gcs-market__coverMark">{item.name.charAt(0)}</span>}
                </span>
                <span className="gcs-market__body">
                  <span className="gcs-market__head">
                    {item.icon ? <img className="gcs-market__icon" src={item.icon} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <span className="gcs-market__icon gcs-market__icon--empty"><GcsIconSvg icon={faCube} /></span>}
                    <span className="gcs-market__title">
                      <span className="gcs-market__name">{item.name}</span>
                      <span className="gcs-market__vendor">
                        {item.vendor}
                        {item.official && <GcsIconSvg icon={faCircleCheck} className="gcs-market__official" label={t("official")} />}
                      </span>
                    </span>
                  </span>
                  <span className="gcs-market__short">{item.short}</span>
                  <span className="gcs-market__foot">
                    <span className="gcs-market__price">{price(item)}</span>
                    <StateBadge item={item} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <GcsDrawer
          title={open.name}
          icon={<GcsIconSvg icon={faStore} />}
          size="lg"
          closeLabel={t("close")}
          onClose={() => setOpenId(null)}
          testId="gcs-market-preview"
          aside={<StateBadge item={open} />}
        >
          <Preview item={open} price={price(open)} card={card} canBuy={canBuy} canInstall={canInstall} viewerLabels={viewerLabels} />
        </GcsDrawer>
      )}
    </div>
  );
}

function StateBadge({ item }: { item: GcsMarketCard }) {
  const t = useTranslations("acp.marketplace");
  const tone = { buy: null, get: null, pending: "warn", activate: "info", enabled: "ok", install: "info", update: "accent", installed: "ok", unavailable: "neutral" } as const;
  const value = tone[item.state];
  return value ? <GcsBadge tone={value}>{t(`state.${item.state}`)}</GcsBadge> : item.included ? <GcsBadge tone="ok">{t("included")}</GcsBadge> : null;
}

function Preview({ item, price, card, canBuy, canInstall, viewerLabels }: { item: GcsMarketCard; price: string; card: boolean; canBuy: boolean; canInstall: boolean; viewerLabels: GcsImageViewerLabels }) {
  const t = useTranslations("acp.marketplace");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [checkout, setCheckout] = useState<{ url: string; orderId: string } | null>(item.order ? { url: item.order.checkoutUrl, orderId: item.order.id } : null);
  const images = [item.cover, ...item.screenshots].filter((u): u is string => Boolean(u));
  const [shown, setShown] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);

  const run = (fn: () => Promise<void>) => {
    setMessage(null);
    start(fn);
  };
  const buy = () =>
    run(async () => {
      const res = await buyMarketItem(item.id);
      if (!res.ok) return setMessage({ tone: "danger", text: errorMessage(res.error) });
      if (res.data.status === "pending" && res.data.checkoutUrl && res.data.orderId) {
        setCheckout({ url: res.data.checkoutUrl, orderId: res.data.orderId });
        return;
      }
      setMessage({ tone: "ok", text: t(item.kind === "app" ? "boughtApp" : "boughtPackage") });
      router.refresh();
    });
  const check = () =>
    run(async () => {
      if (!checkout) return;
      const res = await checkMarketOrder(checkout.orderId);
      if (!res.ok) return setMessage({ tone: "danger", text: errorMessage(res.error) });
      if (res.data.status === "paid") {
        setMessage({ tone: "ok", text: t(item.kind === "app" ? "boughtApp" : "boughtPackage") });
        router.refresh();
      } else if (res.data.status === "pending") setMessage({ tone: "warn", text: t(card ? "notPaidYet" : "notConfirmedYet") });
      else setMessage({ tone: "danger", text: t("orderClosed") });
    });
  const activate = () =>
    run(async () => {
      if (!item.key) return;
      const res = await activateMarketApp(item.key);
      if (!res.ok) return setMessage({ tone: "danger", text: errorMessage(res.error) });
      setMessage({ tone: "ok", text: t("activated") });
      router.refresh();
    });
  const install = () =>
    run(async () => {
      const res = await stageMarketPackage(item.id);
      if (!res.ok) return setMessage({ tone: "danger", text: errorMessage(res.error) });
      router.push(res.data.installUrl);
    });

  let action: ReactNode = null;
  if (item.state === "buy" || item.state === "get" || item.state === "pending") {
    action = checkout ? (
      <div className="gcs-market__checkout">
        <GcsButton variant="primary" asChild icon={<GcsIconSvg icon={faArrowUpRightFromSquare} />}>
          <a href={checkout.url} target="_blank" rel="noopener noreferrer" data-testid="gcs-market-pay">
            {t("pay", { price })}
          </a>
        </GcsButton>
        <GcsButton variant="ghost" onClick={check} disabled={pending} icon={<GcsIconSvg icon={faRotate} />} data-testid="gcs-market-check">
          {t("checkPayment")}
        </GcsButton>
        <p className="gcs-market__note">{t(card ? "payNoteCard" : "payNoteManual")}</p>
      </div>
    ) : (
      <GcsButton variant="primary" onClick={buy} disabled={pending || !canBuy} data-testid="gcs-market-buy">
        {item.state === "get" ? t("getFree") : t("buy", { price })}
      </GcsButton>
    );
  } else if (item.state === "activate") {
    action = (
      <GcsButton variant="primary" onClick={activate} disabled={pending || !canInstall} icon={<GcsIconSvg icon={faPowerOff} />} data-testid="gcs-market-activate">
        {t("activate")}
      </GcsButton>
    );
  } else if (item.state === "install" || item.state === "update") {
    action = (
      <GcsButton variant="primary" onClick={install} disabled={pending || !canInstall} data-testid="gcs-market-install">
        {item.state === "update" ? t("updateTo", { version: item.version ?? "" }) : t("install")}
      </GcsButton>
    );
  } else if (item.state === "enabled" || item.state === "installed") {
    action = (
      <GcsButton variant="ghost" asChild>
        <Link href="/admin/system/applications">{t("manage")}</Link>
      </GcsButton>
    );
  }

  return (
    <div className="gcs-market__preview">
      {images.length > 0 && (
        <div className="gcs-market__gallery">
          <button type="button" className="gcs-market__stage" onClick={() => setViewer(shown)} aria-label={t("enlarge")}>
            <img src={images[shown]} alt="" referrerPolicy="no-referrer" />
          </button>
          {images.length > 1 && (
            <div className="gcs-market__thumbs" role="group" aria-label={t("screenshots")}>
              {images.map((src, i) => (
                <button key={src} type="button" aria-pressed={i === shown} aria-label={t("showImage", { n: i + 1 })} className="gcs-market__thumb" onClick={() => setShown(i)}>
                  <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="gcs-market__buy">
        <div className="gcs-market__buyHead">
          {item.icon && <img className="gcs-market__icon gcs-market__icon--lg" src={item.icon} alt="" referrerPolicy="no-referrer" />}
          <div>
            <div className="gcs-market__vendor">
              {item.vendor}
              {item.official && (
                <GcsBadge tone="accent" className="gcs-market__certified">
                  {t("official")}
                </GcsBadge>
              )}
            </div>
            <div className="gcs-market__bigPrice">{item.owned ? t(item.included ? "included" : "owned") : price}</div>
          </div>
        </div>
        {action}
        {message && (
          <p className={`gcs-market__msg gcs-market__msg--${message.tone}`} role={message.tone === "danger" ? "alert" : "status"}>
            {message.text}
          </p>
        )}
      </div>

      {item.short && <p className="gcs-market__lead">{item.short}</p>}
      {item.description && <Prose text={item.description} />}

      <dl className="gcs-market__facts">
        <div>
          <dt>{t("facts.type")}</dt>
          <dd>{t(item.kind === "app" ? "facts.app" : "facts.package")}</dd>
        </div>
        {item.version && (
          <div>
            <dt>{t("facts.version")}</dt>
            <dd>
              {item.version}
              {item.installedVersion && item.installedVersion !== item.version ? ` (${t("facts.installed", { version: item.installedVersion })})` : ""}
            </dd>
          </div>
        )}
        {item.minGcs && (
          <div>
            <dt>{t("facts.needs")}</dt>
            <dd>GCS {item.minGcs}+</dd>
          </div>
        )}
        {item.package && (
          <div>
            <dt>{t("facts.size")}</dt>
            <dd>{(item.package.size / 1048576).toFixed(1)} MB</dd>
          </div>
        )}
      </dl>

      {item.changelog && (
        <section className="gcs-market__changelog">
          <h3>{t("changelog")}</h3>
          <Prose text={item.changelog} />
        </section>
      )}

      {viewer !== null && <GcsImageViewer images={images.map((src) => ({ src, alt: item.name }))} index={viewer} labels={viewerLabels} onClose={() => setViewer(null)} />}
    </div>
  );
}
