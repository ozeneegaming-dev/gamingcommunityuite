/**
 * Iconițele armelor preferate: desene liniare originale pe o grilă de 32×32, randate în PNG transparent de 96×96 la
 * construirea pluginului. Linia deschisă are un contur închis dedesubt, ca iconița să se vadă pe fundal închis și
 * deschis.
 */
const PATHS: Record<string, string> = {
  // Pușcă de asalt: pat, corp, încărcător curbat, țeavă cu înălțător.
  rifle: "M2 15 L6 13 L8 13 L9 12 L22 12 L22 11 L25 11 L25 12 L30 12 M9 12 L9 16 L22 16 L22 12 M13 16 L12 21 L15 21 L16 16 M18 16 L18 18 L20 18 M2 15 L2 18 L6 18 L8 16 L9 16",
  // Pușcă cu lunetă: țeavă lungă, lunetă, bipied.
  sniper: "M1 16 L5 14 L9 14 L10 13 L31 13 M10 13 L10 17 L20 17 L20 13 M12 13 L12 10 L19 10 L19 13 M11 10 L20 10 M14 17 L14 20 M24 13 L22 20 M24 13 L26 20 M1 16 L1 19 L5 19 L8 17 L10 17",
  // Pistol.
  pistol: "M7 10 L26 10 L26 14 L14 14 L13 15 L13 17 L11 17 L10 23 L6 23 L7 16 L7 10 M13 17 L16 17 L16 15 M24 10 L24 9",
  // Revolver: tambur rotund, țeavă, mâner curbat.
  revolver: "M14 11 L29 11 L29 14 L18 14 M10 10 L14 10 L14 15 L12 17 L13 23 L8 23 L8 17 L10 14 Z M16 12.5 m-2.5 0 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0",
  // Pistol-mitralieră: compact, încărcător vertical, pat pliat.
  smg: "M5 12 L25 12 L25 15 L29 15 M8 12 L8 17 L23 17 L23 12 M14 17 L14 25 L17 25 L17 17 M10 17 L9 21 L12 21 M5 12 L2 12 L2 16 L5 16",
  // Shotgun: țeavă dublă, pompă.
  shotgun: "M2 16 L7 14 L10 14 L11 13 L30 13 M11 15 L30 15 M11 13 L11 17 L16 17 L16 15 M19 15 L19 18 L26 18 L26 15 M2 16 L2 19 L6 19 L10 17 L11 17",
  // Mitralieră: cutie de muniție, bipied, țeavă cu răcire.
  lmg: "M2 14 L7 13 L10 13 L10 11 L24 11 L24 13 L31 13 M10 13 L10 17 L22 17 L22 11 M12 17 L12 22 L18 22 L18 17 M24 13 L22 21 M24 13 L27 21 M26 11 L26 13 M28 11 L28 13 M2 14 L2 18 L7 18 L10 17",
  // Cuțit tactic.
  knife: "M4 22 L10 16 M10 16 L28 6 L22 15 L13 19 Z M10 16 L13 19 M6 20 L8 22 M3 25 L7 21",
  // Grenadă.
  grenade: "M16 9 L16 7 L20 7 L20 9 M13 12 L23 12 M18 12 m-7 7 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M20 7 L24 4 M14 16 L22 16 M13 20 L23 20",
  // Arc cu săgeată.
  bow: "M9 3 Q25 16 9 29 M9 3 L9 29 M4 16 L28 16 M24 13 L28 16 L24 19 M4 16 L2 14 M4 16 L2 18",
  // Katana.
  katana: "M5 27 L9 23 M7 21 L11 25 M9 23 L28 4 L27 8 L11 25",
  // Topor.
  axe: "M7 28 L21 7 M18 5 C 22 1, 29 3, 30 10 C 26 13, 21 13, 19 10 Z M17 9 L21 11",
  // Lansator de rachete.
  launcher: "M2 13 L26 13 L26 18 L2 18 Z M26 12 L30 11 L30 20 L26 19 M8 18 L8 23 L12 23 L12 18 M15 18 L16 21 L18 21 M5 13 L5 10 L10 10 L10 13",
  // Arbaletă.
  crossbow: "M4 16 L28 16 M22 6 Q16 16 22 26 M22 6 L26 16 L22 26 M8 16 L6 21 L10 21 M28 16 L30 14 M28 16 L30 18",
};

export type GcsWeaponArt = { key: string; render: () => string };

function render(path: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 32 32">` +
    `<path d="${path}" fill="none" stroke="#0B0C10" stroke-opacity=".65" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${path}" fill="none" stroke="#E7EAF0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** Desenele armelor, după cheie (cheile și numele sunt în `src/presets.ts`). */
export const WEAPON_ART: GcsWeaponArt[] = Object.entries(PATHS).map(([key, path]) => ({ key, render: () => render(path) }));
