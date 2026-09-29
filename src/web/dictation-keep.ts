/**
 * **A dictation kept on this device until its words are safely in the box.**
 *
 * The product's {@link DictationKeeper}: every recorder chunk is written to
 * IndexedDB as it arrives, and deleted once the transcript has landed or the
 * reader throws the recording away. If the tab closes, reloads, crashes or is
 * discarded first, the next time the same box is on screen the recording is
 * offered back with the existing Try again / Save / Discard row. Greg,
 * 2026-09-29 (SPIDERYARN-READING2-5M), and the design with the options passed
 * over: docs/plans/260929h-dictation-that-survives-a-closed-tab.md.
 *
 * ## Three partitions, and what enforces each
 *
 * - **The box.** A recording is offered back only where it was made — its
 *   `where` travels with it, so it is transcribed against the article it was
 *   spoken about, not whichever the box is on now.
 * - **The reader.** Rows carry the signed-in id and are offered only to that id.
 *   No id, no keeping. The id partitions and grants nothing, exactly as in
 *   [offline-store.ts](./lib/offline-store.ts).
 * - **The tab.** Two tabs can show the same box, and a tape being recorded in
 *   one must not be offered by the other. The page holding a tape holds a Web
 *   Lock named for it; a recovery takes the lock with `ifAvailable`, so only a
 *   tape nobody holds can be recovered, and by one page only. The browser
 *   releases a dead tab's locks, which is the whole trick. No Web Locks means no
 *   keeping, rather than a guess about which tab is alive.
 *
 * ## What it must never do
 *
 * Touch the dictation. Every write is fire-and-forget and swallowed: a full
 * disk, a private window or a blocked upgrade costs the copy, never the
 * recording in memory. `intact()` is how the row finds out, so that it never
 * says "kept on this device" about a copy that is not there.
 *
 * ## How long a recording stays
 *
 * Until its words are in the box, the reader discards it, or they **sign out**
 * on purpose (`forgetDictationsOf`, from the Sign out button) — but not when a
 * session merely lapses, which would be exactly the silent loss this exists to
 * stop. Anything older than {@link MAX_AGE_MS} is deleted on the next visit
 * (`sweepDictations`, at startup). `/privacy` says so.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { lastKnownUser } from "./lib/offline-store.js";
import type { DictationContext } from "./dictation-upload.js";
import type { DictationKeeper, KeptTape, RecoveredTape } from "./transcriber.js";

/** A week. Long enough for "I'll deal with it tomorrow", short enough not to be an archive. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DB_NAME = "spideryarn-dictation";
const DB_VERSION = 1;
/** How long an open may take before we give up keeping, for this page. */
const OPEN_DEADLINE_MS = 3000;
/** The recorder's timeslice, so a one-chunk part is not reported as zero long. */
const CHUNK_MS = 1000;

interface TapeRow {
  id: string;
  user: string;
  box: string;
  where: unknown;
  startedAt: number;
  broken: boolean;
  /** Every part's recorder finished. See `KeptTape.complete`. */
  complete: boolean;
}

interface ChunkRow {
  /** `${tape}\n${part}\n${seq}`, zero-padded so the key order is the spoken order. */
  key: string;
  tape: string;
  part: number;
  seq: number;
  blob: Blob;
  mimeType: string;
  at: number;
}

interface Schema extends DBSchema {
  tapes: { key: string; value: TapeRow };
  chunks: { key: string; value: ChunkRow; indexes: { tape: string } };
}

let handle: Promise<IDBPDatabase<Schema> | null> | null = null;

function db(): Promise<IDBPDatabase<Schema> | null> {
  handle ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (typeof indexedDB === "undefined") return null;
      const wanted = openDB<Schema>(DB_NAME, DB_VERSION, {
        upgrade(instance) {
          instance.createObjectStore("tapes", { keyPath: "id" });
          instance.createObjectStore("chunks", { keyPath: "key" }).createIndex("tape", "tape");
        },
        blocking(_c, _b, event) {
          /* A later version wants in: let go, and keep nothing for the rest of
             this page rather than be the tab that holds the upgrade off. */
          (event.target as IDBDatabase | null)?.close();
          handle = Promise.resolve(null);
        },
        terminated() {
          handle = Promise.resolve(null);
        },
      });
      const opened = await Promise.race([
        wanted,
        new Promise<null>((go) => {
          timer = setTimeout(() => go(null), OPEN_DEADLINE_MS);
        }),
      ]);
      if (!opened) void wanted.then((d) => d.close()).catch(() => {});
      return opened;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  return handle;
}

const pad = (n: number) => String(n).padStart(6, "0");
const lockName = (id: string) => `spideryarn-dictation:${id}`;

function locks(): LockManager | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

/**
 * Take the tape's lock and hold it until the returned function is called.
 * Resolves null when somebody else holds it (`ifAvailable`) or it cannot be had.
 *
 * The callback returns a promise that stays pending for as long as this page
 * owns the tape — that is what holding a Web Lock *is*; the lock goes when the
 * promise settles or the page does.
 */
function hold(id: string, ifAvailable: boolean): Promise<(() => void) | null> {
  const lm = locks();
  if (!lm) return Promise.resolve(null);
  return new Promise((resolve) => {
    let letGo = () => {};
    const owned = new Promise<void>((r) => {
      letGo = r;
    });
    lm.request(lockName(id), { ifAvailable }, (lock) => {
      if (!lock) {
        resolve(null);
        return undefined;
      }
      resolve(letGo);
      return owned;
    }).catch(() => resolve(null));
  });
}

/**
 * The page's side of one kept tape. Writes are queued behind the lock, so the
 * row exists only once this page holds it and nothing can recover it half-born.
 */
function keptTape(
  id: string,
  lock: Promise<(() => void) | null>,
  row: TapeRow,
  fresh: boolean,
): KeptTape {
  let ok = true;
  let done = false;
  const seqs = new Map<number, number>();
  let queue: Promise<unknown> = Promise.resolve();
  const then = (work: (d: IDBPDatabase<Schema>) => Promise<unknown>) => {
    queue = queue
      .then(async () => {
        if (!(await lock)) throw new Error("not held");
        const d = await db();
        if (!d) throw new Error("no database");
        await work(d);
      })
      .catch(() => {
        ok = false;
      });
  };
  if (fresh) then((d) => d.put("tapes", row));
  const letGo = () => {
    void queue.finally(() => lock.then((release) => release?.()));
  };
  return {
    chunk(part, blob, mimeType) {
      if (done) return;
      const seq = seqs.get(part) ?? 0;
      seqs.set(part, seq + 1);
      const at = Date.now();
      then((d) =>
        d.put("chunks", { key: `${id}\n${pad(part)}\n${pad(seq)}`, tape: id, part, seq, blob, mimeType, at }),
      );
    },
    broken() {
      if (done) return;
      row.broken = true;
      then((d) => d.put("tapes", row));
    },
    complete() {
      if (done) return;
      row.complete = true;
      then((d) => d.put("tapes", row));
    },
    intact: () => ok && !done,
    forget() {
      if (done) return;
      done = true;
      then((d) => erase(d, [id]));
      letGo();
    },
    release() {
      if (done) return;
      done = true;
      letGo();
    },
  };
}

async function erase(d: IDBPDatabase<Schema>, ids: string[]): Promise<void> {
  const tx = d.transaction(["tapes", "chunks"], "readwrite");
  const chunks = tx.objectStore("chunks");
  for (const id of ids) {
    for (const key of await chunks.index("tape").getAllKeys(id)) await chunks.delete(key);
    await tx.objectStore("tapes").delete(id);
  }
  await tx.done;
}

/**
 * Build a tape's parts from its chunks. `whole` is false when a chunk is
 * missing from the middle of a part — a write that failed — since that part
 * then has a hole nobody can see.
 */
async function partsOf(
  d: IDBPDatabase<Schema>,
  id: string,
): Promise<{ parts: RecoveredTape<unknown>["parts"]; whole: boolean }> {
  const rows = await d.getAllFromIndex("chunks", "tape", id);
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byPart = new Map<number, ChunkRow[]>();
  for (const r of rows) byPart.set(r.part, [...(byPart.get(r.part) ?? []), r]);
  let whole = true;
  const numbers = [...byPart.keys()].sort((a, b) => a - b);
  const parts = numbers.flatMap((part, i) => {
    if (part !== i) whole = false;
    const chunks = byPart.get(part) ?? [];
    if (chunks.some((c, seq) => c.seq !== seq)) whole = false;
    const first = chunks[0];
    const last = chunks.at(-1);
    if (!first || !last) return [];
    return [
      {
        blob: new Blob(
          chunks.map((c) => c.blob),
          { type: first.mimeType },
        ),
        mimeType: first.mimeType,
        ms: last.at - first.at + CHUNK_MS,
      },
    ];
  });
  return { parts, whole };
}

/**
 * The keeper for one box. `box` names it — `"feedback"`, `` `chat:${slug}` `` —
 * and is the only thing a caller decides. Cheap to call on every render: it
 * holds no state of its own.
 */
export function keepDictation(box: string): DictationKeeper<DictationContext> {
  return {
    box,
    begin(where) {
      const user = lastKnownUser();
      if (!user || !locks() || typeof indexedDB === "undefined") return null;
      const id = crypto.randomUUID();
      const row: TapeRow = { id, user, box, where, startedAt: Date.now(), broken: false, complete: false };
      return keptTape(id, hold(id, false), row, true);
    },
    async recover() {
      try {
        const user = lastKnownUser();
        if (!user || !locks()) return null;
        const d = await db();
        if (!d) return null;
        const rows = (await d.getAll("tapes"))
          .filter((row) => row.user === user && row.box === box && Date.now() - row.startedAt <= MAX_AGE_MS)
          .sort((a, b) => a.startedAt - b.startedAt);
        for (const row of rows) {
          const release = await hold(row.id, true);
          if (!release) continue;
          const tape = keptTape(row.id, Promise.resolve(release), row, false);
          const { parts, whole } = await partsOf(d, row.id);
          if (parts.length === 0) {
            tape.forget();
            continue;
          }
          return {
            tape,
            where: row.where as DictationContext,
            startedAt: row.startedAt,
            parts,
            broken: row.broken,
            complete: row.complete && whole,
          };
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Delete every tape matching `which`. Best-effort, never rejects. With
 * `heldToo`, a tape some page is holding goes as well — for sign-out, where the
 * page holding it is this one, about to reload.
 */
async function sweep(which: (row: TapeRow) => boolean, heldToo = false): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const rows = (await d.getAll("tapes")).filter(which);
    if (heldToo) {
      await erase(
        d,
        rows.map((row) => row.id),
      );
      return;
    }
    if (!locks()) return;
    for (const row of rows) {
      const release = await hold(row.id, true);
      if (!release) continue;
      try {
        await erase(d, [row.id]);
      } finally {
        release();
      }
    }
  } catch {
    /* Nothing to do: the next visit tries again. */
  }
}

/** At startup: anything older than {@link MAX_AGE_MS}, anybody's. */
export function sweepDictations(): Promise<void> {
  const now = Date.now();
  return sweep((row) => now - row.startedAt > MAX_AGE_MS);
}

/**
 * The reader pressed Sign out: their kept recordings go, as their offline
 * articles do — somebody else may use this computer next. Bounded, so a slow
 * database never holds the sign-out up.
 */
export function forgetDictationsOf(userId: string, withinMs = 1500): Promise<void> {
  return Promise.race([
    sweep((row) => row.user === userId, true),
    new Promise<void>((go) => setTimeout(go, withinMs)),
  ]);
}
