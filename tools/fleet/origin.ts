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
 * THE WHOLE ALLOWED SET, and why each is safe from rebinding. `server.ts`
 * refuses every request whose `Host` is not one of these, before any route, and
 * the write routes refuse an `Origin` that is not — so this list is the
 * dashboard's answer to *which names may address me*, in one place:
 *
 *  - **An IP literal**, v4 or v6. A browser that sent an IP as `Host` went to
 *    that IP; no name was resolved, so no attacker-controlled name is involved.
 *  - **`localhost`** — the ssh forward. It resolves on the reader's own machine.
 *  - **`*.ts.net`** — the Tailscale MagicDNS full name, a zone only the
 *    tailnet's own resolver answers.
 *  - **A single DNS label**, such as `spideryarn-box` — the MagicDNS SHORT name,
 *    which is what a phone on the tailnet may have bookmarked. The attack needs a
 *    page served from a name the attacker controls in public DNS, and every such
 *    name has a dot in it. Held to the letters of a DNS label and no more: not
 *    empty, no dot (so no trailing-dot `evil.`), nothing outside `[a-z0-9-]`,
 *    and no hyphen at either end. Added 2026-09-10 on GPT Sol's F1 (plan
 *    260910f), when checking `Host` on every read would otherwise have turned
 *    that bookmark into a refusal.
 *
 * DELIBERATELY NOT NARROWED TO THE BIND ADDRESSES: that would couple this guard
 * to deployment config (`FLEET_BIND`) for no gain against rebinding, which is
 * about names, not about which of our own addresses was used. If a real
 * hostname is ever added, it is added here, deliberately, in one place.
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
  if (h.endsWith(".ts.net")) {
    const prefix = h.slice(0, -".ts.net".length);
    return prefix.split(".").every(dnsLabel);
  }
  // One DNS label — the MagicDNS short name. See the header for why it is safe.
  return dnsLabel(h);
}

function dnsLabel(label: string): boolean {
  return label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
}
