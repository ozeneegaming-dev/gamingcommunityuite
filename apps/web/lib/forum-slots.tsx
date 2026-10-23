import "server-only";
import type { GcsSlotItem, GcsSlotStyleResult, GcsSlotText, GcsSlotTone } from "@gcs/core";
import type { GcsForumSlotBundle, GcsSlotItems, GcsSlotNodeRef } from "@gcs/modules";
import { GcsIcon, isGcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { currentActor } from "./actor";
import { FORUM_SLOT_COMPONENTS } from "./forum-slot-components";
import { GcsNamedHtml } from "./member-names";
import { pluginHost, safeModeActive } from "./plugins";
import { services } from "./services";

/**
 * Sloturile forumului pe site (Forum v2, specul `2026-10-17-forum-v2-sloturi`): adună contribuțiile extensiilor prin
 * `GcsForumSlotService` (o dată pe pagină) și le desenează cu elementele sistemului (pastile, rânduri, valori, carduri),
 * în orice temă. HTML-ul pluginurilor vine deja sanitizat și închis în containerul lor; foile lor de stil se adaugă cu
 * `GcsSlotStyles`.
 */

const opts = async () => ({ plugins: !(await safeModeActive()) });

/** Sloturile unei liste de noduri (categoriile și forumurile indexului, subforumurile unei pagini). */
export async function forumListSlots(surface: "index" | "forum", nodes: GcsSlotNodeRef[]): Promise<Map<number, GcsForumSlotBundle>> {
  if (nodes.length === 0) return new Map();
  const [actor, locale, o] = await Promise.all([currentActor(), getLocale(), opts()]);
  return services().forumSlots.list(actor, locale, surface, nodes, o);
}

/** Cardurile de sus ale paginii unui forum. */
export async function forumPageSlots(node: GcsSlotNodeRef): Promise<GcsSlotItems> {
  const [actor, locale, o] = await Promise.all([currentActor(), getLocale(), opts()]);
  return services().forumSlots.forumPage(actor, locale, node, o);
}

/** Bara de pe pagina unui topic. */
export async function topicBarSlots(node: GcsSlotNodeRef, topic: { id: number; title: string; authorId: string | null }): Promise<GcsSlotItems> {
  const [actor, locale, o] = await Promise.all([currentActor(), getLocale(), opts()]);
  return services().forumSlots.topicBar(actor, locale, node, topic, o);
}

/** Clasele și variabilele CSS ale stilului unei extensii, unite cu cele ale elementului (rândul, categoria). */
export function slotRootProps(style: GcsSlotStyleResult | undefined, base: { className: string; style?: CSSProperties | undefined }): { className: string; style?: CSSProperties } {
  if (!style || (style.classes.length === 0 && Object.keys(style.vars).length === 0)) return base.style ? { className: base.className, style: base.style } : { className: base.className };
  const merged = { ...(base.style ?? {}), ...style.vars } as CSSProperties;
  return { className: [base.className, ...style.classes].join(" "), style: merged };
}

/** Foile de stil ale pluginurilor care au pus HTML sau stil în pagină (o singură legătură pe foaie). */
export async function GcsSlotStyles({ plugins }: { plugins: string[] }) {
  if (plugins.length === 0) return null;
  const host = await pluginHost();
  const hrefs = [...new Set(plugins.flatMap((p) => host.pluginStyles(p)))];
  return (
    <>
      {hrefs.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="gcs-plugins" />
      ))}
    </>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/** Un text de slot: deja tradus sau o cheie de mesaj (o cheie lipsă apare ca atare, nu strică pagina). */
export function slotText(t: Translate, text: GcsSlotText): string {
  if (typeof text === "string") return text;
  return t.has(text.key as never) ? t(text.key as never, (text.params ?? {}) as never) : text.key;
}

const tone = (t: GcsSlotTone | undefined) => `gcs-slotTone--${t ?? "neutral"}`;
const icon = (name: string | undefined, className: string) => (name && isGcsIcon(name) ? <GcsIcon name={name} className={className} /> : null);

/** Un link de slot: intern cu `next/link`, extern (doar `https://`) într-un tab nou. */
function SlotLink({ href, className, children, tip, style }: { href: string; className: string; children: ReactNode; tip?: string | undefined; style?: CSSProperties | undefined }) {
  const extra = { ...(tip ? { "data-tip": tip } : {}), ...(style ? { style } : {}) };
  return href.startsWith("/") ? (
    <Link href={href} className={className} {...extra}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} rel="noopener nofollow" target="_blank" {...extra}>
      {children}
    </a>
  );
}

function renderItem(item: GcsSlotItem, t: Translate, key: string): ReactNode {
  const id = item.id ? { "data-slot-item": item.id } : {};
  switch (item.kind) {
    case "chip": {
      const label = slotText(t, item.label);
      const tip = item.tooltip ? slotText(t, item.tooltip) : undefined;
      const style = item.color ? ({ "--gcs-slot-color": item.color } as CSSProperties) : undefined;
      const body = (
        <>
          {icon(item.icon, "gcs-slotChip__icon")}
          <span>{label}</span>
        </>
      );
      const className = `gcs-slotChip ${tone(item.tone)}${item.color ? " gcs-slotChip--custom" : ""}${item.href ? " gcs-slotChip--link gcs-sweep" : ""}`;
      return item.href ? (
        <span key={key} {...id} className="gcs-slotChipWrap">
          <SlotLink href={item.href} className={className} tip={tip} style={style}>
            {body}
          </SlotLink>
        </span>
      ) : (
        <span key={key} className={className} style={style} {...id} {...(tip ? { "data-tip": tip } : {})}>
          {body}
        </span>
      );
    }
    case "text": {
      const text = slotText(t, item.text);
      const body = (
        <>
          {icon(item.icon, "gcs-slotLine__icon")}
          <span>{text}</span>
        </>
      );
      return (
        <span key={key} className={`gcs-slotLine ${tone(item.tone)}`} {...id}>
          {item.href ? (
            <SlotLink href={item.href} className="gcs-slotLine__link">
              {body}
            </SlotLink>
          ) : (
            body
          )}
        </span>
      );
    }
    case "stat":
      return (
        <span key={key} className={`gcs-slotStat ${tone(item.tone)}`} {...id}>
          {icon(item.icon, "gcs-slotStat__icon")}
          <strong className="gcs-slotStat__value">{item.value}</strong>
          <span className="gcs-slotStat__label">{slotText(t, item.label)}</span>
        </span>
      );
    case "card":
      return (
        <section key={key} className={`gcs-card gcs-slotCard ${tone(item.tone)}`} {...id}>
          {item.image && <img className="gcs-slotCard__image" src={item.image} alt="" loading="lazy" />}
          <div className="gcs-slotCard__main">
            {(item.title || item.icon) && (
              <h2 className="gcs-display gcs-slotCard__title">
                {icon(item.icon, "gcs-slotCard__icon")}
                {item.title ? slotText(t, item.title) : null}
              </h2>
            )}
            {item.body && <p className="gcs-slotCard__body">{slotText(t, item.body)}</p>}
            {item.items && item.items.length > 0 && <div className="gcs-slotCard__items">{item.items.map((x, i) => renderItem(x, t, `${key}-${i}`))}</div>}
          </div>
          {item.actions && item.actions.length > 0 && (
            <div className="gcs-slotCard__actions">
              {item.actions.map((a, i) => (
                <SlotLink key={i} href={a.href} className={`gcs-btn gcs-btn--${a.variant ?? "primary"} gcs-btn--sm`}>
                  {icon(a.icon, "gcs-btn__icon")}
                  {slotText(t, a.label)}
                </SlotLink>
              ))}
            </div>
          )}
        </section>
      );
    case "html":
      // HTML-ul sanitizat al pluginului, cu numele membrilor aduse la stilul comun.
      return <GcsNamedHtml key={key} html={item.html} className="gcs-pluginHook gcs-slotHtml" />;
    case "component": {
      const Component = FORUM_SLOT_COMPONENTS[item.component];
      return Component ? <Component key={key} {...(item.props ?? {})} /> : null;
    }
  }
}

/**
 * Elementele unui slot, desenate cu componentele sistemului. `as`: elementul învelitor (`span` în rândul de titlu,
 * `div` în rest); nimic de arătat = nimic în pagină (nici învelitorul).
 */
export async function GcsSlot({ slot, items, as = "div", className }: { slot: string; items: GcsSlotItem[] | undefined; as?: "div" | "span"; className?: string }) {
  if (!items || items.length === 0) return null;
  const t = await getTranslations();
  const Tag = as;
  return (
    <Tag className={["gcs-forumSlot", `gcs-forumSlot--${slot.replace(/\./g, "-")}`, className].filter(Boolean).join(" ")} data-slot={slot}>
      {items.map((item, i) => renderItem(item, t, `${slot}-${i}`))}
    </Tag>
  );
}
