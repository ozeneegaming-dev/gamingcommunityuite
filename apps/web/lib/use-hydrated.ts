"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` în HTML-ul de pe server și până la hidratare, apoi `true`. Formularele cu parole îl folosesc ca butonul de
 * trimitere să rămână oprit până când React preia formularul: altfel, un click foarte rapid (rețea lentă, mașină
 * încărcată) ar trimite formularul nativ, fără `onSubmit`.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
