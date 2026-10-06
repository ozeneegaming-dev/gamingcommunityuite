"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

export type GcsToastInput = {
  title: string;
  body?: string;
  href?: string;
  icon?: ReactNode;
  /** Milisecunde; implicit 6 s. */
  duration?: number;
};
type GcsToastItem = GcsToastInput & { id: number };

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 6_000;

let items: GcsToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Afișează un toast (colțul din dreapta jos). Cel mult 3 sunt vizibile; cel mai vechi pleacă primul. */
export function gcsToast(input: GcsToastInput): number {
  const id = nextId++;
  items = [...items, { ...input, id }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
const serverSnapshot = (): GcsToastItem[] => [];

function Toast({ item, closeLabel }: { item: GcsToastItem; closeLabel: string }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissToast(item.id), item.duration ?? DEFAULT_DURATION);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, paused]);

  const content = (
    <>
      {item.icon && <span className="gcs-toast__icon">{item.icon}</span>}
      <span className="gcs-toast__text">
        <strong className="gcs-toast__title">{item.title}</strong>
        {item.body && <span className="gcs-toast__body">{item.body}</span>}
      </span>
    </>
  );
  return (
    <div className="gcs-toast" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} data-testid="gcs-toast">
      {item.href ? (
        <a href={item.href} className="gcs-toast__main" onClick={() => dismissToast(item.id)}>
          {content}
        </a>
      ) : (
        <div className="gcs-toast__main">{content}</div>
      )}
      <button type="button" className="gcs-toast__close" aria-label={closeLabel} onClick={() => dismissToast(item.id)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

/** Locul toast-urilor; se pune o singură dată în layout. Anunțate discret cititoarelor de ecran. */
export function GcsToastHost({ closeLabel }: { closeLabel: string }) {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <div className="gcs-toastHost" aria-live="polite" aria-relevant="additions">
      {list.map((item) => (
        <Toast key={item.id} item={item} closeLabel={closeLabel} />
      ))}
    </div>
  );
}

/**
 * Sunetul scurt al unei notificări, generat în browser (WebAudio, fără fișier). Browserele permit sunetul doar după
 * o interacțiune a userului cu pagina; înainte, apelul nu face nimic.
 */
let audio: AudioContext | null = null;
let unlocked = false;
if (typeof window !== "undefined") {
  const unlock = () => {
    unlocked = true;
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function playNotificationSound(): void {
  if (!unlocked || typeof window === "undefined" || !("AudioContext" in window)) return;
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
  } catch {
    // Fără sunet: nu e o eroare a paginii.
  }
}
