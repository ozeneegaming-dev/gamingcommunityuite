/**
 * Redirecționare într-un route handler, cu `Location` relativ. În build-ul standalone, `req.url` are host-ul pe care
 * ascultă serverul (`0.0.0.0:3000`), nu pe cel al vizitatorului, deci un URL absolut construit din el e greșit în producție.
 */
export function localRedirect(path: string, status: 303 | 307 | 308 = 303): Response {
  return new Response(null, { status, headers: { Location: path } });
}
