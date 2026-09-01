# Review: the experimental-features switch, as built

You are reviewing **built code**, not a plan. Be adversarial and concrete. For each finding, name
the file and line, say what input or sequence produces the wrong behaviour, and say what the fix is.
Rank by severity. Say plainly if something is fine.

## What was asked for

Greg asked for a Settings section on `/profile` with a toggle (and explanatory tooltip) for
"Experimental features", default false: off shows the polished features, on also shows ones still
under development. He made three decisions:

1. Store it **in the database, as a real column** on the reader's row — "not in json, I'd prefer to
   use a proper field, perhaps a nullable date-time, where null (default) means false, and we store
   the date when it was set if true". Also: write a `docs/project/sql.md` recording the preference
   for referential integrity and letting the database do the work.
2. **Mechanism only** — nothing is gated behind the switch yet.
3. A hidden feature stays **reachable by URL**; the switch hides controls, it does not enforce.

## Context you need

- Two stores implement one `ReaderStore` contract: a filesystem one (`data/reader.json`, one
  process, writes serialised behind a promise queue) and a Postgres one (`reader_profiles`, one row
  per `owner_id`, several server processes possible). `SPIDERYARN_STORE=postgres` selects the second;
  the filesystem one is local development only.
- `GET /api/reader` is fetched by every article page (for `hasProfile`), and its response is cached
  client-side by `apiFetch`, invalidated on any `PATCH` to the same resource.
- The repo's standing rules: a check that has never failed is not evidence; anything that reports
  success while doing nothing is the bug class to hunt for; a response shape that varies with the
  request is treated as a defect.

## The specific questions

1. **The `coalesce` upsert.** `writeExperimental(true)` uses
   `on conflict do update set experimental_since = coalesce(reader_profiles.experimental_since, now())`
   so re-asserting "on" keeps the first date. Is the schema-qualified column reference correct and
   unambiguous inside `DO UPDATE`? Is there any interleaving of two concurrent requests (on/off/on)
   that leaves the row saying something untrue? Note the insert branch uses `now()` and the update
   branch `coalesce(..., now())`.
2. **The filesystem read-modify-write.** `patchReaderFile` reads the file and writes the merge inside
   a serialised queue, with a temp file and a rename. Is anything about the queue, the merge, or the
   `undefined`-drops-the-key convention wrong? Is there a state where a profile save loses the switch
   or vice versa? (That regression existed for one edit and now has a test.)
3. **The route.** `PATCH /api/reader` now accepts `profile`, `experimental`, or both, and always
   answers `{ profile, experimentalSince }` — reading back the field it did not write. Is the
   validation tight? Is the "read the other field" cheap-and-correct, or is there an ordering or
   error-handling problem? Does anything about the always-both-fields shape break an existing client?
4. **The client hook.** `useExperimental` is optimistic: it sets the date locally, PATCHes, then
   takes the server's value; on failure it restores the previous value and shows the error. There is
   a generation counter for out-of-order responses. Look hard for a sequence (rapid double-toggle,
   failure landing after a success, unmount mid-flight, the cached `GET` being served offline) that
   leaves the visible switch disagreeing with what is stored.
5. **`loaded` gating.** The checkbox is disabled until the GET answers, and a failed GET leaves it
   disabled forever with an error line. Is that the right trade, or is a reader now stuck?
6. **Tests.** Do the tests actually pin the claims, or would a plausible wrong implementation pass
   them? Two of them were confirmed red against the naive implementation (restamping the date;
   clobbering the other field), and the Postgres half of the parity suite skips loudly when the
   database is behind. What is missing?
7. **Anything else that is wrong, dangerous or over-built.** Including: should this have been
   `localStorage`, is one column on `reader_profiles` the right home, and is the doc honest?

## The evidence

The diff of the changed files, then the four new files in full, follow. `+` lines are new.
diff --git a/src/db/schema.ts b/src/db/schema.ts
index 98ec1f7..0269227 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -1949,6 +1949,11 @@ export const glossaryLookups = spideryarn.table(
  * exactly one profile per reader, so there is nothing for a second key to
  * distinguish. `src/store/pg-reader.ts` upserts on it — see
  * src/store/pg-lookups.ts for the same shape used for the same reason.
+ *
+ * **It is the reader's row rather than only their prose**, which is what makes
+ * `experimental_since` below belong here rather than in a settings table of its
+ * own: one nullable column on a row that already exists, against a table, a
+ * foreign key and a join, for one switch. Revisit at three or four settings.
  */
 export const readerProfiles = spideryarn.table("reader_profiles", {
   /** `auth.users(id)`. FK in the custom migration, as with every other `owner_id`. */
@@ -1956,6 +1961,25 @@ export const readerProfiles = spideryarn.table("reader_profiles", {
   /** Absent (no row) and empty are treated the same by src/profile.ts; this
       column is simply `null` for "never written". */
   profile: text("profile"),
+  /**
+   * **Experimental features: null is off, a timestamp is on since then.**
+   *
+   * A nullable `timestamptz` rather than a `boolean not null default false`, at
+   * Greg's direction and for the reason docs/project/sql.md now states
+   * generally: the same storage carries strictly more of the truth. "On" and
+   * "on since Tuesday" are one column; "on" and a second `experimental_set_at`
+   * beside it are two columns that can disagree.
+   *
+   * Nullable also means **no backfill**: every existing row is already off,
+   * because off is what the absence of a date means. A `not null default false`
+   * would have had to write every row to say the same thing.
+   *
+   * `src/store/pg-reader.ts` keeps the *first* date across a re-assertion —
+   * turning it on when it is already on must not move it, or the value answers
+   * "when did the client last send true" instead of "since when".
+   * docs/project/experimental-features.md.
+   */
+  experimentalSince: timestamp("experimental_since", { withTimezone: true }),
   updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
 });
 
diff --git a/src/profile.ts b/src/profile.ts
index 339397e..44eb2a2 100644
--- a/src/profile.ts
+++ b/src/profile.ts
@@ -313,10 +313,25 @@ function serialised<T>(work: () => Promise<T>): Promise<T> {
   return run;
 }
 
-/** What `data/reader.json` holds. One field today, and room for the next. */
+/** What `data/reader.json` holds — the reader's prose, and their settings. */
 interface ReaderFile {
-  /** "About you", as the reader typed it. Absent means they have not written one. */
-  profile?: string;
+  /** "About you", as the reader typed it. Absent means they have not written one.
+
+      `| undefined` spelled out because `exactOptionalPropertyTypes` is on and
+      `patchReaderFile` below *passes* `undefined` to mean "drop this key" —
+      without it, clearing a field would not typecheck. Same as
+      src/converse.ts's `at`. */
+  profile?: string | undefined;
+  /**
+   * When experimental features were switched on, ISO 8601. Absent is off.
+   *
+   * **JSON here, a real `timestamptz` column in Postgres**, and that is not an
+   * inconsistency to tidy away: this store *is* a JSON file, and the rule
+   * docs/project/sql.md states is about the database, which has types to hold
+   * us to. The two halves agree on the fact and on its spelling — null/absent
+   * is off, a date is on since then — which is the part that has to match.
+   */
+  experimentalSince?: string | undefined;
 }
 
 /**
@@ -331,16 +346,107 @@ interface ReaderFile {
  * prompt off without it, with nothing anywhere saying so.
  */
 export async function loadReaderProfile(): Promise<string | null> {
+  return normaliseProfileText((await readReaderFile()).profile);
+}
+
+/**
+ * The whole file, or `{}` when there is not one yet.
+ *
+ * Split out on 2026-08-31, when a second field arrived: every reader and every
+ * writer below has to see **all** of it, and the write in particular. See
+ * `patchReaderFile`.
+ */
+async function readReaderFile(): Promise<ReaderFile> {
   try {
-    const parsed = parseJsonFrom<ReaderFile>(await readFile(fileFor(), "utf8"), "reader.json");
-    return normaliseProfileText(parsed.profile);
+    return parseJsonFrom<ReaderFile>(await readFile(fileFor(), "utf8"), "reader.json");
   } catch (err) {
-    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
+    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
     log("store").error(errorFields(err), "reader.json unreadable");
     throw err;
   }
 }
 
+/**
+ * Change some of the file and keep the rest.
+ *
+ * **Read-modify-write, inside the queue.** The previous writer built its whole
+ * body from its one argument — `next ? { profile: next } : {}` — which was
+ * correct while there was one field and silently deletes the other now there
+ * are two: saving a profile would have switched experimental features off, and
+ * both the save and the switch would have reported success.
+ * docs/reusable/silent-success.md.
+ *
+ * The read has to be **inside** `serialised` for the same reason the write is:
+ * read-then-write outside it is two operations with a gap, and a concurrent
+ * save landing in the gap is lost. This is one process — the Postgres adapter
+ * cannot rely on that, and does not: it upserts the single column instead
+ * (src/store/pg-reader.ts).
+ *
+ * Temp file and a rename, like src/shelf.ts: `rename` is atomic within a
+ * filesystem and `writeFile` over the live path is not.
+ *
+ * A key set to `undefined` is dropped by `JSON.stringify`, so "clear this
+ * field" and "leave the file without it" are the same act, which is what the
+ * absent-means-null contract above wants.
+ *
+ * **The patch is a function of the current contents**, not a fixed object, so
+ * that "switch this on unless it already is" is decided *inside* the queue.
+ * Deciding it outside is a read and a write with a gap between them, and two
+ * on-presses either side of the gap would both mint a date — moving a value
+ * whose entire job is to stay put.
+ */
+async function patchReaderFile(
+  /** What to change, computed from what is there — see the note on the race. */
+  patch: (current: ReaderFile) => Partial<ReaderFile>,
+): Promise<ReaderFile> {
+  return serialised(async () => {
+    const file = fileFor();
+    const current = await readReaderFile();
+    const merged: ReaderFile = { ...current, ...patch(current) };
+    await mkdir(path.dirname(file), { recursive: true });
+    const tmp = `${file}.tmp`;
+    await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
+    await rename(tmp, file);
+    return merged;
+  });
+}
+
+/**
+ * When experimental features were switched on, ISO 8601, or `null` for off —
+ * the filesystem half of `ReaderStore.readExperimental`.
+ *
+ * A stored value that is not a usable date reads as **off** rather than
+ * throwing, which is the opposite of what the profile above does with a broken
+ * file, and deliberately so: the profile is prose the reader wrote and losing
+ * it silently is the hazard, while this is a switch whose safe answer is the
+ * default. `Date.parse` returns `NaN` for anything it cannot read.
+ */
+export async function loadReaderExperimental(): Promise<string | null> {
+  return usableDate((await readReaderFile()).experimentalSince);
+}
+
+/** The stored string if it is a date we could act on, `null` otherwise. */
+function usableDate(raw: unknown): string | null {
+  return typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? raw : null;
+}
+
+/**
+ * Switch experimental features on or off; answer with what is now stored.
+ *
+ * **On when already on keeps the first date.** See
+ * `ReaderStore.writeExperimental` for why — the column answers "since when",
+ * and re-asserting it must not be able to move it. Off clears it, so on-off-on
+ * is a new date and says so.
+ */
+export async function saveReaderExperimental(on: boolean): Promise<string | null> {
+  const after = await patchReaderFile((current) => ({
+    experimentalSince: on
+      ? (usableDate(current.experimentalSince) ?? new Date().toISOString())
+      : undefined,
+  }));
+  return usableDate(after.experimentalSince);
+}
+
 /**
  * Write the global profile, or clear it with `null`.
  *
@@ -351,8 +457,11 @@ export async function loadReaderProfile(): Promise<string | null> {
  * the same argument about the summary steer; both are gone —
  * docs/plans/steer-becomes-the-profile.md.)
  *
- * Temp file and a rename, like src/shelf.ts: `rename` is atomic within a
- * filesystem and `writeFile` over the live path is not.
+ * **It writes one field and leaves the rest of the file alone** — see
+ * `patchReaderFile`, which is where the atomic rename now lives. Until
+ * 2026-08-31 this built the whole body from its own argument, which was right
+ * with one field in the file and would delete the reader's settings now there
+ * are two.
  */
 export async function saveReaderProfile(text: string | null): Promise<string | null> {
   const next = normaliseProfileText(text);
@@ -362,13 +471,8 @@ export async function saveReaderProfile(text: string | null): Promise<string | n
       { status: 400 },
     );
   }
-  return serialised(async () => {
-    const file = fileFor();
-    await mkdir(path.dirname(file), { recursive: true });
-    const body: ReaderFile = next ? { profile: next } : {};
-    const tmp = `${file}.tmp`;
-    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
-    await rename(tmp, file);
-    return next;
-  });
+  // `undefined` rather than `null` for "cleared": the key is dropped, which is
+  // the spelling `loadReaderProfile` reads back as never-written.
+  await patchReaderFile(() => ({ profile: next ?? undefined }));
+  return next;
 }
diff --git a/src/routes.ts b/src/routes.ts
index 10afcee..c0d48e1 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -15,8 +15,10 @@
  *   POST   /api/library/:slug/open   one more open, for the shelf's tooltip
  *   GET    /api/models           which model writes what
  *                                 → { tasks: [{ task, model, id, provider, source, effort? }] }
- *   GET    /api/reader           `?slug=` → { profile, purpose, hasProfile } — purpose is null without a slug
- *   PATCH  /api/reader           { profile: string | null } → the same shape
+ *   GET    /api/reader           `?slug=` → { profile, purpose, hasProfile, experimentalSince }
+ *                                 — purpose is null without a slug
+ *   PATCH  /api/reader           { profile?: string | null, experimental?: boolean }
+ *                                 → { profile, experimentalSince }, both always
  *   GET    /api/article/:slug    meta + blocks + tree, one payload
  *   GET    /api/source/:slug     the PDF an article was made from, for a reader to check it
  *   GET    /api/metadata/:slug   what the pipeline wrote, and whether any of it is stale
@@ -2869,6 +2871,21 @@ async function resolveProfileParts(slug: string): Promise<ProfileParts> {
   return { profile, purpose: shelf.purpose ?? null, purposeFailed };
 }
 
+/**
+ * What `PATCH /api/reader` answers with — everything about the reader that this
+ * route can change, whichever of it the request actually changed.
+ *
+ * Not in src/types.ts, and not shared with the client: `useProfile` and the
+ * settings hook each read the one field they are about, and a shared interface
+ * would invite a component to take a dependency on the *other* one.
+ */
+interface ReaderState {
+  /** "About you", as stored — normalised, `null` for never-written. */
+  profile: string | null;
+  /** When experimental features were switched on, ISO 8601, or `null` for off. */
+  experimentalSince: string | null;
+}
+
 /**
  * The reader's global profile — "about you", the half that is true on every
  * article.
@@ -2879,9 +2896,20 @@ async function resolveProfileParts(slug: string): Promise<ProfileParts> {
  * prompt string by `renderProfile` in src/profile.ts — which is the only place
  * that knows there were two.
  *
- * `profile: null` clears it. Absent is a 400 rather than a no-op: this body has
- * exactly one field, so a request without it is a request that meant something
- * else, and answering 200 to it would report a save that did not happen.
+ * `profile: null` clears it. A body naming **neither** field is a 400 rather
+ * than a no-op: a request that changes nothing is a request that meant
+ * something else, and answering 200 to it would report a save that did not
+ * happen.
+ *
+ * **The reply carries both fields whichever one you sent**, and that is the
+ * rule this route grew on 2026-08-31 rather than an accident of it. A shape
+ * that varies with the request is the one a client reads as "the other field is
+ * unset" — the same argument the `purpose` field on the GET above makes at
+ * length. The cost is one store read for the field you did not change.
+ *
+ * `experimental` is a **boolean on the wire and a date in the store**: the
+ * client says on or off, and what comes back is when it was switched on.
+ * docs/project/experimental-features.md.
  *
  * The **cap is enforced in the store, not here**. That is deliberate: this is
  * stored, so the rule has to hold for every writer rather than for this one
@@ -2890,17 +2918,39 @@ async function resolveProfileParts(slug: string): Promise<ProfileParts> {
  * gone: docs/plans/steer-becomes-the-profile.md.) src/profile.ts § saveReaderProfile throws with `status: 400`, which
  * `httpErrorFrom` below turns into the same answer this would have given.
  */
-async function patchReader(body: unknown): Promise<{ profile: string | null }> {
+async function patchReader(body: unknown): Promise<ReaderState> {
   if (typeof body !== "object" || body === null || Array.isArray(body)) {
     throw httpError(400, "Expected a JSON object");
   }
   const patch = body as Record<string, unknown>;
-  if (!("profile" in patch)) throw httpError(400, "Nothing to change: expected profile");
+  const wantsProfile = "profile" in patch;
+  const wantsExperimental = "experimental" in patch;
+  if (!wantsProfile && !wantsExperimental) {
+    throw httpError(400, "Nothing to change: expected profile or experimental");
+  }
   const profile = patch.profile;
-  if (profile !== null && typeof profile !== "string") {
+  if (wantsProfile && profile !== null && typeof profile !== "string") {
     throw httpError(400, "profile must be a string or null");
   }
-  return { profile: await readerStore.writeProfile(profile) };
+  const experimental = patch.experimental;
+  /* Strictly a boolean. Not truthiness: `"false"` and `0` are exactly the
+     values a client sends by mistake, and truthiness answers both of them
+     confidently and one of them backwards. */
+  if (wantsExperimental && typeof experimental !== "boolean") {
+    throw httpError(400, "experimental must be true or false");
+  }
+  /* Sequential rather than `Promise.all`, and only because the filesystem store
+     serialises its writes behind one queue anyway — two of them in flight would
+     queue, not overlap. The Postgres store touches one column per statement, so
+     neither order can lose the other's write. */
+  return {
+    profile: wantsProfile
+      ? await readerStore.writeProfile(profile as string | null)
+      : await readerStore.readProfile(),
+    experimentalSince: wantsExperimental
+      ? await readerStore.writeExperimental(experimental as boolean)
+      : await readerStore.readExperimental(),
+  };
 }
 
 /**
@@ -3631,6 +3681,13 @@ export async function serveAuthenticatedApi(
         at && isSlug(at)
           ? await resolveProfileParts(at)
           : { profile: await readerStore.readProfile(), purpose: null, purposeFailed: false };
+      /* **On every answer, with or without a slug**, because the switch is a
+         property of the reader and this is the reader's route. It costs one
+         extra row read on a route the article pages already fetch for
+         `hasProfile`, which is the trade that keeps the client from needing a
+         second endpoint — and a second endpoint is how two answers to "is it
+         on" come to disagree. docs/project/experimental-features.md. */
+      const experimentalSince = await readerStore.readExperimental();
       /* Asked of the *rendered* pair rather than of `parts.profile`, which is
          what makes a reader who has written only "why you're reading this one"
          count — the case this whole `?slug=` exists for. */
@@ -3646,6 +3703,11 @@ export async function serveAuthenticatedApi(
         purpose: normaliseProfileText(parts.purpose),
         purposeFailed: parts.purposeFailed,
         hasProfile: renderProfile(parts) !== null,
+        /* **The date, not a boolean beside it.** The client derives "on" from
+           this being non-null. Sending both would be two spellings of one fact,
+           free to disagree — and the one that disagreed would be the one a
+           feature gate read. */
+        experimentalSince,
       });
       return;
     }
diff --git a/src/store/contracts.ts b/src/store/contracts.ts
index 4416758..bca5415 100644
--- a/src/store/contracts.ts
+++ b/src/store/contracts.ts
@@ -693,6 +693,10 @@ export interface GlossaryLookupStore {
  * `loadReaderProfile` / `saveReaderProfile` in src/profile.ts, which already
  * does the normalising, capping and atomic write; the Postgres adapter is
  * `reader_profiles`, one row per `owner_id`.
+ *
+ * **It holds the reader's settings too**, since 2026-08-31 — the switch below
+ * is on the same row rather than in a store of its own, for the reason
+ * src/db/schema.ts gives beside the column.
  */
 export interface ReaderStore {
   /** `null` when the reader has not written one yet — not a fault. */
@@ -706,6 +710,27 @@ export interface ReaderStore {
    * **Refused, not truncated**, past `MAX_PROFILE_CHARS` — see src/profile.ts.
    */
   writeProfile(text: string | null): Promise<string | null>;
+
+  /**
+   * **Experimental features: when they were switched on, or `null` for off.**
+   *
+   * An ISO 8601 string rather than a `Date`, because that is what crosses the
+   * wire and what the filesystem store holds; a `Date` here would mean one
+   * adapter parsing what the other stringifies for no reader's benefit.
+   * docs/project/experimental-features.md.
+   */
+  readExperimental(): Promise<string | null>;
+
+  /**
+   * Switch experimental features on or off, and answer with what is now stored.
+   *
+   * **`true` twice does not move the date.** An already-on switch keeps the
+   * date it has, so the value answers *since when* rather than *when did the
+   * client last send true* — which is the whole reason this is a timestamp and
+   * not a boolean. `false` clears it outright, so on-off-on is honestly a new
+   * date: the first spell ended.
+   */
+  writeExperimental(on: boolean): Promise<string | null>;
 }
 
 /**
diff --git a/src/store/fs.ts b/src/store/fs.ts
index c0e47fd..245ffab 100644
--- a/src/store/fs.ts
+++ b/src/store/fs.ts
@@ -54,7 +54,12 @@ import {
 import { loadLookups, saveLookup } from "../glossary-lookups.js";
 import { searchLibrary } from "../library-search.js";
 import { log } from "../log.js";
-import { loadReaderProfile, saveReaderProfile } from "../profile.js";
+import {
+  loadReaderExperimental,
+  loadReaderProfile,
+  saveReaderExperimental,
+  saveReaderProfile,
+} from "../profile.js";
 import {
   beginRun,
   currentSourceHash,
@@ -411,11 +416,13 @@ export const fsGlossaryLookupStore: GlossaryLookupStore = {
 };
 
 /**
- * The reader's global profile, on `data/reader.json`. Two functions, no
- * adaptation — src/profile.ts already does the normalising, capping and
- * atomic write, so there is nothing for this file to add.
+ * The reader's global profile and settings, on `data/reader.json`. Four
+ * functions, no adaptation — src/profile.ts already does the normalising,
+ * capping and atomic write, so there is nothing for this file to add.
  */
 export const fsReaderStore: ReaderStore = {
   readProfile: loadReaderProfile,
   writeProfile: saveReaderProfile,
+  readExperimental: loadReaderExperimental,
+  writeExperimental: saveReaderExperimental,
 };
diff --git a/src/store/pg-reader.ts b/src/store/pg-reader.ts
index 03e3627..c1899e4 100644
--- a/src/store/pg-reader.ts
+++ b/src/store/pg-reader.ts
@@ -1,5 +1,5 @@
 /**
- * The reader's global profile — the Postgres half. src/store/fs.ts's
+ * The reader's global profile **and their settings** — the Postgres half. src/store/fs.ts's
  * `fsReaderStore` (a thin wrap of src/profile.ts) is the other.
  *
  * One row per `owner_id`, upserted rather than read-modify-written, for the
@@ -10,6 +10,11 @@
  * a single scalar, so the upsert is simply the whole fix rather than half of
  * one.
  *
+ * That still holds now the row carries two things: **each write names one
+ * column** and leaves the other where it was, so a profile save and a settings
+ * change cannot overwrite each other. The filesystem half has to merge by hand
+ * to get the same property — src/profile.ts § `patchReaderFile`.
+ *
  * **Never logged**, and for the same reason as the per-article half: this
  * string is the reader's own description of themselves. See
  * docs/project/logging.md.
@@ -60,4 +65,53 @@ export const pgReaderStore: ReaderStore = {
       });
     return next;
   },
+
+  async readExperimental(): Promise<string | null> {
+    const [row] = await getDb()
+      .select({ since: readerProfiles.experimentalSince })
+      .from(readerProfiles)
+      .where(eq(readerProfiles.ownerId, currentOwnerId()))
+      .limit(1);
+    // ISO on the way out, because that is what the contract says and what
+    // crosses the wire. Drizzle hands back a `Date` for a `timestamptz`, and a
+    // `Date` reaching `JSON.stringify` would produce the same string by
+    // accident rather than by decision — and a different one the day a caller
+    // formats it first.
+    return row?.since ? row.since.toISOString() : null;
+  },
+
+  async writeExperimental(on: boolean): Promise<string | null> {
+    const ownerId = currentOwnerId();
+    const [row] = await getDb()
+      .insert(readerProfiles)
+      /* `now()` rather than a `Date` from this process, so both branches of
+         the upsert read the same clock — the database's. A server whose clock
+         has drifted would otherwise stamp a date the `coalesce` below could
+         never have produced. */
+      .values({ ownerId, experimentalSince: on ? sql`now()` : null })
+      .onConflictDoUpdate({
+        target: readerProfiles.ownerId,
+        set: {
+          /* **`coalesce` is what keeps the first date.** Switching on something
+             already on must not move it — the column answers *since when*. In a
+             `DO UPDATE`, an unqualified column name means the existing row, so
+             this reads the value that is there and only `now()` when there is
+             none. Doing the same with a read, a comparison and a write would be
+             two statements with a gap, and two tabs either side of the gap
+             would both mint a date.
+
+             Off is `null` outright rather than coalesced, so on-off-on is a new
+             date. That is the honest answer: the first spell ended. */
+          experimentalSince: on
+            ? sql`coalesce(${readerProfiles.experimentalSince}, now())`
+            : sql`null`,
+          updatedAt: sql`now()`,
+        },
+      })
+      // The row as it now is, rather than what we asked for — the `coalesce`
+      // above means those are different values whenever the switch was already
+      // on, and the caller is told what is stored.
+      .returning({ since: readerProfiles.experimentalSince });
+    return row?.since ? row.since.toISOString() : null;
+  },
 };
diff --git a/src/web/ProfilePage.tsx b/src/web/ProfilePage.tsx
index 48e136a..2bd7cc3 100644
--- a/src/web/ProfilePage.tsx
+++ b/src/web/ProfilePage.tsx
@@ -29,6 +29,12 @@
  * may not import a server module), and the recent list is `GET /api/library`,
  * which the shelf already fetches.
  *
+ * **Settings arrived on 2026-08-31**, and they are a different kind of thing
+ * from the rest of this page: the profile box says what the model is told, and
+ * a setting says what the app does. One switch so far — experimental features,
+ * off by default — in SettingsSection.tsx, with
+ * docs/project/experimental-features.md behind it.
+ *
  * Not here, and each was considered rather than forgotten: **expertise
  * sliders** (the original's beginner/intermediate/expert axis, rejected twice
  * in this repo — the free-text box above *is* the single global setting its own
@@ -38,7 +44,7 @@
  * the original's homepage did not have either. This is a reading tool.
  */
 import { useEffect, useState } from "react";
-import { ArrowLeft, BookOpen, Cpu, TriangleAlert, User, UserCheck } from "lucide-react";
+import { ArrowLeft, BookOpen, Cpu, SlidersHorizontal, TriangleAlert, User, UserCheck } from "lucide-react";
 import { MAX_PROFILE_CHARS, type LibraryEntry } from "../types.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { Link } from "./Link.js";
@@ -46,6 +52,7 @@ import { pageTitle, useDocumentTitle } from "./page-title.js";
 import { readHref } from "./router.js";
 import { AccountSection } from "./AccountSection.js";
 import { ProfileBox } from "./ProfileBox.js";
+import { SettingsSection } from "./SettingsSection.js";
 import { useProfile } from "./useProfile.js";
 import { useSlow } from "./useSlow.js";
 
@@ -191,8 +198,11 @@ export function ProfilePage() {
       </Link>
 
       <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">Profile</h1>
+      {/* Two halves now, and the sentence says both: what the model is told,
+          and what you have switched on. It used to name only the first, which
+          was the whole page until Settings landed. */}
       <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
-        What the model knows about who it is writing for.
+        What the model knows about who it is writing for, and what you have switched on.
       </p>
 
       {/* ---------------------------------------------------------- account -- */}
@@ -241,6 +251,18 @@ export function ProfilePage() {
         </div>
       </Section>
 
+      {/* --------------------------------------------------------- settings -- */}
+      {/* **Below "about you", above everything that is only a read-out.** The
+          two boxes above are what the model is told; this is what the app does.
+          Both are things the reader sets, so they belong together and ahead of
+          "recently read" and "what's running", neither of which is a control.
+          docs/project/experimental-features.md. */}
+      <Section icon={SlidersHorizontal} label="Settings">
+        <div className={`${CARD} tw:p-4`}>
+          <SettingsSection />
+        </div>
+      </Section>
+
       {/* ---------------------------------------------------- recently read -- */}
       <Section icon={BookOpen} label="Recently read">
         <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
diff --git a/tests/profile-shelf-failure.test.tsx b/tests/profile-shelf-failure.test.tsx
index 11d8e4e..62ca502 100644
--- a/tests/profile-shelf-failure.test.tsx
+++ b/tests/profile-shelf-failure.test.tsx
@@ -82,6 +82,11 @@ async function settle(): Promise<void> {
 beforeEach(() => {
   answers.clear();
   answers.set("/api/models", () => Promise.resolve({ tasks: [] }));
+  /* The Settings card asks who is reading, for the experimental switch. Posed
+     rather than mocked away: this page has three fetches now, and a test that
+     silently answered only two would report a `readJson` throw as an ordinary
+     card state. docs/project/experimental-features.md. */
+  answers.set("/api/reader", () => Promise.resolve({ experimentalSince: null }));
   host = document.createElement("div");
   document.body.append(host);
   root = createRoot(host);
diff --git a/tests/routes.test.ts b/tests/routes.test.ts
index b9bbebb..40a8f38 100644
--- a/tests/routes.test.ts
+++ b/tests/routes.test.ts
@@ -379,32 +379,52 @@ describe("the reader routes", () => {
        the panel would then read "no purpose written" off a question nobody
        asked. There is no slug here, so there is no article to have one.
        docs/plans/profile-panel.md. */
-    expect(r.body).toEqual({ profile: null, purpose: null, purposeFailed: false, hasProfile: false });
+    expect(r.body).toEqual({
+      profile: null,
+      purpose: null,
+      purposeFailed: false,
+      hasProfile: false,
+      /* **Present and null, like `purpose`.** Off is the absence of a date, and
+         a field that is simply missing when the switch is off is the one a
+         boundary drops — leaving a client to read "not sent" as "off" by luck
+         rather than by contract. docs/project/experimental-features.md. */
+      experimentalSince: null,
+    });
   });
 
   it("stores a profile and reads it back", async () => {
     const w = await call("PATCH", "/api/reader", { profile: "  A physicist.  " });
     expect(w.status).toBe(200);
     // Normalised on the way in, so the value stored is the value hashed.
-    expect(w.body).toEqual({ profile: "A physicist." });
+    /* **Both fields, whichever one the body changed.** A reply whose shape
+       follows the request is one a client reads as "the other thing is unset".
+       `routes.ts` § patchReader. */
+    expect(w.body).toEqual({ profile: "A physicist.", experimentalSince: null });
     expect((await call("GET", "/api/reader")).body).toEqual({
       profile: "A physicist.",
       purpose: null,
       purposeFailed: false,
       hasProfile: true,
+      experimentalSince: null,
     });
   });
 
   it("treats null and blank as clearing it", async () => {
     await call("PATCH", "/api/reader", { profile: "A physicist." });
-    expect((await call("PATCH", "/api/reader", { profile: null })).body).toEqual({ profile: null });
+    expect((await call("PATCH", "/api/reader", { profile: null })).body).toEqual({
+      profile: null,
+      experimentalSince: null,
+    });
     await call("PATCH", "/api/reader", { profile: "A physicist." });
-    expect((await call("PATCH", "/api/reader", { profile: "   " })).body).toEqual({ profile: null });
+    expect((await call("PATCH", "/api/reader", { profile: "   " })).body).toEqual({
+      profile: null,
+      experimentalSince: null,
+    });
   });
 
-  it("refuses a body with no profile in it, rather than answering 200", async () => {
-    /* This body has exactly one field, so a request without it meant something
-       else — and a 200 would report a save that did not happen. */
+  it("refuses a body that changes nothing, rather than answering 200", async () => {
+    /* A request naming neither field meant something else — and a 200 would
+       report a save that did not happen. */
     const r = await call("PATCH", "/api/reader", {});
     expect(r.status).toBe(400);
     expect(r.body.error).toMatch(/Nothing to change/);
@@ -427,6 +447,7 @@ describe("the reader routes", () => {
         purpose: null,
         purposeFailed: false,
         hasProfile: false,
+        experimentalSince: null,
       });
       /* …and the article still has one. `purpose` comes back as the reader's
          own words rather than as a flag, because the panel prints each box
@@ -439,12 +460,87 @@ describe("the reader routes", () => {
         purpose: "the evidence",
         purposeFailed: false,
         hasProfile: true,
+        experimentalSince: null,
       });
     } finally {
       await rm(DIR, { recursive: true, force: true });
     }
   });
 
+  /* -------------------------------------------- the experimental switch -- */
+
+  it("is off until it is switched on, and says when it was", async () => {
+    const on = await call("PATCH", "/api/reader", { experimental: true });
+    expect(on.status).toBe(200);
+    const since = (on.body as unknown as { experimentalSince: string | null }).experimentalSince;
+    /* A date, not `true`. The column stores when, so the wire carries when —
+       one fact, one spelling, and no boolean beside it to drift out of step.
+       docs/project/experimental-features.md. */
+    expect(since).toBeTypeOf("string");
+    expect(Number.isNaN(Date.parse(since as string))).toBe(false);
+
+    const read = await call("GET", "/api/reader");
+    expect((read.body as unknown as { experimentalSince: string | null }).experimentalSince).toBe(
+      since,
+    );
+  });
+
+  it("does not move the date when it is switched on twice", async () => {
+    /* **The value answers *since when*.** Re-asserting a switch that is already
+       on — a second tab, a double click, a retried request — must not restamp
+       it, or the date silently means "when did the client last send true" and
+       the one question it exists to answer has no answer. */
+    const first = await call("PATCH", "/api/reader", { experimental: true });
+    const since = (first.body as unknown as { experimentalSince: string }).experimentalSince;
+    const again = await call("PATCH", "/api/reader", { experimental: true });
+    expect((again.body as unknown as { experimentalSince: string }).experimentalSince).toBe(since);
+  });
+
+  it("clears the date when it is switched off", async () => {
+    await call("PATCH", "/api/reader", { experimental: true });
+    expect((await call("PATCH", "/api/reader", { experimental: false })).body).toEqual({
+      profile: null,
+      experimentalSince: null,
+    });
+    expect(
+      (await call("GET", "/api/reader")).body as unknown as { experimentalSince: null },
+    ).toMatchObject({ experimentalSince: null });
+  });
+
+  it("keeps the profile and the switch out of each other's way", async () => {
+    /* The regression this pins is a real one that was live for the length of
+       one edit: the filesystem writer built the whole file from its single
+       argument, so saving a profile deleted the switch — and both writes
+       reported success. src/profile.ts § patchReaderFile. */
+    await call("PATCH", "/api/reader", { experimental: true });
+    await call("PATCH", "/api/reader", { profile: "A physicist." });
+    const body = (await call("GET", "/api/reader")).body as unknown as {
+      profile: string | null;
+      experimentalSince: string | null;
+    };
+    expect(body.profile).toBe("A physicist.");
+    expect(body.experimentalSince).toBeTypeOf("string");
+
+    // …and the other way round: changing the switch must not touch the prose.
+    await call("PATCH", "/api/reader", { experimental: false });
+    expect(
+      ((await call("GET", "/api/reader")).body as unknown as { profile: string | null }).profile,
+    ).toBe("A physicist.");
+  });
+
+  it("refuses anything but a boolean for the switch", async () => {
+    /* `"false"` and `0` are exactly what a client sends by mistake, and
+       truthiness would answer both confidently and one of them backwards. */
+    for (const bad of ["true", 1, 0, null]) {
+      expect((await call("PATCH", "/api/reader", { experimental: bad })).status, `${bad}`).toBe(400);
+    }
+    // Nothing was stored on the way past.
+    expect(
+      ((await call("GET", "/api/reader")).body as unknown as { experimentalSince: string | null })
+        .experimentalSince,
+    ).toBeNull();
+  });
+
   it("refuses a profile that is not a string or null", async () => {
     expect((await call("PATCH", "/api/reader", { profile: 42 })).status).toBe(400);
     expect((await call("PATCH", "/api/reader", '"hello"')).status).toBe(400);
@@ -458,6 +554,7 @@ describe("the reader routes", () => {
       purpose: null,
       purposeFailed: false,
       hasProfile: false,
+      experimentalSince: null,
     });
   });
 
@@ -489,6 +586,7 @@ describe("the reader routes", () => {
         purpose: null,
         purposeFailed: false,
         hasProfile: false,
+        experimentalSince: null,
       });
     } finally {
       await rm(DIR, { recursive: true, force: true });
@@ -513,6 +611,7 @@ describe("the reader routes", () => {
         purpose: "the evidence",
         purposeFailed: false,
         hasProfile: true,
+        experimentalSince: null,
       });
     } finally {
       await rm(DIR, { recursive: true, force: true });
/**
 * **The experimental-features switch**, fetched and saved.
 *
 * One boolean for the whole client: with it off, the reader sees the features
 * we think are worth their attention; with it on, they also see the ones still
 * being built. docs/project/experimental-features.md is the operating manual —
 * what belongs behind it, and the rule that a hidden feature stays reachable by
 * its URL.
 *
 * ## It rides on `/api/reader`, which is already fetched
 *
 * The switch lives on the reader's row (`reader_profiles.experimental_since`),
 * so it comes back with the profile rather than from an endpoint of its own —
 * and `useHasProfile` already fetches that route on every article page, so a
 * gate that asks this question costs a request the client was making anyway.
 * `apiFetch` caches `/api/reader` and invalidates it on a `PATCH`, so the
 * answer after a toggle is the stored one and not a stale copy (lib/api.ts).
 *
 * ## A date in, a boolean out
 *
 * The wire carries `experimentalSince` — `null` for off, an ISO timestamp for
 * "on since then" — and this is the only place that turns it into the `on` that
 * gating code reads. The server never sends both, deliberately: a boolean
 * beside the date would be two spellings of one fact, and the one that drifted
 * would be the one a feature gate believed.
 *
 * ## Off while we do not know
 *
 * `on` is `false` until the answer arrives, on the same reasoning
 * `useHasProfile` gives: a control that appears and then vanishes reads as
 * breakage, while one that appears a moment late reads as a slow connection.
 * The switch itself is `disabled` until `loaded`, so nobody can toggle a value
 * we have not read — which would otherwise send "off" for a reader who is on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, readJson } from "./lib/api.js";

/** The shape of `/api/reader`'s answer that this hook cares about. */
interface ReaderSettings {
  experimentalSince: string | null;
}

export interface ExperimentalSetting {
  /**
   * **Are experimental features on?** This is the value a feature gate reads:
   *
   * ```tsx
   * const { on } = useExperimental();
   * if (!on) return null;
   * ```
   */
  on: boolean;
  /** Since when, ISO 8601 — `null` when off, and when we have not asked yet. */
  since: string | null;
  /** Whether the server has answered. Nothing may be toggled before it has. */
  loaded: boolean;
  /** Turn it on or off. Optimistic, and reverted if the save fails. */
  set(next: boolean): void;
  saving: boolean;
  /**
   * Whether the last save failed, and with what.
   *
   * The same hazard `useProfile` names: a switch that springs back to where it
   * was, with no word about why, is one the reader flips again — and a switch
   * that *stays* where they put it while the server never heard is worse.
   * docs/reusable/silent-success.md.
   */
  error: string | null;
}

export function useExperimental(): ExperimentalSetting {
  const [since, setSince] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch("/api/reader")
      .then((r) => readJson<ReaderSettings>(r))
      .then((body) => {
        if (!live) return;
        setSince(body.experimentalSince ?? null);
        setLoaded(true);
      })
      /* Not `setLoaded(true)`: a fetch that failed has told us nothing, and
         enabling the switch on the strength of it would let the reader turn
         "off" back on top of an "on" we never read. They are told, and a reload
         is the way out. */
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  /* Which save is the newest, so an earlier one landing late cannot write its
     stale answer over it. Two quick flips is the ordinary way to produce that,
     and it is the same guard `useProfile` carries for the same reason. */
  const generation = useRef(0);

  const set = useCallback((next: boolean) => {
    const mine = ++generation.current;
    /* **Optimistic**, and the switch moves under the finger. The alternative —
       wait for the round trip — makes a one-bit control feel broken on a slow
       connection, and there is a real value to put back if it fails.

       The optimistic value for "on" is a *guess* at the date. It is replaced by
       the server's answer below, which is the one that says when the switch was
       actually first flipped; nothing reads the date except the line under the
       switch, so a wrong one for one round trip costs nothing. */
    const optimistic = next ? new Date().toISOString() : null;
    const before = since;
    setSince(optimistic);
    setSaving(true);
    setError(null);

    apiFetch("/api/reader", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experimental: next }),
    })
      .then((r) => readJson<ReaderSettings>(r))
      .then((body) => {
        if (mine !== generation.current) return;
        // The stored value, not the guess — see above.
        setSince(body.experimentalSince ?? null);
      })
      .catch((e: Error) => {
        if (mine !== generation.current) return;
        /* **Put it back.** A switch left showing what the reader asked for,
           when the server never got it, is the whole hazard: every gated
           feature then disagrees with the switch that claims to control them. */
        setSince(before);
        setError(e.message);
      })
      .finally(() => {
        if (mine === generation.current) setSaving(false);
      });
  }, [since]);

  return { on: since !== null, since, loaded, set, saving, error };
}
/**
 * **Settings** — the part of `/profile` that changes what the app does, rather
 * than what the model knows.
 *
 * One switch today: experimental features, off by default. Greg, 2026-08-31:
 *
 * > when this is off, it shows just the features that are most valuable/polished
 * > (which is what we want for most users). When on, it includes extra features
 * > that might be still under development or not ready for production.
 *
 * What may go behind it, and the rule that a hidden feature stays reachable by
 * its own URL, are in docs/project/experimental-features.md. **Nothing is
 * behind it yet**, deliberately: the switch and the decision about which
 * features are not ready are two separate pieces of work, and doing them in one
 * move means neither gets argued properly.
 *
 * ## A checkbox, and the tooltip beside it rather than around it
 *
 * A checkbox in a `<label>` is what every other boolean in this app is
 * (AccessSharing.tsx, WrittenForYou.tsx, SearchPanel.tsx), and a settings page
 * is the last place to invent a second kind. The tooltip's trigger sits
 * *outside* the label for the reason WrittenForYou.tsx gives: a `<label>` turns
 * every click inside it into a toggle, so an info icon within one is a control
 * that flips the switch when a touch reader taps it to read the explanation.
 */
import { FlaskConical, Info, TriangleAlert } from "lucide-react";

import { ControlTip, Tooltip } from "./Tooltip.js";
import { timeAgo } from "./relative-time.js";
import { useExperimental } from "./useExperimental.js";

/**
 * The two sentences the tooltip exists for.
 *
 * The second is the one a reader cannot work out by pressing it — the rule
 * Tooltip.tsx § `ControlTip` states: what it does they could guess, what it
 * does *not* promise they could not. Here that is the honest warning, which is
 * the whole point of the switch: these are unfinished, and they may be slow,
 * wrong or gone next week.
 */
const WHAT =
  "Show features that are still being built, alongside the ones we think are ready. Off by default.";
const HOW =
  "Nothing here is finished: an experimental feature can be slow, get things wrong, or disappear in the next release. Turning this off hides them from the controls — it never deletes anything, and a link you already have goes on working.";

export function SettingsSection() {
  const experimental = useExperimental();
  /* Read once per render rather than per call: two lines derived from one
     timestamp should not be able to straddle a tick of the clock. */
  const since = timeAgo(experimental.since ?? undefined, Date.now());

  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      <div className="tw:flex tw:items-center tw:gap-2">
        <label className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-foreground">
          <input
            type="checkbox"
            checked={experimental.on}
            /* **Until the server has answered, there is nothing to toggle.** An
               enabled switch drawn from a default would let the reader send
               "off" over an "on" we had not read yet — a setting silently
               reset by looking at the page it lives on. */
            disabled={!experimental.loaded}
            onChange={(e) => experimental.set(e.target.checked)}
          />
          <FlaskConical size={13} className="tw:text-ink-faint" />
          <span>Experimental features</span>
        </label>
        <Tooltip
          placement="top"
          content={<ControlTip head="Experimental features" what={WHAT} how={HOW} />}
        >
          {/* A button rather than a bare icon: a tooltip nobody can reach with
              the keyboard is a tooltip half the readers do not have. `Tooltip`
              opens on focus as well as hover. */}
          <button
            type="button"
            className="tw:inline-flex tw:items-center tw:text-ink-faint tw:hover:text-foreground"
            aria-label="What experimental features are"
          >
            <Info size={13} />
          </button>
        </Tooltip>
      </div>

      <p className="tw:m-0 tw:text-xs tw:text-ink-faint" aria-live="polite">
        {experimental.error ? (
          /* Said out loud, and the switch has already sprung back to where it
             was — see `useExperimental`. A control that keeps the position the
             reader put it in while the server never heard is the failure this
             line exists to prevent. */
          <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
            <TriangleAlert size={12} /> Not saved — {experimental.error}
          </span>
        ) : experimental.saving ? (
          "Saving…"
        ) : !experimental.loaded ? (
          "Loading…"
        ) : experimental.on ? (
          /* When, because the column stores when — and "on since June" is the
             line that answers "have I been looking at half-built things all
             this time without realising". */
          `On${since ? ` — since ${since}` : ""}. Unfinished features are shown alongside the rest.`
        ) : (
          "Off. You are seeing the features we think are ready."
        )}
      </p>
    </div>
  );
}
/**
 * **The two reader stores, asked the same questions about the switch.**
 *
 * `ReaderStore.readExperimental` / `writeExperimental` are two genuinely
 * different implementations of one promise, and the promise is subtle enough
 * that prose alone will not hold it:
 *
 *  - **on twice must not move the date.** Postgres does it with
 *    `coalesce(experimental_since, now())` inside `on conflict do update`; the
 *    filesystem does it by deciding inside its own write queue. No shared code,
 *    so the test has to be the shared part.
 *  - **the profile and the switch live on one row and one file**, so each write
 *    has to leave the other alone. The filesystem writer used to build the whole
 *    file from its single argument, which was correct with one field in it and
 *    would have deleted the switch the day a second arrived — with both writes
 *    reporting success. docs/reusable/silent-success.md.
 *
 * docs/project/experimental-features.md; docs/plans/experimental-features-toggle.md.
 *
 * ## Whose row Postgres writes to
 *
 * **Not the development owner's.** That row is Greg's own profile on his own
 * laptop, and a suite that writes it and tidies up afterwards is exactly what
 * wiped his profile twice in one session (src/profile.ts § `fileFor`). So this
 * file creates an `auth.users` row of its own, uses that, and deletes both rows
 * afterwards: it only ever touches what it made.
 *
 * The Postgres half **skips loudly** without a migrated database, and it skips
 * on the column this whole file is about — so an unmigrated laptop is told to
 * run `npm run db:migrate` rather than shown a confusing missing-column error.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { readerProfiles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import type { ReaderStore } from "../src/store/contracts.js";
import { fsReaderStore } from "../src/store/fs.js";
import { pgReaderStore } from "../src/store/pg-reader.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* At module load, so the skip is a real vitest skip rather than a green tick
   for having checked nothing. tests/helpers/pg-ready.ts. */
const { reachable: pgReachable } = await pgReady({
  suite: "tests/store-reader-parity.test.ts",
  columns: [{ table: "spideryarn.reader_profiles", column: "experimental_since" }],
});

/**
 * This suite's own reader, and nobody else's.
 *
 * `reader_profiles.owner_id` references `auth.users(id)`, so the row has to
 * exist before anything can be written for it, and it is deleted again at the
 * end. A `4` in the third group and an `8` in the fourth keeps it a well-formed
 * v4 uuid, like the synthetic owners in tests/owner-isolation.test.ts.
 */
const OWNER = "00000000-0000-4000-8000-0000000000e1" as OwnerId;

/** `data/_test-reader-parity.json`, for the same reason routes.test.ts has one. */
const FILE = path.resolve(import.meta.dirname, "..", "data", "_test-reader-parity.json");

/**
 * Run `body` with whatever the store under test needs around it.
 *
 * The filesystem store reads `SPIDERYARN_READER_FILE` at call time; the
 * Postgres one reads `currentOwnerId()`, which is why its half runs inside a
 * request scope. Wrapping both here is what lets every case below be written
 * once and mean the same thing twice — the point of a parity suite.
 */
function on(store: ReaderStore, body: () => Promise<void>): Promise<void> {
  if (store !== pgReaderStore) {
    process.env.SPIDERYARN_READER_FILE = FILE;
    return body().finally(() => {
      delete process.env.SPIDERYARN_READER_FILE;
    });
  }
  return runInRequest(async () => {
    setRequestOwner(OWNER);
    await body();
  });
}

/**
 * The `auth.users` row this suite's owner needs.
 *
 * `on conflict do nothing`, so a re-run after a crashed one is fine. These are
 * the columns tests/db-schema.test.ts inserts, for the same reason: Supabase's
 * table has many more and every one of them has a default.
 */
async function seedOwner(): Promise<void> {
  await getDb().execute(sql`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (${OWNER}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'reader-parity@example.invalid', 'x', now(), now())
    on conflict (id) do nothing`);
}

afterAll(async () => {
  await rm(FILE, { force: true });
  if (!pgReachable) return;
  const db = getDb();
  await db.delete(readerProfiles).where(eq(readerProfiles.ownerId, OWNER));
  await db.execute(sql`delete from auth.users where id = ${OWNER}`);
  await closeDb();
});

const stores: [string, ReaderStore, boolean][] = [
  ["the filesystem store", fsReaderStore, true],
  ["Postgres", pgReaderStore, pgReachable],
];

for (const [name, store, available] of stores) {
  describe.skipIf(!available)(name, () => {
    beforeAll(async () => {
      if (store === pgReaderStore) await seedOwner();
    });

    /* Every case starts from off and unwritten, so none of them depends on the
       order the others ran in — and so a failure names the case that failed
       rather than the one before it. */
    beforeEach(async () => {
      await on(store, async () => {
        await store.writeExperimental(false);
        await store.writeProfile(null);
      });
    });

    it("is off until it is switched on", async () => {
      await on(store, async () => {
        expect(await store.readExperimental()).toBeNull();
      });
    });

    it("answers with a real date once it is on", async () => {
      await on(store, async () => {
        const since = await store.writeExperimental(true);
        expect(since).toBeTypeOf("string");
        expect(Number.isNaN(Date.parse(since as string))).toBe(false);
        expect(await store.readExperimental()).toBe(since);
      });
    });

    it("keeps the first date when it is switched on again", async () => {
      await on(store, async () => {
        const first = await store.writeExperimental(true);
        /* A real gap, so a re-stamp would be *visible*: two `now()`s inside the
           same millisecond compare equal, and this would pass against an
           implementation that restamps every time. */
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.writeExperimental(true)).toBe(first);
        expect(await store.readExperimental()).toBe(first);
      });
    });

    it("clears it, and a later on is honestly a new date", async () => {
      await on(store, async () => {
        const first = await store.writeExperimental(true);
        expect(await store.writeExperimental(false)).toBeNull();
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.writeExperimental(true)).not.toBe(first);
      });
    });

    it("leaves the profile alone when the switch changes, and the other way round", async () => {
      await on(store, async () => {
        await store.writeProfile("A physicist.");
        const since = await store.writeExperimental(true);
        expect(await store.readProfile()).toBe("A physicist.");

        await store.writeProfile("A physicist, still.");
        expect(await store.readExperimental()).toBe(since);
      });
    });
  });
}
// @vitest-environment jsdom
/**
 * **A switch that says it is on had better be on.**
 *
 * The experimental-features control is one checkbox, and every way it can lie
 * is a way a reader ends up disagreeing with the app about what they should be
 * seeing:
 *
 *  - **It ticks itself before the server has answered.** Then a reader who is
 *    *on* opens `/profile`, sees "off", and the first thing they touch sends an
 *    "off" that was never their decision. So the box is disabled until the
 *    answer lands, and this file checks the disabled state rather than only the
 *    tick.
 *  - **A failed save leaves the tick where the reader put it.** Every gated
 *    feature then disagrees with the switch that claims to control them, and
 *    nothing on screen says so. docs/reusable/silent-success.md.
 *
 * docs/project/experimental-features.md. The store and the route are covered by
 * tests/store-reader-parity.test.ts and tests/routes.test.ts; this is the half
 * a reader touches.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What `/api/reader` answers with, and what the next PATCH does. */
let answer: () => Promise<unknown>;
let patched: unknown[] = [];

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") patched.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(null, { status: 200 }));
  },
  readJson: () => answer(),
}));

const { SettingsSection } = await import("../src/web/SettingsSection.js");

let host: HTMLDivElement;
let root: Root;

const box = (): HTMLInputElement => host.querySelector("input[type=checkbox]") as HTMLInputElement;
const said = (): string => host.textContent ?? "";

function paint(): void {
  act(() => {
    root.render(createElement(SettingsSection));
  });
}

/** Let the fetch and its `.then` chain settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  patched = [];
  answer = () => Promise.resolve({ experimentalSince: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the experimental-features switch", () => {
  it("cannot be touched until the server has said what it is", () => {
    paint();
    // Before `settle()`: the answer has not arrived.
    expect(box().disabled).toBe(true);
    expect(said()).toContain("Loading…");
  });

  it("is off, and says so, for a reader who has never switched it on", async () => {
    paint();
    await settle();
    expect(box().disabled).toBe(false);
    expect(box().checked).toBe(false);
    expect(said()).toContain("Off.");
  });

  it("is on when the server sends a date, and says since when", async () => {
    answer = () => Promise.resolve({ experimentalSince: new Date().toISOString() });
    paint();
    await settle();
    expect(box().checked).toBe(true);
    expect(said()).toContain("On");
  });

  it("sends a boolean, not the date it is displaying", async () => {
    paint();
    await settle();
    answer = () => Promise.resolve({ experimentalSince: "2026-08-31T10:00:00.000Z" });
    await act(async () => {
      box().click();
    });
    await settle();
    /* The wire takes `{ experimental: true }` — the client says what it wants,
       and the *server* decides what the date is. A client that could name the
       date could move a value whose whole job is to stay put. */
    expect(patched).toEqual([{ experimental: true }]);
    expect(box().checked).toBe(true);
  });

  it("springs back and says so when the save fails", async () => {
    paint();
    await settle();
    answer = () => Promise.reject(new Error("the server said no"));
    await act(async () => {
      box().click();
    });
    await settle();
    /* Back where it was, *and* a sentence — either one alone is a lie: a switch
       that stays put claims a save that never happened, and one that springs
       back without a word reads as the click having missed. */
    expect(box().checked).toBe(false);
    expect(said()).toContain("Not saved");
    expect(said()).toContain("the server said no");
  });
});
-- The experimental-features switch. docs/project/experimental-features.md,
-- docs/plans/experimental-features-toggle.md.
--
-- Null is off and is the default, so **no row is touched by this migration** —
-- every reader is already off, because off is what the absence of a date means.
-- A `boolean not null default false` would have had to write every row to say
-- the same thing, and would have thrown away when it was switched on.
-- docs/project/sql.md § A nullable timestamp says more than a boolean.
--
-- Generated by `drizzle-kit generate --name=experimental_features` and read
-- before applying: one statement, and no re-emission of anything an earlier
-- hand-written migration had already done (which is what 0030 had to repair).
-- meta/0032_snapshot.json beside this file is kept as generated.

ALTER TABLE "spideryarn"."reader_profiles" ADD COLUMN "experimental_since" timestamp with time zone;
