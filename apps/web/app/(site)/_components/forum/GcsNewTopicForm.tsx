"use client";

import { faPaperPlane, faPlus, faSquarePollVertical, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { createTopicAction } from "../../topic-actions";
import { useEditorLabels } from "../topic/useEditorLabels";

type Props = {
  forum: { id: number; href: string };
  prefixes: { id: number; name: string; color: string }[];
  tagsMax: number;
  /** Limita de caractere a postării (`forums.post_max_chars`). */
  maxLength?: number;
  canPoll: boolean;
};

/** Formularul pentru un topic nou: titlu, prefix, tag-uri, mesaj și sondaj opțional. */
export function GcsNewTopicForm({ forum, prefixes, tagsMax, canPoll, maxLength }: Props) {
  const t = useTranslations("newTopic");
  const labels = useEditorLabels();
  const errorMessage = useErrorMessage();
  const editor = useRef<GcsEditorHandle>(null);
  const [title, setTitle] = useState("");
  const [prefixId, setPrefixId] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [poll, setPoll] = useState<{ question: string; options: string[]; multiple: boolean; closesAt: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function addTag() {
    const tag = tagInput.trim().replace(/^#/, "");
    if (tag && !tags.includes(tag) && tags.length < tagsMax) setTags([...tags, tag]);
    setTagInput("");
  }

  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  async function submit() {
    if (!editor.current) return;
    setSending(true);
    setError(null);
    const res = await createTopicAction({
      forumId: forum.id,
      title,
      content: editor.current.getJSON(),
      prefixId,
      tags: tagInput.trim() ? [...tags, tagInput.trim()] : tags,
      poll: poll
        ? {
            question: poll.question,
            options: poll.options.filter((o) => o.trim()),
            multiple: poll.multiple,
            closesAt: poll.closesAt ? new Date(poll.closesAt).toISOString() : null,
          }
        : null,
    });
    setSending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    editor.current.clear();
    if (res.data.pending) return setPending(true);
    window.location.assign(res.data.href);
  }

  if (pending) {
    return (
      <div className="gcs-card gcs-formCard" role="status">
        <p className="gcs-notice">{t("pending")}</p>
        <Link href={forum.href}>{t("backToForum")}</Link>
      </div>
    );
  }

  return (
    <form
      className="gcs-card gcs-formCard"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="gcs-field">
        <span className="gcs-field__label">{t("titleLabel")}</span>
        <input className="gcs-input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={150} />
      </label>

      {prefixes.length > 0 && (
        <label className="gcs-field">
          <span className="gcs-field__label">{t("prefix")}</span>
          <select className="gcs-input" value={prefixId ?? ""} onChange={(e) => setPrefixId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t("noPrefix")}</option>
            {prefixes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {tagsMax > 0 && (
        <div className="gcs-field">
          <label className="gcs-field__label" htmlFor="gcs-tag-input">
            {t("tags")}
          </label>
          <div className="gcs-tagInput">
            {tags.map((tag) => (
              <span key={tag} className="gcs-tag">
                #{tag}
                <button type="button" aria-label={t("removeTag", { tag })} onClick={() => setTags(tags.filter((x) => x !== tag))}>
                  <GcsIconSvg icon={faXmark} />
                </button>
              </span>
            ))}
            <input
              id="gcs-tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKey}
              onBlur={addTag}
              disabled={tags.length >= tagsMax}
              aria-describedby="gcs-tag-help"
            />
          </div>
          <span id="gcs-tag-help" className="gcs-field__hint">
            {t("tagsHelp", { max: tagsMax })}
          </span>
        </div>
      )}

      <div className="gcs-field">
        <span className="gcs-field__label" id="gcs-new-topic-content">
          {t("content")}
        </span>
        <GcsEditor
          ref={editor}
          id="gcs-new-topic-editor"
          labels={labels}
          {...(maxLength ? { maxLength } : {})}
          forumId={forum.id}
          uploadUrl="/api/forums/uploads"
          mentionUrl="/api/forums/mentions"
          draftKey={`new-topic-${forum.id}`}
        />
      </div>

      {canPoll &&
        (poll ? (
          <fieldset className="gcs-pollEditor">
            <legend>
              <GcsIconSvg icon={faSquarePollVertical} className="gcs-hIcon" />
              {t("pollQuestion")}
            </legend>
            <label className="gcs-field">
              <span className="gcs-srOnly">{t("pollQuestion")}</span>
              <input className="gcs-input" value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} maxLength={200} />
            </label>
            {poll.options.map((o, i) => (
              <div key={i} className="gcs-pollEditor__option">
                <label className="gcs-field" style={{ flex: 1 }}>
                  <span className="gcs-field__label">{t("pollOption", { n: i + 1 })}</span>
                  <input
                    className="gcs-input"
                    value={o}
                    maxLength={100}
                    onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })}
                  />
                </label>
                {poll.options.length > 2 && (
                  <GcsButton
                    variant="ghost"
                    size="sm"
                    aria-label={t("removeOption", { n: i + 1 })}
                    onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}
                  >
                    <GcsIconSvg icon={faXmark} />
                  </GcsButton>
                )}
              </div>
            ))}
            {poll.options.length < 10 && (
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faPlus} />} onClick={() => setPoll({ ...poll, options: [...poll.options, ""] })}>
                {t("addOption")}
              </GcsButton>
            )}
            <label className="gcs-check">
              <input type="checkbox" checked={poll.multiple} onChange={(e) => setPoll({ ...poll, multiple: e.target.checked })} />
              {t("pollMultiple")}
            </label>
            <label className="gcs-field">
              <span className="gcs-field__label">{t("pollCloses")}</span>
              <input className="gcs-input" type="datetime-local" value={poll.closesAt} onChange={(e) => setPoll({ ...poll, closesAt: e.target.value })} />
            </label>
            <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faTrash} />} onClick={() => setPoll(null)}>
              {t("removePoll")}
            </GcsButton>
          </fieldset>
        ) : (
          <GcsButton
            variant="ghost"
            icon={<GcsIconSvg icon={faSquarePollVertical} />}
            onClick={() => setPoll({ question: "", options: ["", ""], multiple: false, closesAt: "" })}
          >
            {t("addPoll")}
          </GcsButton>
        ))}

      {error && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {error}
        </p>
      )}
      <div>
        <GcsButton variant="primary" type="submit" loading={sending} icon={<GcsIconSvg icon={faPaperPlane} />}>
          {sending ? t("sending") : t("submit")}
        </GcsButton>
      </div>
    </form>
  );
}
