/**
 * Reading the server's configuration out of the environment, as pure functions.
 *
 * SEPARATE FROM server.ts SO IT CAN BE TESTED. Every bug this file exists to
 * prevent is a startup that looks successful — GPT Sol found the first one on
 * 2026-09-08 and it is the reason the module exists at all.
 */

export type BindList = { ok: true; binds: string[] } | { ok: false; why: string };

/**
 * Addresses to listen on, from a comma-separated string.
 *
 * **AN EMPTY LIST IS AN ERROR, NOT AN EMPTY LIST.** `FLEET_BIND=""` used to give
 * zero servers, and because the only remaining timer was `unref()`d the process
 * did one full collection, printed "collected 36 sessions" and "refreshing every
 * 60s", and then exited 0. Every line of that output says it worked. The way it
 * actually happens is `FLEET_BIND="$(tailscale ip -4)"` on a box where Tailscale
 * is not logged in, which substitutes to nothing —
 * docs/reusable/silent-success.md.
 *
 * **A WILDCARD IS REFUSED.** This server has no authentication, by design:
 * reachability is the access control. `0.0.0.0` or `::` hands that away in one
 * environment variable. Today the Hetzner firewall would still refuse the
 * traffic, so this is a defence in depth rather than the only lock — but the
 * steering routes are coming, and by then a comment saying "never a wildcard"
 * will not be enough. Sol's F7.
 */
export function parseBinds(raw: string | undefined): BindList {
  const binds = (raw ?? "127.0.0.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (binds.length === 0) {
    return { ok: false, why: "FLEET_BIND is set but empty — refusing to start a server that listens nowhere" };
  }
  const wild = binds.find((b) => WILDCARDS.has(b));
  if (wild !== undefined) {
    return { ok: false, why: `FLEET_BIND contains the wildcard ${wild}; this server has no auth and must bind a private address` };
  }
  return { ok: true, binds };
}

const WILDCARDS = new Set(["0.0.0.0", "::", "[::]", "*", ""]);
