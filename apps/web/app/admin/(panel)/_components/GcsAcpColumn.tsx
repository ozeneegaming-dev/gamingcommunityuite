"use client";

import { faAnglesLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import { cx, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import type { GcsAcpNavArea } from "./types";

type Props = {
  area: GcsAcpNavArea | null;
  /** Cheia intrării paginii curente (evidențiată, `aria-current="page"`). */
  activeKey: string | null;
  siteName: string;
  /** În sertarul de pe mobil, butonul din antet închide sertarul; pe desktop restrânge coloana. */
  mobile: boolean;
  onHide: () => void;
  adminCard: ReactNode;
  labels: { collapse: string; closeMenu: string };
};

/**
 * Coloana a doua a navigației ACP (specul 2026-10-09-acp-navigatie-aplicatii §1.1): numele site-ului, titlul zonei și
 * toate paginile ei odată, pe grupuri cu titluri mici; la bază, cardul adminului.
 */
export function GcsAcpColumn({ area, activeKey, siteName, mobile, onHide, adminCard, labels }: Props) {
  const id = useId();
  return (
    <div className="gcs-acpCol">
      <div className="gcs-acpCol__head">
        <span className="gcs-acpCol__site gcs-display">{siteName}</span>
        <button
          type="button"
          className="gcs-iconBtn gcs-acpCol__hide"
          aria-label={mobile ? labels.closeMenu : labels.collapse}
          aria-controls={mobile ? undefined : "gcs-acp-column"}
          onClick={onHide}
          data-testid="gcs-acp-column-hide"
        >
          <GcsIconSvg icon={mobile ? faXmark : faAnglesLeft} />
        </button>
      </div>
      <nav id="gcs-acp-column" aria-labelledby={`${id}-title`} className="gcs-acpCol__body" data-testid="gcs-acp-column" data-area={area?.key ?? ""}>
        {area && (
          <>
            <h2 id={`${id}-title`} className="gcs-acpCol__title gcs-display">
              {area.label}
            </h2>
            {area.groups.map((group, g) => (
              <section key={`${g}:${group.title}`} className="gcs-acpCol__group" aria-labelledby={`${id}-g${g}`}>
                <h3 id={`${id}-g${g}`} className="gcs-acpCol__heading">
                  {group.title}
                </h3>
                <ul className="gcs-acpCol__items">
                  {group.items.map((item) => {
                    const active = item.key === activeKey;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          className={cx("gcs-acpCol__link", active && "gcs-acpCol__link--active", item.alias && "gcs-acpCol__link--alias")}
                          aria-current={active ? "page" : undefined}
                        >
                          {item.icon && <GcsIconSvg icon={item.icon} className="gcs-acpCol__icon" />}
                          <span className="gcs-acpCol__label">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </nav>
      <div className="gcs-acpCol__foot">{adminCard}</div>
    </div>
  );
}
