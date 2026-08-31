/**
 * Is the box's Claude Code actually holding the MCP servers this repo declares?
 *
 * Split out from gjd-remote.ts so the parsing can be tested without a network,
 * the same reason gjd-remote-tmux.ts is its own file.
 *
 * ## Why doctor checks this at all
 *
 * Two of the three servers in .mcp.json need an OAuth login that only a human
 * with a browser can do, once per box (`claude mcp login vercel`). Nothing about
 * a box that has not had it done looks wrong: sessions start, tests pass, and an
 * agent simply never has the tool. The failure is an absence, and an absence is
 * exactly what nobody notices. So it becomes a check that goes red.
 *
 * See infra/hetzner/README.md#mcp-servers.
 */

/** What the repo says should be there — derived, never a second hardcoded list. */
export type Declared = { ok: true; names: string[] } | { ok: false; why: string };

/**
 * Read the server names out of a .mcp.json.
 *
 * Every failure here is an explicit `ok: false`, and there is deliberately no
 * path that returns an empty list as a success. An empty list would make the
 * verdict below pass while asserting nothing about anything, which is the shape
 * of bug this repo keeps a document about (docs/reusable/silent-success.md).
 */
export function declaredServers(text: string): Declared {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, why: `.mcp.json is not valid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, why: ".mcp.json is not an object" };
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (typeof servers !== "object" || servers === null) {
    return { ok: false, why: ".mcp.json has no mcpServers object" };
  }
  const names = Object.keys(servers as Record<string, unknown>);
  if (names.length === 0) return { ok: false, why: ".mcp.json declares no servers" };
  return { ok: true, names: names.sort() };
}

/**
 * A line of `claude mcp list` ends in a status. We want one word from it, and
 * matching on the tick alone is not enough: the box speaks over ssh, and a
 * mangled ✔ would silently turn every server into a failure.
 */
const CONNECTED = /-\s*(?:✔\s*)?Connected\s*$/;

export interface McpVerdict {
  ok: boolean;
  why: string;
}

/**
 * Which of `wanted` does the box report as connected?
 *
 * `listing` is the raw stdout+stderr of `claude mcp list` run on the box. It
 * contains Greg's account-level servers too (Notion, Zapier, …), and those are
 * none of our business — a Notion server needing auth must not redden a check
 * about this repo's three.
 */
export function mcpVerdict(listing: string, wanted: readonly string[]): McpVerdict {
  if (wanted.length === 0) {
    return { ok: false, why: "nothing to check for — refusing to pass by asserting nothing" };
  }
  // A listing that names none of them is a different problem from a listing
  // that names them and says they need a login, and the two want different
  // advice. `claude` missing, ssh failing, the wrong directory: all land here.
  const lines = listing.split("\n");
  const statusOf = (name: string): string | undefined =>
    lines.find((l) => l.startsWith(`${name}: `));

  const missing = wanted.filter((n) => statusOf(n) === undefined);
  if (missing.length === wanted.length) {
    return {
      ok: false,
      why:
        `the box listed none of them (${wanted.join(", ")}) — so this is not a missing login. ` +
        `Has it pulled the commit that added .mcp.json?`,
    };
  }
  const unconnected = wanted.filter((n) => {
    const line = statusOf(n);
    return line === undefined || !CONNECTED.test(line.trimEnd());
  });
  if (unconnected.length > 0) {
    return {
      ok: false,
      why: `${unconnected.join(", ")} not connected — on the box: claude mcp login ${unconnected[0]}`,
    };
  }
  return { ok: true, why: `${wanted.length} connected: ${wanted.join(", ")}` };
}
