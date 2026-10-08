/**
 * IP-ul clientului, așa cum îl vede proxy-ul din fața aplicației. Proxy-ul (Caddy în `docker-compose`, nginx pe
 * instalările cu proxy propriu) suprascrie `X-Real-IP` cu adresa conexiunii, deci clientul nu-l poate falsifica.
 * Fără el, se ia **ultima** adresă din `X-Forwarded-For`: cea adăugată de proxy. Primele pot fi trimise chiar de
 * client (un proxy care adaugă la listă, ca `$proxy_add_x_forwarded_for` din nginx, le păstrează).
 */
export function clientIp(h: Headers): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  return forwarded || "0.0.0.0";
}
