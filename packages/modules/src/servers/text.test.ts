import { describe, expect, test } from "vitest";
import { chatComponentText, cleanGameText } from "./text";

describe("textele venite de la serverele de joc", () => {
  test("codurile de culoare Minecraft (§x, inclusiv §x hex) dispar", () => {
    expect(cleanGameText("§aServer §lSurvival§r §x§f§f§0§0§0§0Roșu", 128)).toBe("Server Survival Roșu");
    // Un § singur la final nu lasă nimic în urmă.
    expect(cleanGameText("Lobby§", 128)).toBe("Lobby");
  });

  test("caracterele de control (codurile de culoare Source/GoldSrc), invizibile și bidi dispar; spațiile se comprimă", () => {
    expect(cleanGameText("\x01[GCS]\x03 Public\x04  #1\n\t ", 128)).toBe("[GCS] Public #1");
    // Spațiul de lățime zero, suprascrierea și izolarea de direcție (bidi), BOM-ul: scrise ca coduri, nu literal.
    const hidden = (...codes: number[]) => String.fromCodePoint(...codes);
    expect(cleanGameText(`A${hidden(0x200b)}dmin${hidden(0x202e, 0x2066)}x${hidden(0xfeff)}`, 128)).toBe("Adminx");
    expect(cleanGameText("\u0000\u007F\u009Fok", 128)).toBe("ok");
  });

  test("HTML-ul rămâne text (se afișează literal), iar lungimea se taie pe caractere, nu pe octeți", () => {
    expect(cleanGameText("<script>alert(1)</script>", 128)).toBe("<script>alert(1)</script>");
    expect(cleanGameText("ăîșț".repeat(10), 5)).toBe("ăîșță");
    expect([...cleanGameText("😀".repeat(40), 32)]).toHaveLength(32);
  });

  test("valorile care nu sunt text devin șir gol", () => {
    expect(cleanGameText(undefined, 10)).toBe("");
    expect(cleanGameText(42 as unknown as string, 10)).toBe("");
  });

  test("componentele de chat Minecraft (MOTD-ul JSON) se aplatizează în text, cu adâncime limitată", () => {
    expect(chatComponentText({ text: "§6Bun ", extra: [{ text: "venit", bold: true }, " pe server", { extra: [{ text: "!" }] }] })).toBe("§6Bun venit pe server!");
    expect(chatComponentText(["a", { text: "b" }])).toBe("ab");
    expect(chatComponentText("simplu")).toBe("simplu");
    expect(chatComponentText(null)).toBe("");
    let deep: Record<string, unknown> = { text: "x" };
    for (let i = 0; i < 100; i++) deep = { extra: [deep] };
    expect(chatComponentText(deep)).toBe("");
  });
});
