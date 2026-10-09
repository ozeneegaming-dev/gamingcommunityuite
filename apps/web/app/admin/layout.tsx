import type { ReactNode } from "react";
import { GcsDesignSync } from "../(site)/_components/GcsDesignSync";

/**
 * Toate paginile ACP (panoul, editoarele pe tot ecranul, reautentificarea): fără clasa designului temei site-ului
 * pe `<html>`, nici după o navigare fără reîncărcare venită de pe site (ACP-ul are designul lui).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GcsDesignSync design={null} />
      {children}
    </>
  );
}
