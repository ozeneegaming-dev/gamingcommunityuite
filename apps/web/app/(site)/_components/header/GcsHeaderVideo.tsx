"use client";

import type { GcsHeaderRow } from "@gcs/core/themes";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

type Connection = EventTarget & { saveData?: boolean };
const connection = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Connection }).connection);

function subscribe(cb: () => void) {
  const motion = window.matchMedia(REDUCED_MOTION);
  motion.addEventListener("change", cb);
  connection()?.addEventListener("change", cb);
  return () => {
    motion.removeEventListener("change", cb);
    connection()?.removeEventListener("change", cb);
  };
}

/**
 * Videoul poate porni: fără animațiile reduse din sistem și fără economizorul de date. Pe server (și la hidratare)
 * răspunsul e „nu”, deci elementul `<video>` apare doar după montare: cine nu-l vede nici nu-l descarcă.
 */
function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(REDUCED_MOTION).matches && connection()?.saveData !== true,
    () => false,
  );
}

/**
 * Videoul din spatele antetului (setarea temei `header.video`, în orice temă și orice aspect): fără sunet, în buclă,
 * peste imaginea antetului, care rămâne imaginea de rezervă (se vede până pornește videoul și oricui nu-l primește:
 * animațiile reduse, economizorul de date, telefonul). Stratul stă cu `z-index: -1` în contextul de suprapunere al
 * antetului (`.gcs-hb`, z-index 40): peste fundalul antetului, sub rândurile lui statice, crestătura și meniuri, deci
 * antetul nu se schimbă deloc. Peste video, aceleași straturi ca la imagine (nuanța, întunecarea, estomparea, din CSS).
 * În bara compactă videoul se ascunde și se oprește (bara își păstrează fundalul).
 */
export function GcsHeaderVideo({ src, row, paused }: { src: string; row: GcsHeaderRow | undefined; paused: boolean }) {
  const allowed = useMotionAllowed();
  const video = useRef<HTMLVideoElement>(null);
  // Alt video = altă componentă (cheia din antet), deci starea pornește de la zero.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    // `muted` ca proprietate (React nu o pune ca atribut): browserele pornesc singure doar un video fără sunet.
    el.muted = true;
    if (paused) el.pause();
    else el.play().catch(() => {});
  }, [paused, allowed, src]);

  if (!allowed) return null;
  // „Doar rândul de sus”: stratul are înălțimea primului rând (rândurile sunt statice, deci se măsoară din antet).
  const style = row ? ({ "--hb-video-h": `var(--hb-${row})` } as CSSProperties) : undefined;
  return (
    <div className="gcs-hb__video" aria-hidden="true" data-playing={playing ? "" : undefined} style={style} data-testid="gcs-header-video">
      <video
        ref={video}
        src={src}
        muted
        loop
        playsInline
        autoPlay={!paused}
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onError={() => setPlaying(false)}
      />
    </div>
  );
}
