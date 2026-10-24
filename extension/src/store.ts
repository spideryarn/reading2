/**
 * **Where a capture waits for its tab**: IndexedDB in the extension's own
 * origin, which nothing but this extension can read.
 *
 * Not `chrome.storage.session` (a few megabytes, and a page can be fifty) and
 * not the worker's memory (Chrome stops an idle worker after 30 seconds, and a
 * reader who has to sign in first takes longer). Each operation is one
 * transaction; `take` reads and deletes in the same read-write transaction, so
 * two asks at once cannot both have the page (GPT Sol, 261024q F4).
 */
import type { Opened, Waiting, WaitingStore } from "./handoff.js";

export const HANDOFF_DB_NAME = "spideryarn-handoff";
const WAITING = "waiting";
const OPENED = "opened";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDOFF_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(WAITING, { keyPath: "tabId" });
      db.createObjectStore(OPENED, { keyPath: "source" }).createIndex("tabId", "tabId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs `work` in one transaction over both stores, resolving when it commits. */
async function inTransaction<T>(
  mode: IDBTransactionMode,
  work: (waiting: IDBObjectStore, opened: IDBObjectStore) => () => T,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([WAITING, OPENED], mode);
      const result = work(tx.objectStore(WAITING), tx.objectStore(OPENED));
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const indexedDbStore: WaitingStore = {
  put: (entry: Waiting, opened: Opened) =>
    inTransaction("readwrite", (waiting, openedStore) => {
      waiting.put(entry);
      openedStore.put(opened);
      return () => undefined;
    }),

  take: (tabId: number, nonce: string) =>
    inTransaction("readwrite", (waiting) => {
      let found: Waiting | undefined;
      const req = waiting.get(tabId);
      req.onsuccess = () => {
        const candidate = req.result as Waiting | undefined;
        if (candidate?.nonce === nonce) {
          found = candidate;
          waiting.delete(tabId);
        }
      };
      return () => found;
    }),

  openedFor: (source: string) =>
    inTransaction("readonly", (_waiting, opened) => {
      let found: Opened | undefined;
      const req = opened.get(source);
      req.onsuccess = () => {
        found = req.result as Opened | undefined;
      };
      return () => found;
    }),

  forgetTab: (tabId: number) =>
    inTransaction("readwrite", (waiting, opened) => {
      waiting.delete(tabId);
      const req = opened.index("tabId").openCursor(IDBKeyRange.only(tabId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor === null) return;
        cursor.delete();
        cursor.continue();
      };
      return () => undefined;
    }),

  forgetAll: () =>
    inTransaction("readwrite", (waiting, opened) => {
      waiting.clear();
      opened.clear();
      return () => undefined;
    }),

  dropOlderThan: (before: number) =>
    inTransaction("readwrite", (waiting, opened) => {
      for (const store of [waiting, opened]) {
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor === null) return;
          if ((cursor.value as { at: number }).at < before) cursor.delete();
          cursor.continue();
        };
      }
      return () => undefined;
    }),
};
