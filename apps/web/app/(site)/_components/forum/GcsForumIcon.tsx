import { GcsIcon } from "@gcs/ui/icons";

/** Numele vechi (setul propriu din etapele 1–4), pentru date nemigrate; migrația etapei 5 le transformă în baza de date. */
const LEGACY: Record<string, string> = {
  chat: "fa-solid fa-comments",
  megaphone: "fa-solid fa-bullhorn",
  book: "fa-solid fa-book",
  shield: "fa-solid fa-shield-halved",
  gamepad: "fa-solid fa-gamepad",
  users: "fa-solid fa-users",
  help: "fa-solid fa-circle-question",
  link: "fa-solid fa-link",
};

/** Iconița unui forum (Font Awesome, aleasă din ACP); implicit balonul de chat din macheta Main. */
export function GcsForumIcon({ icon, color, size = 22 }: { icon: string | null; color: string; size?: number }) {
  const name = (icon && (LEGACY[icon] ?? icon)) || "fa-solid fa-comments";
  return (
    <span className="gcs-forumIcon" style={{ color, fontSize: size }} aria-hidden="true" data-icon={name}>
      <GcsIcon name={name} />
    </span>
  );
}
