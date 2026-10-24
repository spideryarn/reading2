/**
 * Upload the built extension to the Chrome Web Store and submit it for review,
 * through the store's v2 API, as the publisher's service account.
 *
 *   npm run extension:build
 *   npm run extension:publish              # upload, then submit for review
 *   npm run extension:publish -- --status  # what the store says now, changing nothing
 *   npm run extension:publish -- --upload-only
 *
 * Reviewed updates reach readers by themselves: Chrome checks every few hours
 * (docs/research/261024c-chrome-extension-mv3-store-and-updates.md § Updating).
 *
 * **It refuses rather than guesses** (GPT Sol, 261024q F7): no upload unless
 * the version in extension/manifest.ts is above the one the store has; no
 * submission unless the store says the upload `SUCCEEDED` with exactly that
 * version. Every refusal exits 1 and says why; a missing setting exits 2.
 *
 * **Credentials**, none of them in the repo:
 * - `CWS_SERVICE_ACCOUNT_KEY`: the path to the service account's JSON key,
 *   kept outside the repo, readable by its owner only. Its private key signs a
 *   JWT here, which Google exchanges for a one-hour token scoped to
 *   `chromewebstore` and nothing else. The token is never written down.
 * - `CWS_PUBLISHER_ID`: the publisher's id, from the dashboard's Account page.
 * The item id is `PRODUCTION_EXTENSION_ID` in src/web/extension-handoff.ts,
 * the one place it is spelled. The one-time setup is in
 * docs/project/chrome-extension.md § Publishing.
 */
import { createSign } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { EXTENSION_VERSION } from "../extension/manifest.js";
import { PRODUCTION_EXTENSION_ID } from "../src/web/extension-handoff.js";

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://chromewebstore.googleapis.com";

/** "1.2.10" > "1.2.9": compared as numbers, part by part. */
export function versionAbove(ours: string, theirs: string | undefined): boolean {
  if (theirs === undefined) return true;
  const a = ours.split(".").map(Number);
  const b = theirs.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

interface RevisionStatus {
  state?: string;
  distributionChannels?: { crxVersion?: string }[];
}

export interface ItemStatus {
  publishedItemRevisionStatus?: RevisionStatus;
  submittedItemRevisionStatus?: RevisionStatus;
  lastAsyncUploadState?: string;
  takenDown?: boolean;
}

/** The highest version the store holds, published or submitted. */
export function storeVersion(status: ItemStatus): string | undefined {
  const versions = [status.publishedItemRevisionStatus, status.submittedItemRevisionStatus]
    .flatMap((r) => r?.distributionChannels ?? [])
    .map((c) => c.crxVersion)
    .filter((v): v is string => typeof v === "string");
  return versions.reduce<string | undefined>((top, v) => (versionAbove(v, top) ? v : top), undefined);
}

/** What an upload's answer means. The docs spell "in progress" two ways. */
export function uploadOutcome(
  answer: { uploadState?: string | undefined; crxVersion?: string | undefined },
  version: string,
): "done" | "wait" | { failed: string } {
  const state = answer.uploadState;
  if (state === "IN_PROGRESS" || state === "UPLOAD_IN_PROGRESS") return "wait";
  if (state !== "SUCCEEDED") return { failed: `the store says the upload is ${state ?? "in no state at all"}` };
  if (answer.crxVersion !== version) {
    return { failed: `the store has version ${answer.crxVersion ?? "(none)"}, not ${version}` };
  }
  return "done";
}

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

/** A one-hour access token for `SCOPE`, from the service account's key. */
async function accessToken(keyPath: string): Promise<string> {
  const key = JSON.parse(readFileSync(keyPath, "utf8")) as { client_email?: string; private_key?: string };
  if (!key.client_email || !key.private_key) throw new Error(`${keyPath} is not a service account key`);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google refused the key: ${body.error_description ?? res.status}`);
  return body.access_token;
}

async function call<T>(token: string, method: string, url: string, body?: Buffer): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: new Uint8Array(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  return (text === "" ? {} : JSON.parse(text)) as T;
}

function setting(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. docs/project/chrome-extension.md § Publishing says what it is.`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  if (PRODUCTION_EXTENSION_ID === null) {
    console.error(
      "PRODUCTION_EXTENSION_ID in src/web/extension-handoff.ts is not set: the store item does not exist yet, " +
        "and the first upload is made by hand (docs/project/chrome-extension.md § Publishing).",
    );
    process.exit(2);
  }
  const keyPath = setting("CWS_SERVICE_ACCOUNT_KEY");
  const publisher = setting("CWS_PUBLISHER_ID");
  if (!existsSync(keyPath)) {
    console.error(`CWS_SERVICE_ACCOUNT_KEY names ${keyPath}, which does not exist.`);
    process.exit(2);
  }
  if ((statSync(keyPath).mode & 0o077) !== 0) {
    console.error(`${keyPath} is readable by others; chmod 600 it first.`);
    process.exit(2);
  }
  const item = `publishers/${publisher}/items/${PRODUCTION_EXTENSION_ID}`;
  const token = await accessToken(keyPath);
  const status = () => call<ItemStatus>(token, "GET", `${API}/v2/${item}:fetchStatus`);

  const before = await status();
  const theirs = storeVersion(before);
  console.log(
    `Store: published ${before.publishedItemRevisionStatus?.state ?? "—"}, submitted ${
      before.submittedItemRevisionStatus?.state ?? "—"
    }, highest version ${theirs ?? "none"}${before.takenDown ? ", TAKEN DOWN" : ""}. Ours: ${EXTENSION_VERSION}.`,
  );
  if (process.argv.includes("--status")) return;

  if (!versionAbove(EXTENSION_VERSION, theirs)) {
    console.error(`Refused: ${EXTENSION_VERSION} is not above the store's ${theirs}. Bump EXTENSION_VERSION in extension/manifest.ts.`);
    process.exit(1);
  }
  const zipPath = join(import.meta.dirname, "..", "extension", "dist", `spideryarn-extension-${EXTENSION_VERSION}.zip`);
  if (!existsSync(zipPath)) {
    console.error(`Refused: ${zipPath} is not built. Run npm run extension:build.`);
    process.exit(1);
  }

  let answer = await call<{ uploadState?: string | undefined; crxVersion?: string | undefined }>(
    token,
    "POST",
    `${API}/upload/v2/${item}:upload`,
    readFileSync(zipPath),
  );
  for (let tries = 0; uploadOutcome(answer, EXTENSION_VERSION) === "wait"; tries++) {
    if (tries === 30) {
      console.error("Refused: the upload was still being processed after five minutes. Run again with --status.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 10_000));
    /* `fetchStatus` reports the most recent upload's state but no version for
       an unsubmitted draft, so a `SUCCEEDED` here is taken as this upload's,
       the version already checked above it. */
    const now = await status();
    answer = { uploadState: now.lastAsyncUploadState, crxVersion: EXTENSION_VERSION };
  }
  const outcome = uploadOutcome(answer, EXTENSION_VERSION);
  if (typeof outcome === "object") {
    console.error(`Refused to submit: ${outcome.failed}.`);
    process.exit(1);
  }
  console.log(`Uploaded ${EXTENSION_VERSION}.`);
  if (process.argv.includes("--upload-only")) return;

  await call(token, "POST", `${API}/v2/${item}:publish`);
  const after = await status();
  console.log(`Submitted for review: ${after.submittedItemRevisionStatus?.state ?? "(no state yet)"}.`);
}

function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry).endsWith(join("scripts", "publish-extension.ts"));
}

if (isMain()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
