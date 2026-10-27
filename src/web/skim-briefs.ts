/**
 * **The owner's added Skim briefs**, as the client reads and writes them — one
 * sentence each, *what are you skimming for?*, and the route planned for it.
 * The default brief (the reader profile with the article's *why you're
 * reading*) is not here: it is the revision's route, read by `useSkim` with no
 * brief. docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md.
 *
 * The routes are `/api/skim/:slug/briefs…` (src/routes.ts), owner-only, 404
 * to anybody else. **Planning is not here**: it is the `skim` job named for
 * the brief, which `useSkim(slug, quotes, ideas, brief)` starts through
 * `useStepJob` — the same queue, de-duplication and hold as the default's.
 * One brief's route is read there too, with the default's freshness fields.
 *
 * **The id is minted here**, the way Chat mints a thread's: `?brief=` can name
 * a brief from the first frame, and a create that is sent twice (a retry
 * after a lost answer) is one row, because the server's create is idempotent
 * on the id.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mintId } from "../ids.js";
import type { SkimBriefList, SkimBriefSummary } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { useOrderedRead } from "./useOrderedRead.js";

const briefsPath = (slug: string) => `/api/skim/${encodeURIComponent(slug)}/briefs`;
const briefPath = (slug: string, id: string) => `${briefsPath(slug)}/${encodeURIComponent(id)}`;

function sendJson(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Every added brief on the article, oldest first. */
export async function listBriefs(slug: string): Promise<SkimBriefSummary[]> {
  const body = await readJson<SkimBriefList>(await apiFetch(briefsPath(slug)));
  if (!Array.isArray(body?.briefs)) throw new MalformedReply("the briefs reply has no list");
  return body.briefs;
}

/**
 * Add a brief, unplanned. `id` is for a retry of the same create; a first
 * press leaves it to be minted. Answers with what the server stored, which
 * trims the sentence.
 */
export async function createBrief(slug: string, brief: string, id: string = mintId()): Promise<SkimBriefSummary> {
  return readJson<SkimBriefSummary>(await apiFetch(briefsPath(slug), sendJson("POST", { id, brief })));
}

/** Change a brief's sentence. Its route is not re-planned here: that is a job. */
export async function editBrief(slug: string, id: string, brief: string): Promise<SkimBriefSummary> {
  return readJson<SkimBriefSummary>(await apiFetch(briefPath(slug, id), sendJson("PATCH", { brief })));
}

/** Delete a brief and its route. A 204; anything else is a sentence `readJson` throws. */
export async function deleteBrief(slug: string, id: string): Promise<void> {
  const res = await apiFetch(briefPath(slug, id), { method: "DELETE" });
  if (!res.ok) await readJson(res);
}

export type BriefsStatus = "idle" | "loading" | "ready" | "error";

export interface SkimBriefs {
  /** `idle` while not asked to read (`enabled` false). */
  status: BriefsStatus;
  briefs: SkimBriefSummary[];
  error: string | null;
  /** Read the list again, trailing a read in flight. Never spends. */
  refresh(): Promise<void>;
  /** `createBrief`, and the list read again after it. `id` identifies one logical press across retries. */
  create(brief: string, id?: string): Promise<SkimBriefSummary>;
  edit(id: string, brief: string): Promise<SkimBriefSummary>;
  remove(id: string): Promise<void>;
}


/**
 * **The list, read while `enabled`.** Read when `?brief=` names one — to find
 * its sentence, and to tell an unknown id from a real one — and once the
 * picker has been opened (SkimBriefPicker.tsx), so opening Skim on the default
 * costs no request it did not cost before. Every write reads the list again
 * afterwards, whether or not it answered: a write whose answer was lost may
 * still have landed.
 *
 * **What this tab wrote is laid over the list until a read agrees** (stage
 * 4). A read already in flight when a brief is created can land after the
 * create's answer, without it — and the band would take the brief the picker
 * has just switched to for an id nobody has, and clear it (SkimBand §
 * `unknown`). So a write's answer shows at once: a created or edited brief is
 * kept, a deleted one hidden, until a read that **began after** the write has
 * landed, which has the write in it either way.
 */
export function useSkimBriefs(slug: string, enabled: boolean): SkimBriefs {
  const [state, setState] = useState<{ slug: string; status: BriefsStatus; briefs: SkimBriefSummary[]; error: string | null }>(
    { slug, status: "idle", briefs: [], error: null },
  );
  /** Each write's number, so a read knows which writes it began after. */
  const writes = useRef(0);
  const [local, setLocal] = useState<{ slug: string; changes: LocalChange[] }>({ slug, changes: [] });
  const load = useCallback(
    async (current: () => boolean) => {
      if (!enabled) return;
      const began = writes.current;
      setState((was) => (was.slug === slug && was.status === "ready" ? was : { slug, status: "loading", briefs: [], error: null }));
      try {
        const briefs = await listBriefs(slug);
        if (!current()) return;
        setState({ slug, status: "ready", briefs, error: null });
        setLocal((was) => ({ slug, changes: was.slug === slug ? was.changes.filter((c) => c.n > began) : [] }));
      } catch (err) {
        if (!current()) return;
        const why = describeFetchFailure(err as Error);
        /* A failed revalidation keeps the list it had, as every read here does. */
        setState((was) =>
          was.slug === slug && was.status === "ready" ? { ...was, error: why } : { slug, status: "error", briefs: [], error: why },
        );
      }
    },
    [slug, enabled],
  );
  const { reload, refresh } = useOrderedRead(load);
  useEffect(() => {
    void reload();
  }, [reload]);

  const after = useCallback(
    async <T,>(write: () => Promise<T>): Promise<T> => {
      try {
        return await write();
      } finally {
        void refresh();
      }
    },
    [refresh],
  );
  const noted = useCallback(
    (change: Omit<LocalChange, "n">) => {
      const n = ++writes.current;
      setLocal((was) => ({ slug, changes: [...(was.slug === slug ? was.changes : []), { ...change, n }] }));
    },
    [slug],
  );
  /**
   * A write can land and lose only its reply. Confirm the exact sentence in
   * the owner-only list before reporting failure: otherwise Create can be
   * retried as a second row, and Edit can save without planning what it saved.
   */
  const confirmed = useCallback(
    async (id: string, brief: string): Promise<SkimBriefSummary | null> => {
      try {
        const row = (await listBriefs(slug)).find((candidate) => candidate.id === id);
        return row?.brief === brief.trim() ? row : null;
      } catch {
        return null;
      }
    },
    [slug],
  );
  const create = useCallback(
    (brief: string, id: string = mintId()) =>
      after(async () => {
        let made: SkimBriefSummary;
        try {
          made = await createBrief(slug, brief, id);
        } catch (err) {
          const stored = await confirmed(id, brief);
          if (stored === null) throw err;
          made = stored;
        }
        noted({ put: made });
        return made;
      }),
    [after, slug, noted, confirmed],
  );
  const edit = useCallback(
    (id: string, brief: string) =>
      after(async () => {
        let changed: SkimBriefSummary;
        try {
          changed = await editBrief(slug, id, brief);
        } catch (err) {
          const stored = await confirmed(id, brief);
          if (stored === null) throw err;
          changed = stored;
        }
        noted({ put: changed });
        return changed;
      }),
    [after, slug, noted, confirmed],
  );
  const remove = useCallback(
    (id: string) =>
      after(async () => {
        await deleteBrief(slug, id);
        noted({ gone: id });
      }),
    [after, slug, noted],
  );

  const mine = state.slug === slug && enabled;
  const briefs = useMemo(
    () => (local.slug === slug ? overlaid(state.briefs, local.changes) : state.briefs),
    [state.briefs, local, slug],
  );
  return {
    status: mine ? state.status : "idle",
    briefs: mine ? briefs : [],
    error: mine ? state.error : null,
    refresh,
    create,
    edit,
    remove,
  };
}

/** One write this tab made, numbered in the order it was answered. */
interface LocalChange {
  n: number;
  put?: SkimBriefSummary;
  gone?: string;
}

/** The list as read, with this tab's later writes applied in order. */
function overlaid(read: SkimBriefSummary[], changes: readonly LocalChange[]): SkimBriefSummary[] {
  let list = read;
  for (const change of changes) {
    if (change.gone !== undefined) list = list.filter((b) => b.id !== change.gone);
    const put = change.put;
    if (put !== undefined) {
      list = list.some((b) => b.id === put.id) ? list.map((b) => (b.id === put.id ? put : b)) : [...list, put];
    }
  }
  return list;
}
