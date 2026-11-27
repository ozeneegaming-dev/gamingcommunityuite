const IPV4_REGEX = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/;

function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 45) return false;
  return IPV4_REGEX.test(ip) || (ip.includes(":") && /^[0-9a-fA-F:]{2,39}$/.test(ip));
}

/**
 * IP-ul clientului, așa cum îl vede proxy-ul din fața aplicației. Proxy-ul (Caddy în `docker-compose`, nginx pe
 * instalările cu proxy propriu) suprascrie `X-Real-IP` cu adresa conexiunii, deci clientul nu-l poate falsifica.
 * Dacă se folosește Cloudflare (frecvent pe comunități de gaming), `CF-Connecting-IP` are prioritate.
 * Fără ele, se ia **ultima** adresă din `X-Forwarded-For`: cea adăugată de proxy. Primele pot fi trimise chiar de
 * client (un proxy care adaugă la listă, ca `$proxy_add_x_forwarded_for` din nginx, le păstrează).
 */
export function clientIp(h: Headers): string {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf && isValidIp(cf)) return cf;

  const real = h.get("x-real-ip")?.trim();
  if (real && isValidIp(real)) return real;

  const forwarded = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (forwarded && forwarded.length > 0) {
    const last = forwarded[forwarded.length - 1];
    if (last && isValidIp(last)) return last;
  }

  return "0.0.0.0";
}
