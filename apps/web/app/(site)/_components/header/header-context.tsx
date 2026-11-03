"use client";

import type { GcsHeaderBuilder } from "@gcs/core/themes";
import { createContext, useContext } from "react";
import type { GcsDevice } from "@/lib/header-device";

/** Starea antetului construit, pentru elementele lui: dispozitivul curent, starea compactă, cum se deschid meniurile. */
export type GcsHeaderState = {
  device: GcsDevice;
  compact: boolean;
  dropdowns: "click" | "hover";
  mega: boolean;
  preset: string;
  /** Aspectul curent (cel publicat sau draftul din previzualizarea live); meniul împărțit se calculează din el. */
  layout: GcsHeaderBuilder | null;
};

export const HeaderStateContext = createContext<GcsHeaderState>({ device: "desktop", compact: false, dropdowns: "click", mega: true, preset: "classic", layout: null });

export function useHeaderState(): GcsHeaderState {
  return useContext(HeaderStateContext);
}

/**
 * Evenimentele dintre elementele antetului (bara de jos deschide căutarea, sertarul, „Creează”, meniul contului).
 * `account` e anulabil: meniul montat îl anulează (`preventDefault`); altfel bara duce la profil.
 */
export const HEADER_EVENTS = { search: "gcs:search-open", drawer: "gcs:drawer-open", create: "gcs:create-open", account: "gcs:account-open", preview: "gcs:header-preview" } as const;
