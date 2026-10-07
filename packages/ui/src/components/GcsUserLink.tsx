import type { AnchorHTMLAttributes } from "react";

export type GcsUserLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className"> & {
  userId: string;
  name: string;
  /**
   * Cheia stilului numelui → clasa `gcs-name--{nameKey}` (din CSS-ul generat de ACP): stilul ales de membru (`ns_*`)
   * sau cheia grupului principal.
   */
  nameKey: string;
  href: string;
};

/**
 * Linkul către profilul unui user, cu numele stilizat. `data-user-id` e folosit de hover card (etapa 3); `data-text`
 * (numele, ca text) de efectele numelui care îl dublează în straturi (`content: attr(data-text)`).
 */
export function GcsUserLink({ userId, name, nameKey, href, ...props }: GcsUserLinkProps) {
  return (
    <a href={href} className={`gcs-userLink gcs-name--${nameKey}`} data-user-id={userId} data-text={name} {...props}>
      {name}
    </a>
  );
}
