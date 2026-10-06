"use client";

import type { GcsUserRef } from "@gcs/modules";
import { GcsUserLink } from "@gcs/ui";
import { useEffect, useState } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

type Readers = { users: GcsUserRef[]; guests: number };
type Labels = { readers: string; guests: string; typing: string; typingMany: string; newPosts: string; newPost: string; show: string };

const TYPING_MS = 6_000;

/**
 * Bara live a topicului (specul etapei 4 §8): „Citesc acum”, „X scrie un răspuns…” și „N postări noi — arată”.
 * Totul e anunțat discret cititoarelor de ecran (`aria-live="polite"`).
 */
export function GcsTopicLive({ topicId, viewerId, initialReaders, unreadHref, labels }: { topicId: number; viewerId: string | null; initialReaders: Readers; unreadHref: string; labels: Labels }) {
  const realtime = useRealtime();
  const [readers, setReaders] = useState(initialReaders);
  const [typing, setTyping] = useState<Map<string, { name: string; at: number }>>(new Map());
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  useEffect(() => {
    const room = `topic:${topicId}`;
    void realtime.join(room);
    const offs = [
      realtime.on("readers", (data) => {
        const d = data as (Readers & { topicId: number }) | null;
        if (d?.topicId === topicId) setReaders({ users: d.users, guests: d.guests });
      }),
      realtime.on("typing", (data) => {
        const d = data as { topicId: number; userId: string; name: string | null } | null;
        if (!d || d.topicId !== topicId || d.userId === viewerId || !d.name) return;
        setTyping((m) => new Map(m).set(d.userId, { name: d.name!, at: Date.now() }));
      }),
      realtime.on("post:new", (data) => {
        const d = data as { topicId: number; postId: number; authorId: string | null } | null;
        if (!d || d.topicId !== topicId || d.authorId === viewerId) return;
        setFresh((s) => new Set(s).add(d.postId));
        if (d.authorId) setTyping((m) => (m.has(d.authorId!) ? new Map([...m].filter(([id]) => id !== d.authorId)) : m));
      }),
    ];
    return () => {
      for (const off of offs) off();
      realtime.leave(room);
    };
  }, [realtime, topicId, viewerId]);

  // „scrie…” dispare după 6 s fără alt semnal.
  useEffect(() => {
    if (typing.size === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((m) => {
        const kept = [...m].filter(([, v]) => now - v.at < TYPING_MS);
        return kept.length === m.size ? m : new Map(kept);
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [typing.size]);

  const others = readers.users.filter((u) => u.id !== viewerId);
  const typers = [...typing.values()].map((v) => v.name);
  return (
    <div className="gcs-topicLive" aria-live="polite" data-testid="gcs-topic-live">
      {(others.length > 0 || readers.guests > 0) && (
        <p className="gcs-topicLive__readers" data-testid="gcs-topic-readers">
          <span className="gcs-muted">{labels.readers}</span>{" "}
          {others.map((u, i) => (
            <span key={u.id}>
              <GcsUserLink userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
              {i < others.length - 1 ? ", " : ""}
            </span>
          ))}
          {readers.guests > 0 && <span className="gcs-muted">{`${others.length > 0 ? " · " : ""}${labels.guests.replace("{count}", String(readers.guests))}`}</span>}
        </p>
      )}
      {typers.length > 0 && (
        <p className="gcs-topicLive__typing" data-testid="gcs-topic-typing">
          {typers.length === 1 ? labels.typing.replace("{name}", typers[0]!) : labels.typingMany.replace("{names}", typers.join(", "))}
        </p>
      )}
      {fresh.size > 0 && (
        <p className="gcs-topicLive__banner" role="status" data-testid="gcs-topic-new-posts">
          {fresh.size === 1 ? labels.newPost : labels.newPosts.replace("{count}", String(fresh.size))} —{" "}
          <a href={unreadHref}>{labels.show}</a>
        </p>
      )}
    </div>
  );
}
