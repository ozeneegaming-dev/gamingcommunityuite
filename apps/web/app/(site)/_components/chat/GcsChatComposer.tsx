"use client";

import type { GcsAttachmentInfo, GcsErrorPayload, GcsResult } from "@gcs/core";
import type { GcsChatConfig, GcsGif } from "@gcs/modules";
import { GcsButton } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { GCS_EMOJI } from "./emoji-data";

const MAX_FILES = 4;
const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export type GcsChatComposerHandle = {
  /** Adaugă `@nume ` în mesaj (click pe numele unui membru). */
  mention: (name: string) => void;
};

type Props = {
  channel: string;
  disabled: boolean;
  busy: boolean;
  config: Pick<GcsChatConfig, "maxLength" | "giphy" | "voice" | "voiceMaxSeconds" | "allowImages" | "hideEnterMobile">;
  labels: { placeholder: string; send: string; input: string };
  /** Trimite mesajul; `true` dacă a plecat (câmpul se golește). */
  onSend: (body: string, files: string[]) => Promise<boolean>;
  onError: (error: GcsErrorPayload | string | null) => void;
};

type Pending = { id: string; url: string; name: string };

async function uploadChatFile(channel: string, file: Blob, name: string): Promise<GcsResult<GcsAttachmentInfo>> {
  const fd = new FormData();
  fd.set("channel", channel);
  fd.set("file", file, name);
  try {
    const res = await fetch("/api/chat/uploads", { method: "POST", body: fd });
    return (await res.json()) as GcsResult<GcsAttachmentInfo>;
  } catch {
    return { ok: false, error: { code: "internal", status: 500 } } as GcsResult<GcsAttachmentInfo>;
  }
}

/**
 * Câmpul de mesaj al chat-ului: emoticoane pe categorii, imagini (buton, lipire, tragere), mesaje vocale
 * (înregistrate în browser), GIF-uri GIPHY (`/giphy cuvânt` sau butonul GIF) și butonul de trimitere (opțional ascuns
 * pe mobil, unde Enter trimite oricum).
 */
export const GcsChatComposer = forwardRef<GcsChatComposerHandle, Props>(function GcsChatComposer(props, ref) {
  const { channel, disabled, busy, config, labels, onSend, onError } = props;
  const t = useTranslations("chat.ui");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [panel, setPanel] = useState<"emoji" | "gif" | null>(null);
  const [tab, setTab] = useState(GCS_EMOJI[0]!.key);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<GcsGif[] | null>(null);
  const [gifLoading, setGifLoading] = useState(false);
  // Înregistrarea se oferă doar unde browserul o poate face (aflat după hidratare).
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    setCanRecord(config.voice && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia);
  }, [config.voice]);

  const insert = (s: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + s + text.slice(end)).slice(0, config.maxLength > 0 ? config.maxLength : 2000);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(start + s.length, next.length);
      el?.setSelectionRange(pos, pos);
    });
  };

  useImperativeHandle(ref, () => ({
    mention: (name) => {
      const before = text && !text.endsWith(" ") ? " " : "";
      insert(`${before}@${name} `);
    },
  }));

  const addFiles = async (list: File[]) => {
    const images = list.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    if (!config.allowImages) return onError(t("imagesOff"));
    const room = MAX_FILES - files.length;
    if (room <= 0) return onError(t("tooManyFiles", { max: MAX_FILES }));
    setUploading(true);
    try {
      for (const file of images.slice(0, room)) {
        const res = await uploadChatFile(channel, file, file.name || "imagine.png");
        if (!res.ok) {
          onError(res.error);
          break;
        }
        setFiles((list) => [...list, { id: res.data.id, url: res.data.url, name: res.data.filename }]);
      }
    } finally {
      setUploading(false);
    }
  };

  // Imaginile trase peste tot chat-ul (nu doar peste câmp).
  useEffect(() => {
    const root = formRef.current?.closest(".gcs-chat") as HTMLElement | null;
    if (!root || disabled || !config.allowImages) return;
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      void addFiles([...e.dataTransfer.files]);
    };
    root.addEventListener("dragover", over);
    root.addEventListener("drop", drop);
    return () => {
      root.removeEventListener("dragover", over);
      root.removeEventListener("drop", drop);
    };
  });

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    const giphy = /^\/giphy(?:\s+(.*))?$/i.exec(body);
    if (giphy && config.giphy) {
      setPanel("gif");
      setGifQuery(giphy[1]?.trim() ?? "");
      setText("");
      if (giphy[1]?.trim()) void searchGifs(giphy[1].trim());
      return;
    }
    if (!body && files.length === 0) return;
    const ok = await onSend(body, files.map((f) => f.id));
    if (ok) {
      setText("");
      setFiles([]);
      setPanel(null);
    }
  };

  // ─── GIPHY ───────────────────────────────────────────────────────────────
  const searchGifs = async (q: string) => {
    if (!q.trim()) return;
    setGifLoading(true);
    try {
      const res = await fetch(`/api/chat/giphy?q=${encodeURIComponent(q.trim())}`);
      const body = (await res.json().catch(() => ({ gifs: [] }))) as { gifs?: GcsGif[] };
      if (!res.ok) onError(res.status === 429 ? t("gifRateLimited") : t("gifError"));
      setGifs(body.gifs ?? []);
    } finally {
      setGifLoading(false);
    }
  };
  const sendGif = async (gif: GcsGif) => {
    if (await onSend(gif.url, [])) {
      setPanel(null);
      setGifs(null);
      setGifQuery("");
    }
  };

  // ─── Mesaje vocale ───────────────────────────────────────────────────────
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; cancel: boolean; timer: ReturnType<typeof setInterval> } | null>(null);

  const startVoice = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError(t("micDenied"));
    }
    const mimeType = VOICE_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = async () => {
      const state = recorder.current;
      recorder.current = null;
      if (state) clearInterval(state.timer);
      stream.getTracks().forEach((tr) => tr.stop());
      setRecording(null);
      if (!state || state.cancel || chunks.length === 0) return;
      const type = rec.mimeType || mimeType || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      setUploading(true);
      try {
        const res = await uploadChatFile(channel, new Blob(chunks, { type }), `voce.${ext}`);
        if (!res.ok) return onError(res.error);
        await onSend("", [res.data.id]);
      } finally {
        setUploading(false);
      }
    };
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setRecording({ seconds });
      if (seconds >= config.voiceMaxSeconds) stopVoice(false);
    }, 250);
    recorder.current = { rec, stream, cancel: false, timer };
    rec.start(1000);
    setRecording({ seconds: 0 });
  };
  const stopVoice = (cancel: boolean) => {
    const state = recorder.current;
    if (!state) return;
    state.cancel = cancel;
    if (state.rec.state !== "inactive") state.rec.stop();
  };
  useEffect(
    () => () => {
      if (recorder.current) {
        recorder.current.cancel = true;
        if (recorder.current.rec.state !== "inactive") recorder.current.rec.stop();
      }
    },
    [],
  );

  const off = disabled || busy || uploading;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="gcs-chat__composer">
      {files.length > 0 && (
        <ul className="gcs-chat__pending" aria-label={t("attached")}>
          {files.map((f) => (
            <li key={f.id}>
              <img src={f.url} alt={f.name} />
              <button type="button" aria-label={t("removeFile", { name: f.name })} onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {panel === "emoji" && (
        <div className="gcs-chat__panel gcs-chat__emoji" role="dialog" aria-label={t("emoji")} data-testid="gcs-chat-emoji">
          <div className="gcs-chat__tabs" role="tablist" aria-label={t("emoji")}>
            {GCS_EMOJI.map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={tab === c.key} title={t(`emojiTabs.${c.key}`)} aria-label={t(`emojiTabs.${c.key}`)} onClick={() => setTab(c.key)}>
                {c.icon}
              </button>
            ))}
          </div>
          <div className="gcs-chat__emojiGrid" role="tabpanel" aria-label={t(`emojiTabs.${tab}`)}>
            {GCS_EMOJI.find((c) => c.key === tab)!.items.map((e) => (
              <button key={e} type="button" onClick={() => insert(e)} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
      {panel === "gif" && (
        <div className="gcs-chat__panel gcs-chat__gifs" role="dialog" aria-label="GIPHY" data-testid="gcs-chat-gifs">
          <form
            className="gcs-chat__gifSearch"
            onSubmit={(e) => {
              e.preventDefault();
              void searchGifs(gifQuery);
            }}
          >
            <input className="gcs-input" aria-label={t("gifSearch")} placeholder={t("gifSearch")} value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} autoFocus maxLength={50} />
            <GcsButton type="submit" size="sm" variant="ghost" disabled={gifLoading || !gifQuery.trim()}>
              {t("search")}
            </GcsButton>
          </form>
          {gifs && gifs.length === 0 && !gifLoading && <p className="gcs-chat__note">{t("gifNone")}</p>}
          <div className="gcs-chat__gifGrid">
            {(gifs ?? []).map((g) => (
              <button key={g.id} type="button" onClick={() => void sendGif(g)} aria-label={g.title || "GIF"} disabled={off}>
                <img src={g.preview} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
          <p className="gcs-chat__attribution">Powered by GIPHY</p>
        </div>
      )}
      <form ref={formRef} className={`gcs-chat__form${config.hideEnterMobile ? " gcs-chat__form--noEnterMobile" : ""}`} onSubmit={(e) => void submit(e)}>
        <div className="gcs-chat__buttons">
          <button type="button" className="gcs-chat__tool" aria-label={t("emoji")} title={t("emoji")} aria-expanded={panel === "emoji"} disabled={disabled} onClick={() => setPanel(panel === "emoji" ? null : "emoji")}>
            😊
          </button>
          {config.allowImages && (
            <>
              <button type="button" className="gcs-chat__tool" aria-label={t("addImage")} title={t("addImage")} disabled={off} onClick={() => fileRef.current?.click()}>
                🖼
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                hidden
                data-testid="gcs-chat-file"
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {config.giphy && (
            <button type="button" className="gcs-chat__tool gcs-chat__tool--gif" aria-label="GIF" title="GIPHY" aria-expanded={panel === "gif"} disabled={disabled} onClick={() => setPanel(panel === "gif" ? null : "gif")}>
              GIF
            </button>
          )}
          {canRecord &&
            (recording ? (
              <>
                <button type="button" className="gcs-chat__tool gcs-chat__tool--rec" aria-label={t("voiceStop")} title={t("voiceStop")} onClick={() => stopVoice(false)}>
                  ⏹
                </button>
                <span className="gcs-chat__recTime" role="timer" aria-live="off">
                  {mmss(recording.seconds)} / {mmss(config.voiceMaxSeconds)}
                </span>
                <button type="button" className="gcs-linkButton" onClick={() => stopVoice(true)}>
                  {t("voiceCancel")}
                </button>
              </>
            ) : (
              <button type="button" className="gcs-chat__tool" aria-label={t("voiceStart")} title={t("voiceStart")} disabled={off} onClick={() => void startVoice()}>
                🎤
              </button>
            ))}
        </div>
        <input
          ref={inputRef}
          className="gcs-input"
          aria-label={labels.input}
          placeholder={recording ? t("recording") : labels.placeholder}
          maxLength={config.maxLength > 0 ? config.maxLength : 2000}
          value={text}
          disabled={disabled || recording !== null}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPanel(null);
          }}
          data-testid="gcs-chat-input"
        />
        <GcsButton type="submit" variant="primary" className="gcs-chat__send" disabled={off || recording !== null || (!text.trim() && files.length === 0)}>
          {labels.send}
        </GcsButton>
      </form>
    </div>
  );
});
