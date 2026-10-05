/** Iconurile forumurilor (alese din ACP); implicit balonul de chat din macheta Main. */
const ICONS: Record<string, string[]> = {
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  megaphone: ["m3 11 18-5v12L3 14v-3z", "M11.6 16.8a3 3 0 1 1-5.8-1.6"],
  book: ["M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  gamepad: ["M6 12h4", "M8 10v4", "M15 13h.01", "M18 11h.01", "M17.32 5H6.68a4 4 0 0 0-3.98 3.59l-.9 7.2A3 3 0 0 0 4.78 19c1 0 1.88-.53 2.39-1.38L8 16h8l.83 1.62A2.78 2.78 0 0 0 19.22 19a3 3 0 0 0 2.98-3.21l-.9-7.2A4 4 0 0 0 17.32 5z"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  help: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
};

export const GCS_FORUM_ICONS = Object.keys(ICONS);

export function GcsForumIcon({ icon, color, size = 22 }: { icon: string | null; color: string; size?: number }) {
  const paths = ICONS[icon ?? "chat"] ?? ICONS.chat!;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
