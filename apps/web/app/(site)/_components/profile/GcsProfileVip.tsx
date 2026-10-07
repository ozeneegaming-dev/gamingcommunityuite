"use client";

import { faMusic, faPause, faPlay, faVolumeHigh } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fundalul profilului ales în Studio VIP: un strat fix în spatele paginii existente (imaginea, sau videoclipul fără
 * sunet, în buclă), cu vignetă pentru lizibilitate. Sub `prefers-reduced-motion` rămâne posterul; un buton mic oprește
 * sau pornește videoclipul. Adresele vin din aspectul validat de GCS (doar fișierele pluginului).
 */
export function GcsProfileBackdrop({ image, video, position, dim, labels }: { image: string; video: string | null; position: string; dim: number; labels: { pause: string; play: string } }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [motion, setMotion] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const allowed = Boolean(video) && !reducedMotion();
    setMotion(allowed);
    if (allowed) ref.current?.play().then(() => setPlaying(true), () => setPlaying(false));
  }, [video]);
  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPlaying(true), () => {});
    else {
      v.pause();
      setPlaying(false);
    }
  };
  return (
    <>
      <div className="gcs-vipBackdrop" aria-hidden="true" style={{ "--gcs-vip-dim": dim / 100 } as CSSProperties} data-testid="gcs-profile-backdrop">
        <img className="gcs-vipBackdrop__media" src={image} alt="" style={{ objectPosition: position }} />
        {video && motion && <video ref={ref} className="gcs-vipBackdrop__media" src={video} poster={image} muted loop playsInline preload="metadata" style={{ objectPosition: position }} />}
      </div>
      {video && motion && (
        <button type="button" className="gcs-vipBackdrop__toggle" onClick={toggle} aria-label={playing ? labels.pause : labels.play} title={playing ? labels.pause : labels.play}>
          <GcsIconSvg icon={playing ? faPause : faPlay} />
        </button>
      )}
    </>
  );
}

/**
 * Melodia profilului: un fișier audio (player cu buton, volum) sau un video YouTube încărcat doar la click
 * (youtube-nocookie). Nu pornește niciodată singură cu sunet; „pornește automat, fără sunet” doar pentru fișiere audio
 * și doar fără `prefers-reduced-motion`, cu buton de pornire a sunetului.
 */
export function GcsProfileSong({
  song,
  labels,
}: {
  song: { title: string; artist: string | null; audio: string | null; youtube: string | null; autoplayMuted: boolean };
  labels: { title: string; play: string; pause: string; unmute: string; youtube: string };
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [embed, setEmbed] = useState(false);
  const youtube = song.youtube && /^[A-Za-z0-9_-]{11}$/.test(song.youtube) ? song.youtube : null;

  useEffect(() => {
    const a = audio.current;
    if (!a || !song.autoplayMuted || reducedMotion()) return;
    a.muted = true;
    setMuted(true);
    void a.play().catch(() => {});
  }, [song.autoplayMuted]);

  const toggle = () => {
    const a = audio.current;
    if (a) {
      if (a.paused) void a.play().catch(() => {});
      else a.pause();
      return;
    }
    if (youtube) setEmbed(true);
  };

  return (
    <section className="gcs-card gcs-vipSong" aria-label={labels.title} data-testid="gcs-profile-song">
      <h2 className="gcs-display gcs-vipSong__heading">
        <GcsIconSvg icon={faMusic} />
        {labels.title}
      </h2>
      <div className={`gcs-vipSong__row${playing ? " gcs-vipSong__row--playing" : ""}`}>
        <span className="gcs-vipSong__disc" aria-hidden="true" />
        <span className="gcs-vipSong__meta">
          <strong>{song.title}</strong>
          {song.artist && <span>{song.artist}</span>}
        </span>
        {!embed && (
          <button type="button" className="gcs-vipSong__play" onClick={toggle} aria-label={playing ? labels.pause : labels.play}>
            <GcsIconSvg icon={playing ? faPause : faPlay} />
          </button>
        )}
      </div>
      {song.audio && (
        <audio
          ref={audio}
          src={song.audio}
          preload="none"
          loop
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        />
      )}
      {song.audio && muted && playing && (
        <button
          type="button"
          className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-vipSong__unmute"
          onClick={() => {
            if (audio.current) audio.current.muted = false;
          }}
        >
          <GcsIconSvg icon={faVolumeHigh} />
          {labels.unmute}
        </button>
      )}
      {!song.audio && youtube && (
        <div className="gcs-vipSong__yt">
          {embed ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&rel=0`}
              title={song.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          ) : (
            <p className="gcs-muted">{labels.youtube}</p>
          )}
        </div>
      )}
    </section>
  );
}
