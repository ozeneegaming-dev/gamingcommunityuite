"use client";

import { memberNameParts, type GcsMemberNameSize } from "@gcs/core/member-name";
import { createContext, useContext, useMemo, type CSSProperties, type HTMLAttributes, type MouseEventHandler, type ReactNode } from "react";

/**
 * Membrii ale căror efecte de nume se desenează pe litere (Studio VIP): lista vine de la server (layout-ul rădăcină),
 * odată cu CSS-ul numelor (`/gcs-names.css`), deci cele două rămân la aceeași versiune.
 */
const GcsNameFxContext = createContext<ReadonlySet<string> | null>(null);

export function GcsNameFxProvider({ letters, children }: { letters: readonly string[]; children: ReactNode }) {
  const set = useMemo(() => new Set(letters), [letters]);
  return <GcsNameFxContext.Provider value={set}>{children}</GcsNameFxContext.Provider>;
}

/** Membrul are un efect de nume desenat pe litere (din lista serverului). */
export function useNameLetters(userId: string | null | undefined): boolean {
  const set = useContext(GcsNameFxContext);
  return !!userId && !!set?.has(userId);
}

export type GcsMemberNameProps = Omit<HTMLAttributes<HTMLElement>, "className" | "children" | "onClick"> & {
  /** Id-ul membrului: `data-user-id` (hover card-ul, stilul personal) sau `data-name-user` când nu e link. */
  userId?: string | null;
  name: string;
  /** Cheia stilului (`gcs-name--<cheie>`): stilul ales, grupul afișat sau grupul principal. */
  nameKey?: string | null;
  /** Linkul profilului; fără el (și fără `onClick`), numele e un text simplu. */
  href?: string | null;
  /** Un buton (ex. în chat: click = mențiune), cu hover card-ul și stilul unui link. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Butonul dezactivat (ex. autorul blocat în chat). */
  disabled?: boolean;
  /** `full`: postbit, profil, hover card, meniul userului (decorațiile efectului); implicit varianta pentru liste. */
  size?: GcsMemberNameSize;
  className?: string;
  /** Alt text vizibil (ex. porecla din Chat Pro); `data-text` și literele îl folosesc pe acesta. */
  label?: string;
  /** Elementul numelui fără link (ex. `h1` pe profil); implicit `span`. */
  as?: "span" | "h1" | "h2" | "strong";
  /** `false`: linkul nu deschide hover card-ul (ex. numele din hover card). */
  hoverCard?: boolean;
  "data-testid"?: string;
};

/**
 * Numele unui membru, la fel peste tot: același markup ca `memberNameHtml` din `@gcs/core` (șabloane, pluginuri,
 * conținutul salvat). Un link spre profil (cu hover card), un text simplu sau, în chat, un buton (click = mențiune).
 * Efectele pe litere (Studio VIP) primesc literele separate, cu numele întreg păstrat pentru cititoarele de ecran.
 */
export function GcsMemberName({ userId, name, nameKey, href, onClick, disabled, size, className, label, hoverCard, title, as: Tag = "span", ...rest }: GcsMemberNameProps) {
  const letters = useNameLetters(userId);
  const text = label ?? name;
  const button = !href && onClick !== undefined;
  const p = memberNameParts({ id: userId ?? null, name: text, nameKey: nameKey ?? null, href: href ?? (button ? "#" : null), size, letters, className, hoverCard, title });
  const { href: _href, ...attrs } = p.attrs;
  const inner = p.letters ? (
    <>
      <span className="gcs-name__t">{text}</span>
      <span className="gcs-name__ls" aria-hidden="true">
        {p.letters.map((c, i) => (
          <b key={i} style={{ "--i": i } as CSSProperties} data-c={c} />
        ))}
      </span>
    </>
  ) : (
    text
  );
  if (button) {
    return (
      <button type="button" {...rest} {...attrs} className={p.className} onClick={onClick} disabled={disabled}>
        {inner}
      </button>
    );
  }
  if (href) {
    return (
      <a {...rest} {...attrs} href={href} className={p.className}>
        {inner}
      </a>
    );
  }
  return (
    <Tag {...rest} {...attrs} className={p.className}>
      {inner}
    </Tag>
  );
}
