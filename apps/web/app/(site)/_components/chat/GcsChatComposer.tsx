"use client";

import { faFaceSmile, faImage } from "@fortawesome/free-regular-svg-icons";
import { faArrowTurnDown, faMagnifyingGlass, faMicrophone, faStop, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { GcsAttachmentInfo, GcsErrorPayload, GcsResult } from "@gcs/core";
import type { GcsChatConfig, GcsGif } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { GcsChatEmojiPicker } from "./GcsChatEmojiPicker";
import { useDismiss } from "./use-dismiss";

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
  /** Unde se deschid selectoarele: deasupra câmpului (implicit) sau dedesubt (câmpul e deasupra listei). */
  placement?: "above" | "below";
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
 * Câmpul de mesaj al chat-ului (după chatbox-ul de referință): câmpul pe toată lățimea, cu uneltele în dreapta lui (imagine,
 * GIF, voce, emoticoane) și butonul albastru Enter. Imaginile se adaugă și prin lipire sau tragere, mesajele vocale se
 * înregistrează în browser, GIF-urile vin din GIPHY (`/giphy cuvânt` sau butonul GIF). Selectoarele sunt flotante,
 * ancorate de butoane, și se închid la click în afară sau la Escape. Butonul Enter se poate ascunde pe mobil (Enter
 * trimite oricum).
 */
export const GcsChatComposer = forwardRef<GcsChatComposerHandle, Props>(function GcsChatComposer(props, ref) {
  const { channel, disabled, busy, config, labels, onSend, onError, placement = "above" } = props;
  const t = useTranslations("chat.ui");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [panel, setPanel] = useState<"emoji" | "gif" | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const emojiButton = useRef<HTMLButtonElement>(null);
  const gifButton = useRef<HTMLButtonElement>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  useDismiss(panel !== null, panelRef, closePanel, panel === "gif" ? gifButton : emojiButton);
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
    <div className={`gcs-chat__composer${config.hideEnterMobile ? " gcs-chat__composer--noEnterMobile" : ""}`}>
      {files.length > 0 && (
        <ul className="gcs-chat__pending" aria-label={t("attached")}>
          {files.map((f) => (
            <li key={f.id}>
              <img src={f.url} alt={f.name} />
              <button
                type="button"
                aria-label={t("removeFile", { name: f.name })}
                title={t("removeFile", { name: f.name })}
                onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
              >
                <GcsIconSvg icon={faXmark} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {panel === "emoji" && <GcsChatEmojiPicker ref={panelRef} placement={placement} onPick={insert} />}
      {panel === "gif" && (
        <div ref={panelRef} className={`gcs-chat__panel gcs-chat__gifs gcs-chat__panel--${placement}`} role="dialog" aria-label="GIPHY" data-testid="gcs-chat-gifs">
          <form
            className="gcs-chat__gifSearch"
            onSubmit={(e) => {
              e.preventDefault();
              void searchGifs(gifQuery);
            }}
          >
            <input className="gcs-input" aria-label={t("gifSearch")} placeholder={t("gifSearch")} value={gifQuery} onChange={(e) => setGifQuery(e.target.value)} autoFocus maxLength={50} />
            <button type="submit" className="gcs-chat__tool" aria-label={t("search")} title={t("search")} disabled={gifLoading || !gifQuery.trim()}>
              <GcsIconSvg icon={faMagnifyingGlass} />
            </button>
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
      {recording && (
        <p className="gcs-chat__recording">
          <span className="gcs-chat__recDot" aria-hidden="true" />
          <span className="gcs-chat__recTime" role="timer" aria-live="off">
            {mmss(recording.seconds)} / {mmss(config.voiceMaxSeconds)}
          </span>
          <button type="button" className="gcs-linkButton" onClick={() => stopVoice(true)}>
            {t("voiceCancel")}
          </button>
        </p>
      )}
      <form ref={formRef} className="gcs-chat__form" onSubmit={(e) => void submit(e)}>
        <div className="gcs-chat__field">
          <input
            ref={inputRef}
            className="gcs-chat__input"
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
            data-testid="gcs-chat-input"
          />
          <div className="gcs-chat__buttons">
            {config.allowImages && (
              <>
                <button type="button" className="gcs-chat__tool" aria-label={t("addImage")} title={t("addImage")} disabled={off} onClick={() => fileRef.current?.click()}>
                  <GcsIconSvg icon={faImage} />
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
              <button
                ref={gifButton}
                type="button"
                className="gcs-chat__tool gcs-chat__tool--gif"
                aria-label="GIF"
                title="GIPHY"
                aria-haspopup="dialog"
                aria-expanded={panel === "gif"}
                disabled={disabled}
                onClick={() => setPanel(panel === "gif" ? null : "gif")}
              >
                GIF
              </button>
            )}
            {canRecord &&
              (recording ? (
                <button type="button" className="gcs-chat__tool gcs-chat__tool--rec" aria-label={t("voiceStop")} title={t("voiceStop")} onClick={() => stopVoice(false)}>
                  <GcsIconSvg icon={faStop} />
                </button>
              ) : (
                <button type="button" className="gcs-chat__tool" aria-label={t("voiceStart")} title={t("voiceStart")} disabled={off} onClick={() => void startVoice()}>
                  <GcsIconSvg icon={faMicrophone} />
                </button>
              ))}
            <button
              ref={emojiButton}
              type="button"
              className="gcs-chat__tool gcs-chat__tool--emoji"
              aria-label={t("emoji")}
              title={t("emoji")}
              aria-haspopup="dialog"
              aria-expanded={panel === "emoji"}
              disabled={disabled}
              onClick={() => setPanel(panel === "emoji" ? null : "emoji")}
            >
              <GcsIconSvg icon={faFaceSmile} />
            </button>
          </div>
        </div>
        <button
          type="submit"
          className="gcs-chat__send"
          aria-label={labels.send}
          title={labels.send}
          disabled={off || recording !== null || (!text.trim() && files.length === 0)}
        >
          <GcsIconSvg icon={faArrowTurnDown} className="gcs-chat__sendIcon" />
        </button>
      </form>
    </div>
  );
});
