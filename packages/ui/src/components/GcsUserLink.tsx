import type { AnchorHTMLAttributes } from "react";

export type GcsUserLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
  userId: string;
  name: string;
  /** Cheia grupului principal → clasa `gcs-name--{groupKey}` (stilul numelui, din CSS-ul generat de ACP). */
  groupKey: string;
  href: string;
};

/** Linkul către profilul unui user, cu numele stilizat. `data-user-id` e folosit de hover card (etapa 3). */
export function GcsUserLink({ userId, name, groupKey, href, ...props }: GcsUserLinkProps) {
  return (
    <a href={href} className={`gcs-userLink gcs-name--${groupKey}`} data-user-id={userId} {...props}>
      {name}
    </a>
  );
}
