/**
 * **Upload the file instead, from the page that just said to.**
 *
 * A site that refuses this app (`[fetch-refused]`), or answers with a check that
 * its visitor is not a bot (`[jb-bot-check]`), will usually let the reader's own
 * browser through, and the failure sentence tells them to save the page or the
 * site's PDF and upload it. Until 2026-10-15 the add page they were standing on
 * had no way to do that: the File button is on the shelf. Greg's report
 * `spya-x5e966`, and the plan:
 * docs/plans/261015a-a-site-that-refuses-the-app-a-better-way-round-and-the-bigger-options-for-greg.md.
 *
 * **The shelf's own picker, whole.** `UploadPicker` hands back its File
 * button, its status row (refusals, the caps, the progress bar) and a commit,
 * and owns the drop target; committing hands the file to `uploadEngine` and
 * navigates to `/add/upload/<id>` exactly as the shelf's Add does. Nothing here
 * uploads anything of its own. The caller decides when to draw it, from
 * `failureSuggestsUpload` in src/messages.ts.
 *
 * **Above the bookmarklet, the Chrome extension**, where it gets round the
 * failure (`extension`, from `failureSuggestsExtension`): one press, nothing to
 * save or upload, so it is the better way round where it reaches. It draws
 * nothing until the store item exists (ExtensionOffer.tsx, plan 261025b).
 */
import { Button } from "@/components/ui/button";
import { ExtensionOffer } from "./ExtensionOffer.js";
import { SavePageBookmarklet } from "./SavePageBookmarklet.js";
import { UploadPicker } from "./UploadPicker.js";

export function UploadInstead({ extension }: { extension: boolean }) {
  return (
    <UploadPicker single>
      {(slots) => (
        <section aria-label="Upload a file instead" className="tw:mt-3">
          <p className="tw:mb-2 tw:text-sm tw:text-muted-foreground">
            Downloaded the site's PDF, or saved the page as a PDF? Upload it here.
          </p>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            {slots.pdfButton}
            {slots.chosen && (
              <Button type="button" onClick={slots.commit}>
                Add
              </Button>
            )}
          </div>
          {slots.uploadStatus}
          {extension && <ExtensionOffer />}
          <SavePageBookmarklet />
        </section>
      )}
    </UploadPicker>
  );
}
