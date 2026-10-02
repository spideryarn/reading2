/**
 * **Download one article's export, as `<slug>.zip`** — the press behind
 * Metadata's *Export this article* button and the command bar's row of the same
 * name, written once so the two cannot hand the reader different files or
 * different sentences.
 *
 * It lived inside `ExportSection` (Metadata.tsx) until 2026-10-02, when the bar
 * learned to export (docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md,
 * stage B, GPT Sol's F9 — it is a ZIP, and the row says so). The button's
 * comments came with it, because each is about the download rather than the
 * button. The route is `GET /api/export/:slug` (src/routes.ts § `sendExport`);
 * docs/project/export.md is what is in the file.
 *
 * **It returns how it went rather than setting anything**, so each caller draws
 * its own: the button keeps its `busy` label and its `role="alert"` line, the
 * bar shuts or stays open with the sentence (command-match.ts §
 * `ActionOutcome`).
 */
import { apiFetch, failure, statusOf } from "./lib/api.js";

/**
 * `busy` is a second press for the same article while the first zip is still
 * being built — refused, and nothing sent. `failed` carries the sentence for
 * the reader, already worded.
 */
export type ExportResult =
  | { readonly kind: "downloaded" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * **The articles whose zip is being built right now**, across every caller.
 *
 * The button was the guard until this was shared: it is disabled while its own
 * request is out, so a second press could not start a second assembly and hand
 * the reader two copies of the same file. A second door has no way to see that
 * button's state — the bar is open over the page, and the button's request
 * carries on underneath it — so the guard moved in here, beside the request it
 * guards. Module state, because the thing it protects (one assembly per
 * article at a time, from this tab) is not any one component's.
 */
const building = new Set<string>();

export async function downloadExport(slug: string): Promise<ExportResult> {
  if (building.has(slug)) return { kind: "busy" };
  building.add(slug);
  try {
    /* The zip is assembled on the server before a byte is sent, so this is a
       real wait — a second or two on a long article. */
    const res = await apiFetch(`/api/export/${encodeURIComponent(slug)}`);
    /* `failure`, not `readJson`: the success body is a zip and reading it as
       text to look for an `error` key would consume the bytes we came for.
       On a refusal it hands back the server's own sentence. */
    if (!res.ok) throw await failure(res);

    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    /* The route names the file in `Content-Disposition`, and every header is
       lost through a blob URL — without this the reader gets an unnamed file. */
    link.download = `${slug}.zip`;
    /* In the document, not detached: Firefox has never dispatched the default
       action for a `click()` on an anchor that is not in a tree, and the
       symptom is nothing happening at all. */
    document.body.append(link);
    link.click();
    link.remove();
    /* A macrotask later, not synchronously. Revoking inside the same task can
       land before the browser has resolved the URL for the download, and the
       download then fails silently. A tick is enough — unlike SourceLink's
       minute-long timer, where a *new tab* has to fetch the URL itself; here
       the fetch starts during the click above. */
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { kind: "downloaded" };
  } catch (e) {
    /* The 413's prose is the server's and it is already written for the reader
       (src/routes.ts § `sendExport`): it says what happened and that trying
       again will not help, which is what docs/project/copy.md asks for.
       Putting "Couldn't build the download" in front of it would add a lead
       that sentence does not need. Everything else gets the lead, because a
       bare "No such article." beside a button says nothing about which
       button. */
    return {
      kind: "failed",
      message:
        statusOf(e) === 413
          ? `${(e as Error).message} [export-too-big]`
          : `Couldn't build the download. ${(e as Error).message} [export-failed]`,
    };
  } finally {
    building.delete(slug);
  }
}
