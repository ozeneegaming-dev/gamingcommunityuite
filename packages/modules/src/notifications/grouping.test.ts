import { describe, expect, test } from "vitest";
import { notificationText } from "./emails";

const text = (type: string, actors: string[], count: number, locale = "ro", data: Record<string, unknown> = {}) => notificationText({ type, actors, count, title: "Server nou", data }, locale);

describe("gruparea notificărilor în text („X și alți 3 au reacționat”)", () => {
  test("reacțiile: un actor, doi actori, mai mulți (ultimii trei ținuți, numărul total)", () => {
    expect(text("forums.reaction", ["Ana"], 1)).toBe("Ana a reacționat la postarea ta din „Server nou”");
    expect(text("forums.reaction", ["Ana", "Mihai"], 2)).toBe("Ana și Mihai au reacționat la postarea ta din „Server nou”");
    expect(text("forums.reaction", ["Ana", "Mihai", "Ion"], 4)).toBe("Ana și alți 3 au reacționat la postarea ta din „Server nou”");
    expect(text("forums.reaction", ["Ana", "Mihai", "Ion"], 4, "en")).toBe("Ana and 3 others reacted to your post in “Server nou”");
  });

  test("urmăritorii și răspunsurile (fiecare eveniment numără)", () => {
    expect(text("profile.follower", ["Ana", "Mihai", "Ion"], 3)).toBe("Ana și alți 2 te urmăresc");
    expect(text("profile.follower", ["Ana"], 1)).toBe("Ana te urmărește");
    expect(text("forums.reply", ["Ana", "Mihai"], 5)).toBe("5 răspunsuri noi în „Server nou” (ultimul: Ana)");
    expect(text("forums.reply", ["Ana"], 1)).toBe("Ana a răspuns în „Server nou”");
  });

  test("rezumatul săptămânal: numerele săptămânii, fără secțiunile goale", () => {
    expect(text("core.weekly_digest", [], 1, "ro", { topics: 5, mentions: 2, servers: 0 })).toBe("Ce ai ratat săptămâna aceasta: 5 topicuri populare, 2 mențiuni");
    expect(text("core.weekly_digest", [], 1, "en", { topics: 0, mentions: 0, servers: 3 })).toBe("What you missed this week: 3 active servers");
    expect(text("core.weekly_digest", [], 1, "ro")).toBe("Ce ai ratat săptămâna aceasta");
  });

  test("un actor necunoscut („Cineva”) și un tip fără text (titlul)", () => {
    expect(text("forums.reaction", [], 1)).toBe("Cineva a reacționat la postarea ta din „Server nou”");
    expect(text("plugin.unknown", ["Ana"], 1)).toBe("Server nou");
  });
});
