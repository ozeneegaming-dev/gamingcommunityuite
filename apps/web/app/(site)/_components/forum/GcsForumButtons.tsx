"use client";

import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { markForumRead, setFollow } from "../../forum-actions";

/** „Marchează citit” pe un forum. */
export function GcsMarkReadButton({ forumId }: { forumId: number }) {
  const t = useTranslations("forum");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <GcsButton
      variant="ghost"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const res = await markForumRead({ forumId });
          if (res.ok) {
            setDone(true);
            router.refresh();
          }
        })
      }
    >
      {done ? t("marked") : t("markRead")}
    </GcsButton>
  );
}

/** „Urmărește · N” pe un forum sau topic (macheta Topic). */
export function GcsFollowButton(props: { contentType: "forum" | "topic"; contentId: number; following: boolean; count: number }) {
  const t = useTranslations("forum");
  const [following, setFollowing] = useState(props.following);
  const [count, setCount] = useState(props.count);
  const [pending, start] = useTransition();
  return (
    <GcsButton
      variant="ghost"
      aria-pressed={following}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setFollow({ contentType: props.contentType, contentId: props.contentId, follow: !following });
          if (res.ok) {
            setFollowing(!following);
            setCount(res.data.count);
          }
        })
      }
    >
      {t("followCount", { label: following ? t("following") : t("follow"), count })}
    </GcsButton>
  );
}
