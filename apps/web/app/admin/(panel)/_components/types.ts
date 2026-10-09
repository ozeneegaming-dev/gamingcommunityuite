import type { GcsIconSvgProps } from "@gcs/ui";

/**
 * Iconița unei intrări din meniu, rezolvată pe server din numele Font Awesome (`resolveIcon`): doar date simple
 * (prefix, nume, path-ul SVG), ca pachetele complete de iconițe să nu ajungă în browser.
 */
export type GcsAcpIconDef = GcsIconSvgProps["icon"];

/**
 * Navigația ACP cu etichetele deja traduse pe server (componentele client nu conțin texte proprii), specul
 * 2026-10-09-acp-navigatie-aplicatii §1: zonele din bara de iconițe și, pentru fiecare, grupurile din coloana a doua.
 * `alias`: o scurtătură spre o pagină care stă în altă zonă (nu decide zona curentă).
 */
export type GcsAcpNavItem = { key: string; label: string; href: string; icon?: GcsAcpIconDef; alias?: boolean };
export type GcsAcpNavGroup = { title: string; items: GcsAcpNavItem[] };
export type GcsAcpNavArea = { key: string; label: string; groups: GcsAcpNavGroup[] };
