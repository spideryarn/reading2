/**
 * Which names this dashboard is willing to be addressed as.
 *
 * ONE COPY, BECAUSE TWO ROUTES GOT DIFFERENT ANSWERS. `routes-steer.ts` and
 * `routes-new.ts` were built in parallel by two agents and each wrote its own
 * origin check. They agreed on the easy half — an `Origin` must be present,
 * must not be the literal `null`, and its host must equal `Host` — and
 * disagreed on the half that matters: only one of them checked the hostname
 * itself. So the route that can TYPE INTO a session was closed to DNS rebinding
 * and the route that can START one was open to it, which is the wrong way round
 * of a distinction that should not have existed.
 *
 * WHAT REBINDING DOES TO A SAME-ORIGIN CHECK. A page at `evil.example` whose DNS
 * re-resolves to this box's tailnet address sends `Host: evil.example` and
 * `Origin: http://evil.example`. Those two agree with each other perfectly, and
 * a check that only compares them passes. `sec-fetch-site` does not save you
 * either: the browser genuinely believes the request is same-origin, because by
 * its lights it is. The only thing that catches it is refusing to answer to a
 * name we are never legitimately reached by.
 *
 * There is no such name. `parseBinds` in config.ts refuses a wildcard, and the
 * two real binds are a literal `127.0.0.1` and a tailnet address — so an IP
 * literal, `localhost`, and Tailscale's MagicDNS suffix is the whole set. If a
 * real hostname is ever added, it is added here, deliberately, in one place.
 *
 * Kept as a bare predicate rather than a shared `checkOrigin`: the two routes
 * return different refusal shapes (one a coded union, one a `Parsed`), and
 * unifying those is a refactor with no security content. This is the part that
 * had security content.
 */
export function addressableHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost") return true;
  // IPv4 literal. Deliberately loose about the range of each octet: this is not
  // validating an address, it is refusing a NAME, and `999.1.2.3` is not a name
  // anybody reaches this box by either.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // IPv6 literal, with the brackets already stripped above.
  if (h.includes(":") && /^[0-9a-f:.]+$/.test(h)) return true;
  return h.endsWith(".ts.net");
}
