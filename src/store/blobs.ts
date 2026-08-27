/**
 * **Where a raw document's bytes live** — the seam, and the two things you may
 * do at it.
 *
 * Step 3 of docs/plans/pdf-upload-and-storage.md § Build order, revised. The
 * shape here is deliberately **two interfaces rather than one**, and that is
 * the review's correction rather than my first draft:
 *
 * > If the filesystem adapter cannot implement `signUpload`, `signUpload` does
 * > not belong on the same interface as `get`/`put` — a health check cannot
 * > repair a shape that lies.
 * >
 * > — GPT Sol, 2026-08-26
 *
 * So `RawSourceStore` is "hold these bytes and give them back", which both
 * adapters do honestly, and `UploadGrants` is "let a browser write straight to
 * the object store", which **only Supabase Storage can do at all**. There is no
 * filesystem grant issuer, not even a token one, because the only way to write
 * one is a URL pointing back at our own server — and that reintroduces the
 * 4.5 MB Vercel body limit under a name saying it does not exist, which is the
 * failure this repo keeps writing up (docs/reusable/silent-success.md).
 *
 * `uploadGrants()` returning `null` is therefore a real answer: *this
 * installation cannot take uploads*. The route says so in a sentence.
 *
 * ## Why selection does not read `SPIDERYARN_STORE`
 *
 * That variable chooses where **articles** are read from (src/store/live.ts),
 * which is a different question with a different answer. Blobs follow the
 * credentials: if this process has a Supabase service key, the bytes go to
 * Supabase, because that is the only place a browser can put them. Otherwise
 * they go under `data/_blobs/`, which is enough for tests and for a laptop with
 * no container running — and cannot mint a grant, so nothing can accidentally
 * depend on it in production.
 */
import { createHash } from "node:crypto";

import type { DocumentKind } from "../fetch.js";
import { canonicalKey } from "../source.js";
import { fsBlobs } from "./blobs-fs.js";
import { supabaseBlobs } from "./blobs-supabase.js";

/** What `head` can say about an object without moving its bytes. */
export interface BlobHead {
  bytes: number;
  contentType: string | null;
}

/**
 * Whether a create-only write actually created anything.
 *
 * A discriminant rather than a boolean or a swallowed 409, because **"it was
 * already there" is the dedup hit** — two readers uploading identical bytes
 * converge on one canonical object — and a caller that cannot tell cannot log
 * it, count it, or notice when it stops happening.
 */
export type PutResult = "stored" | "already-there";

export interface RawSourceStore {
  /**
   * Size and type, or `null` if there is no such object.
   *
   * **`null` means absent and nothing else.** Every other failure throws. The
   * distinction is the one src/store/artifacts-fs.ts already draws and the one
   * Sol asked for by name: a Storage 503 read as "absent" turns a transient
   * outage into "your file never arrived", which is a lie the reader acts on by
   * uploading 11 MB again.
   */
  head(key: string): Promise<BlobHead | null>;
  /**
   * The bytes, or `null` if absent.
   *
   * `maxBytes` is a **refusal, not a truncation**: an object larger than it
   * throws rather than returning a prefix, because a prefix of a PDF is a
   * corrupt PDF that hashes to something plausible.
   */
  get(key: string, options?: { maxBytes?: number; signal?: AbortSignal }): Promise<Uint8Array | null>;
  /**
   * Write only if nothing is there. Never overwrites.
   *
   * The canonical key is the content hash, so an overwrite could only ever be
   * one of two things: the same bytes again, or a lie about what the name
   * means. Create-only makes the second impossible rather than unlikely.
   */
  putIfAbsent(key: string, bytes: Uint8Array, contentType: string): Promise<PutResult>;
  remove(key: string): Promise<void>;
}

/** A path-bound, short-lived write grant for a browser. Supabase only. */
export interface UploadGrants {
  /**
   * **Only ever called with a staging key** — see `stagingKey` in src/source.ts.
   * A canonical key is never writable by a grant, which is what makes the
   * measured "a deleted object re-arms its grant" harmless.
   *
   * **It takes no content type**, and that is a fact about Storage rather than
   * a simplification: a mint accepts no body options at all — a request asking
   * for `{"upsert":true}` was measured coming back `upsert:false` — so the type
   * is enforced by the bucket's own allowlist when the browser PUTs, and a
   * parameter here would be one we quietly dropped.
   */
  sign(key: string): Promise<{ url: string; token: string; expiresAt: string }>;
}

/** The content type an object of this media kind is stored with. */
export const CONTENT_TYPE: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  html: "text/html",
};

/**
 * Why the database and the bucket cannot be chosen independently, in one
 * sentence: **a reference committed in one project points at nothing in the
 * other.**
 *
 * `DATABASE_URL` picks the database and the presence of a service key picks the
 * blob store, and until 2026-08-27 nothing checked they agreed. Once a revision
 * row holds an object key, that is the dangling reference every draft of
 * docs/plans/raw-bytes-in-storage.md has tried to make impossible — arriving
 * with nobody having deleted anything. Put the object in project B, commit the
 * reference in project A, and every correctly-configured reader of A finds
 * nothing. GPT Sol, 2026-08-27.
 *
 * Hosted Supabase writes the project ref into both strings, so this is
 * answerable at boot: the pooler username is `postgres.<ref>` and the API origin
 * is `https://<ref>.supabase.co`. Locally both are loopback and there is no ref
 * to compare, so "both local" is the other way to agree.
 *
 * Returns a sentence naming both halves, or `null` when they match. A sentence
 * rather than a boolean because the whole difficulty of this misconfiguration is
 * that **each half looks right on its own** — a reader who is told only "these
 * disagree" goes and checks the one they were already sure about.
 */
export function projectMismatch(
  databaseUrl: string | undefined,
  supabaseUrl: string | undefined,
): string | null {
  /* Neither configured, or only one: not this check's business. A missing
     service key means the filesystem adapter, which src/store/index.ts refuses
     separately and for a different reason. */
  if (!databaseUrl || !supabaseUrl) return null;

  const db = hostAndRef(databaseUrl, databaseRef);
  const api = hostAndRef(supabaseUrl, (u) => u.hostname.split(".")[0]);
  /* Fail closed on anything that will not parse — the same rule
     `isLocalDatabaseUrl` follows, and for the same reason: "I cannot tell what
     this is" must never come out as "fine". */
  if (!db) return `DATABASE_URL is not a URL, so it cannot be checked against SUPABASE_URL.`;
  if (!api) return `SUPABASE_URL is not a URL, so it cannot be checked against DATABASE_URL.`;

  if (db.local && api.local) {
    /* **"Both are loopback" is not "both are the same stack."** Greg runs the
       previous app's Supabase container beside this one — which is exactly why
       this project moved to a `5436x` port block
       (docs/project/supabase-local.md) — so a `.env.local` naming the old app's
       database and this app's Storage is a real split brain on one machine, and
       comparing hostnames alone calls it fine. GPT Sol, 2026-08-27.

       The port is the only identity a local stack has, so the port is the
       check. tests/store-project-pair.test.ts pins these two numbers against
       supabase/config.toml, so moving the block there fails a test here rather
       than refusing somebody's boot. */
    const wrong = [
      db.port === LOCAL_DB_PORT ? null : `DATABASE_URL is on port ${db.port}, not ${LOCAL_DB_PORT}`,
      api.port === LOCAL_API_PORT ? null : `SUPABASE_URL is on port ${api.port}, not ${LOCAL_API_PORT}`,
    ].filter(Boolean);
    if (!wrong.length) return null;
    return (
      `${wrong.join(", and ")}. Both are loopback, but they are not the same local ` +
      `Supabase stack — see supabase/config.toml for this project's ports.`
    );
  }
  if (db.local !== api.local) {
    const [near, far] = db.local ? ["DATABASE_URL", "SUPABASE_URL"] : ["SUPABASE_URL", "DATABASE_URL"];
    return (
      `${near} is the local container and ${far} is not. An article's row would ` +
      `land in one project and its source document in the other.`
    );
  }
  if (db.ref && api.ref && db.ref === api.ref) return null;
  return (
    `DATABASE_URL is Supabase project "${db.ref ?? "unknown"}" and SUPABASE_URL is ` +
    `project "${api.ref ?? "unknown"}". An article's row would land in one and its ` +
    `source document in the other, so every read of that article would find nothing.`
  );
}

/**
 * This project's local ports, from `supabase/config.toml`.
 *
 * Not the Supabase defaults (54321/54322) on purpose: those belong to the
 * previous app's container, which runs on the same laptop.
 * tests/store-project-pair.test.ts asserts these still match the config file.
 */
const LOCAL_API_PORT = "54361";
const LOCAL_DB_PORT = "54362";

/**
 * The project ref out of a database URL, from **either** place it can be.
 *
 * `docs/project/database.md` lists three hosts and they do not agree on where
 * the ref lives. The pooler puts it in the username — `postgres.<ref>` — and the
 * direct connection uses a plain `postgres` username and puts it in the
 * hostname, `db.<ref>.supabase.co`. Reading only the username refused the
 * direct form as project "unknown", which is a boot-time refusal of a
 * configuration that was fine — worse than the hole this check closes. Found by
 * GPT Sol reviewing the built code, 2026-08-27.
 */
function databaseRef(u: URL): string | undefined {
  const fromUsername = u.username.split(".")[1];
  if (fromUsername) return fromUsername;
  const host = u.hostname.split(".");
  return host[0] === "db" ? host[1] : undefined;
}

/** Parse once, and read the ref out of whichever part of the URL carries it. */
function hostAndRef(
  raw: string,
  ref: (u: URL) => string | undefined,
): { local: boolean; ref: string | undefined; port: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  /* `new URL` for the same reason `isLocalDatabaseUrl` uses it rather than a
     regex: userinfo runs to the LAST `@`, so a pattern match can read a project
     ref out of a password. */
  return { local, ref: local ? undefined : ref(url) || undefined, port: url.port };
}

function configured(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

/** Where the bytes go on this installation. Never null — the filesystem always works. */
export function blobStore(): RawSourceStore {
  const supabase = configured();
  return supabase ? supabaseBlobs(supabase.url, supabase.key) : fsBlobs();
}

/**
 * Who can hand a browser a write grant, or `null` if nobody here can.
 *
 * Null is not an error condition to be papered over. It is the honest answer on
 * a laptop with no Supabase container, and the caller's job is to say so.
 */
export function uploadGrants(): UploadGrants | null {
  const supabase = configured();
  return supabase ? supabaseBlobs(supabase.url, supabase.key) : null;
}

/** What `storeRawSource` had to do to get the right bytes to the right name. */
export type StoreOutcome = "stored" | "already-there";

export interface StoredRawSource {
  sha256: string;
  key: string;
  outcome: StoreOutcome;
}

/**
 * Put a raw document at the name that is its own checksum, and **be sure it is
 * there** rather than assume it.
 *
 * One function because both ways a document arrives — a fetch and an upload —
 * need exactly this, and two copies of it would drift. See
 * docs/plans/raw-bytes-in-storage.md.
 *
 * ## Why `already-there` is not enough on its own
 *
 * `putIfAbsent` is create-only against a content-addressed key, so a dedup hit
 * *looks* like proof that the right bytes are there. It is not. Something can
 * be sitting at a canonical name without anybody having deleted anything:
 *
 * - a **crashed write** — `blobs-fs.ts` opened the canonical name with `wx` and
 *   then wrote the bytes, so a process killed in between left a short file at
 *   the right name (fixed there too, but the record of it can outlive the fix);
 * - a **failed backfill**, which is the case
 *   docs/plans/raw-bytes-in-storage.md § The backfill can put the wrong bytes
 *   under a hash is entirely about;
 * - anybody with the service key.
 *
 * Believing the hit would then record a *verified* reference to bytes we have
 * never read — [silent success](docs/reusable/silent-success.md) with a
 * checksum on it. GPT Sol, 2026-08-27, asked whether "objects are never
 * deleted" removes the need for a state machine: it does, and it does not
 * remove this.
 *
 * ## Why a mismatch is refused rather than repaired
 *
 * The first version repaired: remove the wrong object, put ours. That is worse
 * than doing nothing, and the review of it was right. Two callers who both read
 * the same corruption race each other, and the loser's `remove` can delete the
 * **winner's correct object** after the winner has already returned success and
 * its caller has committed a reference. Crash there and the reference dangles —
 * the exact failure this whole design exists to prevent, introduced by the code
 * meant to prevent it. Repair needs serialisation or a version-conditioned
 * replace, and the blob seam has neither.
 *
 * So a mismatch throws, naming the key. It is loud, it cannot destroy a correct
 * object, and it leaves a human holding a service key to decide. The cost is
 * real and worth stating: an article whose canonical name holds wrong bytes
 * cannot be ingested until somebody clears them. That is rarer than it was —
 * `blobs-fs.ts` no longer publishes a canonical name before the bytes behind it
 * are complete — and a stuck article is a much smaller thing than a silently
 * wrong one. GPT Sol, reviewing the built code, 2026-08-27.
 */
export async function storeRawSource(
  bytes: Uint8Array,
  kind: DocumentKind,
  store: RawSourceStore = blobStore(),
): Promise<StoredRawSource> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = canonicalKey(sha256, kind);

  const first = await store.putIfAbsent(key, bytes, CONTENT_TYPE[kind]);
  /* A successful create needs no read-back: we hashed the buffer we just wrote,
     and no other writer can have been in the middle of the same key — that is
     what create-only means. Only the dedup hit is unproven. */
  if (first === "stored") return { sha256, key, outcome: "stored" };

  const there = await store.get(key, { maxBytes: bytes.byteLength });
  if (there && createHash("sha256").update(there).digest("hex") === sha256) {
    return { sha256, key, outcome: "already-there" };
  }

  /* `maxBytes` above is the length of the document we hold, so an object
     *larger* than ours throws out of `get` rather than returning a prefix —
     and that throw is correct, because an over-long object at this name is
     corruption too. `there` being null means it vanished between the two calls,
     which is the same answer: what is at this name is not what the name says. */
  throw new CorruptObject(key);
}

/**
 * What is at a content-addressed name is not what the name says.
 *
 * Its own class so a caller can tell it from a network failure — one means "try
 * again", the other means "a human has to look". Carries the key, because that
 * is the only thing anybody can act on, and no bytes, because they are somebody
 * else's document.
 */
export class CorruptObject extends Error {
  constructor(readonly key: string) {
    super(
      `The object at ${key} does not hash to its own name, so it is not the document ` +
        "that name promises. Nothing here will overwrite it — removing it races any " +
        "other writer — so it needs clearing by hand. See src/store/blobs.ts.",
    );
    this.name = "CorruptObject";
  }
}
