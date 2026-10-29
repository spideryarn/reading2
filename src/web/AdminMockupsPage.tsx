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
import type { MockupSummary } from "../mockups.js";
import { Shell } from "./AdminPage.js";
import { Link } from "./Link.js";
import { MockupBody, mockupUrl, pickMockup, useAdminRead, Waiting } from "./MockupView.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { ADMIN_HREF, ADMIN_MOCKUPS_HREF, adminMockupHref, useRoute } from "./router.js";

const pickList = (body: unknown) => (body as { mockups: MockupSummary[] }).mockups;

const HEAD = "tw:px-3 tw:py-2 tw:text-left tw:text-xs tw:font-normal tw:text-muted-foreground tw:whitespace-nowrap";
const CELL = "tw:px-3 tw:py-2 tw:align-top";
const ID_CELL = `${CELL} tw:font-mono tw:text-xs tw:whitespace-nowrap`;

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
  const load = useAdminRead(mockupUrl(id), pickMockup);
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
            <MockupBody mockup={mockup} textClassName="tw:m-0 tw:whitespace-pre-wrap tw:text-sm tw:text-foreground" />
          </article>
        )}
      </Waiting>
    </Shell>
  );
}
