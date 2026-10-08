/**
 * **The local MCP server does not carry the remote one** — plan 261007p, Sol's
 * F9. scripts/spideryarn-mcp.ts runs on the owner's Mac and calls the site over
 * HTTP; src/mcp/remote.ts is the server half of the remote route and reaches
 * src/routes.ts's `handleApi`. If the local command ever imported it, a
 * laptop process would load the whole API — its database client, its Stripe
 * client — and the seam "nothing here knows about the server" would be gone.
 *
 * And the other half: remote.ts takes `handleApi` as an argument rather than
 * importing routes.ts, so the two are not a cycle.
 */

import { describe, expect, it } from "vitest";

import { graphFrom } from "./helpers/import-graph.js";

describe("the MCP import graph", () => {
  it("scripts/spideryarn-mcp.ts reaches neither src/routes.ts nor src/mcp/remote.ts", () => {
    const graph = graphFrom("scripts/spideryarn-mcp.ts");
    expect(graph).toContain("src/mcp/server.ts");
    expect(graph).not.toContain("src/routes.ts");
    expect(graph).not.toContain("src/mcp/remote.ts");
  });

  it("src/mcp/remote.ts does not import src/routes.ts", () => {
    expect(graphFrom("src/mcp/remote.ts")).not.toContain("src/routes.ts");
  });
});
