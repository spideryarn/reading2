/**
 * **`/admin/mockups` and `/admin/mockups/m-xxxxxx`** — the mockups agents make
 * so a decision question can show Greg pictures to compare. Greg, 2026-10-28
 * (`spya-zytb0g`): *"a /admin/mockups page with a table that can link out to
 * particular mockups. And then the decision process for new ideas could
 * reference these mockups."* Plan 261028b, Stage 3;
 * docs/project/admin.md § `/admin/mockups`.
 *
 * Read-only: three GETs under `/api/admin/mockups`, which is behind the
 * server's namespace gate. The files are in the repo (src/mockups.ts has the
 * format), so a new one shows here after the next deploy.
 */
import { type ReactNode, useEffect, useState } from "react";

import type { MockupDetail, MockupSummary } from "../mockups.js";
import { Shell } from "./AdminPage.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { PlainTextBlocks } from "./PlainTextBlocks.js";
import { ADMIN_HREF, ADMIN_MOCKUPS_HREF, adminMockupHref, useRoute } from "./router.js";

type Load<T> = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; value: T };

/** One GET, read as JSON, for as long as the page wants `url`. A stale answer is dropped. */
function useAdminRead<T>(url: string, pick: (body: unknown) => T): Load<T> {
  const [state, setState] = useState<{ url: string; load: Load<T> }>({ url, load: { kind: "loading" } });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pick` is a module-scope function at every call.
  useEffect(() => {
    let live = true;
    setState({ url, load: { kind: "loading" } });
    void (async () => {
      try {
        const value = pick(await readJson<unknown>(await apiFetch(url)));
        if (live) setState({ url, load: { kind: "ready", value } });
      } catch (e) {
        if (live) setState({ url, load: { kind: "failed", message: describeFetchFailure(e as Error) } });
      }
    })();
    return () => {
      live = false;
    };
  }, [url]);
  return state.url === url ? state.load : { kind: "loading" };
}

const pickList = (body: unknown) => (body as { mockups: MockupSummary[] }).mockups;
const pickOne = (body: unknown) => (body as { mockup: MockupDetail }).mockup;

const HEAD = "tw:px-3 tw:py-2 tw:text-left tw:text-xs tw:font-normal tw:text-muted-foreground tw:whitespace-nowrap";
const CELL = "tw:px-3 tw:py-2 tw:align-top";
const ID_CELL = `${CELL} tw:font-mono tw:text-xs tw:whitespace-nowrap`;

function Waiting<T>({ load, children }: { load: Load<T>; children: (value: T) => ReactNode }) {
  if (load.kind === "loading") return <p className="tw:text-sm tw:text-muted-foreground">Loading…</p>;
  if (load.kind === "failed") {
    return (
      <p
        role="alert"
        className="tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground"
      >
        {load.message}
      </p>
    );
  }
  return <>{children(load.value)}</>;
}

/** `/admin/mockups` — the table, newest first (the server's order). */
export function AdminMockupsPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "mockups" }));
  const load = useAdminRead("/api/admin/mockups", pickList);
  return (
    <Shell title="Mockups" back={{ href: ADMIN_HREF, label: "Back to Admin" }}>
      <p className="tw:mb-6 tw:text-sm tw:text-muted-foreground">
        Mockups agents made for the questions in Needs a decision, so you can compare them. Each is a file in
        docs/mockups/ and shows here after the next deploy.
      </p>
      <Waiting load={load}>
        {(mockups) =>
          mockups.length === 0 ? (
            <p className="tw:text-sm tw:text-muted-foreground">No mockups yet.</p>
          ) : (
            <div className="tw:overflow-x-auto">
              <table className="tw:w-full tw:border-collapse tw:text-sm">
                <thead>
                  <tr className="tw:border-b tw:border-border">
                    <th scope="col" className={HEAD}>
                      Id
                    </th>
                    <th scope="col" className={HEAD}>
                      Title
                    </th>
                    <th scope="col" className={HEAD}>
                      Made
                    </th>
                    <th scope="col" className={HEAD}>
                      Question
                    </th>
                    <th scope="col" className={HEAD}>
                      Report
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mockups.map((m) => (
                    <tr key={m.id} data-mockup={m.id} className="tw:border-b tw:border-border/60">
                      <td className={ID_CELL}>
                        <Link href={adminMockupHref(m.id)}>{m.id}</Link>
                      </td>
                      <td className={`${CELL} tw:text-foreground`}>
                        <Link href={adminMockupHref(m.id)}>{m.title}</Link>
                        {m.images > 0 && (
                          <span className="tw:ml-2 tw:text-xs tw:text-muted-foreground">
                            {m.images} image{m.images === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className={`${CELL} tw:whitespace-nowrap tw:tabular-nums`}>{m.made}</td>
                      <td className={ID_CELL}>{m.question ?? "—"}</td>
                      <td className={ID_CELL}>{m.report ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Waiting>
    </Shell>
  );
}

/** `/admin/mockups/m-xxxxxx` — one mockup: its words, its ASCII and its pictures, in the file's order. */
export function AdminMockupPage() {
  const route = useRoute();
  const id = route.kind === "admin" && route.page === "mockup" ? route.id : "";
  const load = useAdminRead(`/api/admin/mockups/${encodeURIComponent(id)}`, pickOne);
  useDocumentTitle(pageTitle({ kind: "admin", page: "mockup" }));
  return (
    <Shell
      title={load.kind === "ready" ? load.value.title : id}
      back={{ href: ADMIN_MOCKUPS_HREF, label: "Back to Mockups" }}
    >
      <Waiting load={load}>
        {(mockup) => (
          <article data-mockup={mockup.id} className="tw:flex tw:flex-col tw:gap-4">
            <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
              <span className="tw:font-mono">{mockup.id}</span> · made {mockup.made}
              {mockup.question !== null && (
                <>
                  {" "}
                  · for question <span className="tw:font-mono">{mockup.question}</span>
                </>
              )}
              {mockup.report !== null && (
                <>
                  {" "}
                  · report <span className="tw:font-mono">{mockup.report}</span>
                </>
              )}
            </p>
            {/* Keyed by position: the parts are the file's order and never move. */}
            {mockup.body.map((part, i) =>
              part.kind === "text" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, see above.
                <div key={i} className="tw:flex tw:flex-col tw:gap-3">
                  <PlainTextBlocks
                    text={part.text}
                    className="tw:m-0 tw:whitespace-pre-wrap tw:text-sm tw:text-foreground"
                  />
                </div>
              ) : (
                <MockupImage key={`image-${part.index}`} id={mockup.id} index={part.index} />
              ),
            )}
          </article>
        )}
      </Waiting>
    </Shell>
  );
}

/**
 * **One picture, through `apiFetch` into a blob URL** — not `<img src=…>`,
 * which sends no `Authorization` header and would get a 401 (GPT Sol's plan
 * review, F2). The same two effects as AdminFeedbackList.tsx § `Screenshot`,
 * and for its reason: one fetches, one owns the URL's lifetime, so the URL is
 * revoked when replaced or unmounted and never while still shown.
 */
function MockupImage({ id, index }: { id: string; index: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setError(null);
    void apiFetch(`/api/admin/mockups/${encodeURIComponent(id)}/images/${index}`)
      .then(async (res) => {
        if (!res.ok) throw new ReaderFacingError(`The image did not load (${res.status}).`);
        const made = URL.createObjectURL(await res.blob());
        if (live) setUrl(made);
        else URL.revokeObjectURL(made);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, index]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (error !== null) {
    return (
      <p
        role="alert"
        className="tw:m-0 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground"
      >
        {error}
      </p>
    );
  }
  if (url === null) return <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Loading image…</p>;
  return (
    <img
      src={url}
      alt={`Mockup ${id}, figure ${index + 1}`}
      className="tw:max-w-full tw:h-auto tw:rounded-md tw:border tw:border-border"
    />
  );
}
