/**
 * **The extension's `manifest.json`, for each flavour**, as a function rather
 * than a file, so the two flavours cannot drift and
 * tests/extension-handoff.test.ts can say what each one asks Chrome for.
 *
 * - **production**: what goes to the Chrome Web Store. Talks to
 *   `https://www.spideryarn.com` only. No `key`: the store assigns the id.
 * - **dev**: loaded unpacked on a developer's machine or in Playwright. Talks
 *   to the local dev servers too, and carries `DEV_KEY`, a public key whose only
 *   job is to make the unpacked id `DEV_EXTENSION_ID` wherever it is loaded
 *   (the matching private key was never kept: an unpacked load needs none).
 *
 * **What it asks for is the whole permission story** (docs/research/261024c-chrome-extension-mv3-store-and-updates.md):
 * `activeTab` (the tab the button was pressed on, until it navigates away) and
 * `scripting` (to run the capture there). No host permissions, no content
 * scripts, no `tabs`, no `storage`; none of these shows the reader a warning.
 * An update that adds a permission disables the extension until the reader
 * accepts it, so adding one is a decision, not a line.
 */

/** Bumped for every store upload; the store refuses a version it has seen. */
export const EXTENSION_VERSION = "0.1.0";

export const PRODUCTION_ORIGINS = ["https://www.spideryarn.com"] as const;

/** Where `npm run dev` starts (docs/project/setup-dev.md). It walks up when
 *  5273 is taken, so the dev build takes the port it should talk to:
 *  `npm run extension:build -- --dev-origin=http://localhost:5275`. */
export const DEFAULT_DEV_ORIGIN = "http://localhost:5273";

export const DEV_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzy5QPjKAgxWWVTDXxxkPAUNbDEuyNTzzbbYD3tEniWYOHOsPg5KReGe8j0LmjWzfKhPqD/ere1BAn4qCX5R/14+n+emrcUXZdEaKNY9S6CEeR1GQTh1vITRDY2V3hwpuB/B2iCdfQeusU2Nd1ktHNfGz+7aoG7GjCgLem2Dj5VM4F02yHGCCKHoZBKuG/z1AuJ9glmfhSWrBEZz7/3/kJEqzHOhjNhxOj5HeLYTRRuUeQPeBGJDTz+zVa5RP5WfRdKc2uwtg5Av/NfIQkk+MzJxNUpns4F+PFGL2XxHcRDTDP6hd4eAnavGBEd6AJ98pclL2UL6Io6b3vS8jBowZ4wIDAQAB";

/** `DEV_KEY`'s id: the first 32 hex digits of the key's SHA-256, each mapped
 *  0–f → a–p. Held equal by a test, and named in src/web/extension-handoff.ts. */
export const DEV_EXTENSION_ID = "mgaelddegjfaooojhjaijcnkambbcaea";

export type Flavour = "production" | "dev";

/** The origins the worker hands a page to; the first is where the button
 *  sends the reader. `externally_connectable` ignores ports, so the manifest's
 *  `http://localhost/*` lets any local port ask, and this says which one may
 *  take. **The dev build never talks to production**, and production's page
 *  never trusts `DEV_EXTENSION_ID`: `DEV_KEY` is public, so anybody can load an
 *  unpacked extension with that id. */
export function originsFor(flavour: Flavour, devOrigin = DEFAULT_DEV_ORIGIN): readonly string[] {
  return flavour === "production" ? PRODUCTION_ORIGINS : [devOrigin];
}

/** The single purpose, as the store asks for it, and the manifest's description. */
export const DESCRIPTION =
  "Adds the page you are reading to Spideryarn, as your browser shows it, in one click.";

export function manifestFor(flavour: Flavour): Record<string, unknown> {
  const dev = flavour === "dev";
  return {
    manifest_version: 3,
    name: dev ? "Spideryarn (dev)" : "Spideryarn",
    version: EXTENSION_VERSION,
    description: DESCRIPTION,
    icons: { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
    action: {
      default_title: "Add this page to Spideryarn",
      default_icon: { "16": "icons/icon-16.png", "32": "icons/icon-32.png" },
    },
    background: { service_worker: "background.js" },
    permissions: ["activeTab", "scripting"],
    externally_connectable: {
      matches: dev ? ["http://localhost/*"] : ["https://www.spideryarn.com/*"],
    },
    minimum_chrome_version: "116",
    ...(dev ? { key: DEV_KEY } : {}),
  };
}
