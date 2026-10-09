"use client";

import { createContext, useContext } from "react";
import type { GcsDevice } from "@/lib/header-device";

/** Starea antetului construit, pentru elementele lui: dispozitivul curent, starea compactă, cum se deschid meniurile. */
export type GcsHeaderState = { device: GcsDevice; compact: boolean; dropdowns: "click" | "hover"; mega: boolean; preset: string };

export const HeaderStateContext = createContext<GcsHeaderState>({ device: "desktop", compact: false, dropdowns: "click", mega: true, preset: "classic" });

export function useHeaderState(): GcsHeaderState {
  return useContext(HeaderStateContext);
}

/** Evenimentele dintre elementele antetului (bara de jos deschide căutarea, sertarul, „Creează”). */
export const HEADER_EVENTS = { search: "gcs:search-open", drawer: "gcs:drawer-open", create: "gcs:create-open", preview: "gcs:header-preview" } as const;
