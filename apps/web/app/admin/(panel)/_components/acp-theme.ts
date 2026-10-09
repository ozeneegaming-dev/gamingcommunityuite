/**
 * Tema ACP (Auto / Light / Dark), salvată într-un cookie. Constantele stau într-un modul comun (nu în componenta client):
 * importată dintr-un modul `"use client"`, o constantă ajunge în componentele server ca referință client, nu ca text, iar
 * layout-ul n-ar mai găsi cookie-ul (ACP-ul revenea mereu la tema închisă la reîncărcare).
 */
export type GcsAcpTheme = "auto" | "light" | "dark";
export const ACP_THEME_COOKIE = "gcs-acp-theme";
export const ACP_THEMES: readonly GcsAcpTheme[] = ["auto", "light", "dark"];
