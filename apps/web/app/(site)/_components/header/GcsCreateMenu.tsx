"use client";

import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { GcsQuickCreateItem } from "@/lib/quick-create";
import { useHeaderPopover } from "./GcsHeaderPopover";
import { HEADER_EVENTS, useHeaderState } from "./header-context";

/**
 * „+ Creează” (specul 2026-10-10-hero-cockpit §1): un meniu cu ce poate crea viewer-ul acum (aplicațiile instalate și
 * drepturile lui), cerut la deschidere pentru pagina curentă: într-un forum, primul item e „Topic nou în <forum>”.
 */
export function GcsCreateMenu({ icons }: { icons: Record<string, ReactNode> }) {
  const t = useTranslations("header.create");
  const pathname = usePathname();
  const { dropdowns } = useHeaderState();
  const [data, setData] = useState<{ path: string; items: GcsQuickCreateItem[]; forums: GcsQuickCreateItem[] } | null>(null);
  const load = () => {
    if (data?.path === pathname) return;
    void fetch(`/api/header/create?path=${encodeURIComponent(pathname)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [], forums: [] }))
      .then((d: { items: GcsQuickCreateItem[]; forums: GcsQuickCreateItem[] }) => setData({ path: pathname, ...d }))
      .catch(() => setData({ path: pathname, items: [], forums: [] }));
  };
  const pop = useHeaderPopover({ menu: true, mode: dropdowns, onOpen: load });
  useEffect(() => pop.close(false), [pathname]);
  useEffect(() => {
    const onOpen = () => pop.setOpen(true);
    window.addEventListener(HEADER_EVENTS.create, onOpen);
    return () => window.removeEventListener(HEADER_EVENTS.create, onOpen);
  }, [pop.setOpen]);

  const item = (i: GcsQuickCreateItem) => (
    <Link key={i.key} href={i.href} role="menuitem" className={`gcs-hb__menuItem${i.context ? " gcs-hb__menuItem--context" : ""}`} onClick={() => pop.close(false)} data-testid={`gcs-create-${i.key}`}>
      <span className="gcs-hb__menuIcon" aria-hidden="true">
        {icons[i.icon] ?? icons["fa-solid fa-plus"]}
      </span>
      <span className="gcs-hb__menuLabel">{t(`items.${i.labelKey}`, i.params ?? {})}</span>
    </Link>
  );

  return (
    <div className="gcs-hb__pop gcs-createMenu" {...pop.rootProps}>
      <button {...pop.triggerProps} className="gcs-btn gcs-btn--primary gcs-hb__create" aria-haspopup="menu" data-testid="gcs-create-open">
        <GcsIconSvg icon={faPlus} />
        <span className="gcs-hb__createText">{t("button")}</span>
      </button>
      {pop.mounted && (
        <div {...pop.panelProps} role="menu" aria-label={t("menu")} className="gcs-hb__panel gcs-hb__menu gcs-createMenu__panel" data-testid="gcs-create-menu">
          {!data ? (
            <p className="gcs-hb__panelNote" role="status">
              {t("loading")}
            </p>
          ) : data.items.length + data.forums.length === 0 ? (
            <p className="gcs-hb__panelNote">{t("empty")}</p>
          ) : (
            <>
              {data.items.map(item)}
              {data.forums.length > 0 && (
                <>
                  <span className="gcs-hb__menuHeading" role="presentation">
                    {t("forumsHeading")}
                  </span>
                  {data.forums.map(item)}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
