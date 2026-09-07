// @vitest-environment jsdom
/**
 * **Add commits; it does not wait.** The shelf half of the background upload.
 *
 * > sometimes it takes a while to upload over a slow connection. I have to wait
 * > before I can then click the Add button … I'd like to be able to upload and
 * > then click Add immediately, which would then wait for the upload to finish
 * > and run the ingestion queue immediately, so I could go off and do something
 * > else in the meantime.
 * >
 * > — Greg, 2026-09-03
 *
 * Two things, and the second is the one a unit test of the engine cannot see:
 *
 *  - pressing **Add** with a file chosen navigates to `/add/upload/<id>` while
 *    the PUT is still in flight;
 *  - **leaving the shelf does not stop the transfer**, which is the deleted
 *    abort-on-unmount. `UploadPicker` unmounts on that navigation, so if the
 *    cleanup came back this file goes red rather than a reader losing 40 MB.
 *
 * ## What is posed, and what is deliberately not
 *
 * The **engine** is real. It is the thing under test, and posing it would leave
 * this asserting that a component calls a function — true of the broken version
 * too, which called `uploadPdf` and then awaited it. What is posed is the layer
 * underneath: the grant request, the PUT, and `POST /api/jobs`. So the assertion
 * *"the router moved while the PUT is unresolved"* is about the real control
 * flow.
 *
 * `useJobs` is posed because none of this is about polling, and `navigate` is
 * spied on rather than driven, because jsdom's history is not the subject.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "../src/types.js";
import type { UseJobs } from "../src/web/useJobs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const queue: UseJobs = {
  jobs: [],
  loaded: true,
  error: null,
  driverFailures: {},
  lastFailure: () => null,
  add: async () => null,
  addUpload: async () => null,
  run: async () => null,
  cancel: async () => {},
  retry: async () => {},
  forget: async () => {},
};
vi.mock("../src/web/useJobs.js", () => ({ useJobs: () => queue, useJobSession: () => {} }));

/** Where the page was sent, in order. */
const went: string[] = [];
vi.mock("../src/web/router.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/router.js")>();
  return { ...real, navigate: (href: string) => went.push(href) };
});

/* The transport, posed under the real engine. `putBytes` is held open by the
   test, which is what makes "did Add wait for it?" a question with an answer. */
let putBytes: { resolve: () => void; reject: (e: unknown) => void };
const posted: string[] = [];
const grants: string[] = [];

vi.mock("../src/web/upload.js", () => ({
  requestGrant: async (file: File) => {
    grants.push(file.name);
    return {
      uploadId: "up-abc",
      url: "https://storage.test/staging/up-abc?token=x",
      expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
      slug: "paper",
    };
  },
  putFile: () =>
    new Promise<void>((resolve, reject) => {
      putBytes = { resolve, reject };
    }),
}));

vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return {
    ...real,
    apiFetch: async (url: string) => {
      posted.push(url);
      return new Response(JSON.stringify({ id: "job-1", slug: "paper", status: "queued", steps: [] } as unknown as Job), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
});

const { AddArticle } = await import("../src/web/AddArticle.js");
const { uploadEngine } = await import("../src/web/uploadEngine.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  went.length = 0;
  posted.length = 0;
  grants.length = 0;
  uploadEngine.reset();
  uploadEngine.start("reader-a");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A `File` jsdom will accept in a `DataTransfer`-shaped list. */
const aFile = (name = "paper.pdf", size = 11_000_000): File =>
  ({ name, size, type: "application/pdf" }) as unknown as File;

function render(): void {
  act(() => {
    root.render(createElement(AddArticle, { queue }));
  });
}

/** Put a file through the hidden `<input type=file>`, as the picker does. */
function choose(file: File): void {
  const input = host.querySelector("input[type=file]") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/**
 * Type into the URL field, the way React will actually notice.
 *
 * Setting `input.value` and dispatching `input` is not enough: React installs
 * its own value setter on the element and compares against the last value it
 * wrote, so a direct assignment is invisible to `onChange` and the field snaps
 * back to the component's state on the next render. Going through the
 * *prototype's* setter is the standard way round it, and without this the two
 * URL cases below pass for the wrong reason — an empty box has no slug, so Add
 * does nothing, which looks like Add refusing.
 */
function type(text: string): void {
  const input = host.querySelector("#add-url") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function addButton(): HTMLButtonElement {
  const buttons = [...host.querySelectorAll("button")] as HTMLButtonElement[];
  const add = buttons.find((b) => b.type === "submit");
  if (!add) throw new Error("no Add button on the add box");
  return add;
}

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("Add, with a PDF chosen", () => {
  it("goes to the ingest's page while the bytes are still moving", async () => {
    render();
    choose(aFile());

    /* The label is the reader's only warning about which of the two ways in the
       button will take, so it is asserted rather than assumed. */
    expect(addButton().textContent).toBe("Add file");

    await act(async () => {
      addButton().click();
    });
    await settle();

    expect(went, "Add did not navigate, or waited for the upload first").toEqual([
      "/add/upload/up-abc",
    ]);
    expect(grants).toEqual(["paper.pdf"]);
    /* **Nothing queued yet.** The bytes are not there, and posting now is what
       the server's readiness gate exists to refuse. */
    expect(posted).toEqual([]);
  });

  it("keeps sending after the shelf is gone, and queues the ingest itself", async () => {
    /* The deleted abort-on-unmount, as a measurement. `UploadPicker` used to
       abort the transfer in a cleanup — right while a completed upload
       navigated, wrong once nothing navigates on completion, and in practice it
       threw away a nearly finished upload every time somebody clicked anything.

       Watched red 2026-09-03 by putting the cleanup back: the PUT rejected with
       an `AbortError`, `/api/jobs` was never posted, and this failed on an empty
       `posted`. */
    render();
    choose(aFile());
    await act(async () => {
      addButton().click();
    });
    await settle();

    act(() => root.unmount());

    putBytes.resolve();
    await settle();

    expect(posted, "leaving the shelf stopped the ingest being queued").toEqual(["/api/jobs"]);
    expect(uploadEngine.getSnapshot().transfer?.phase.kind).toBe("queued");

    /* Re-rendered so `afterEach`'s unmount has a root to unmount. */
    root = createRoot(host);
  });
});

describe("Add, with a URL", () => {
  it("still takes the address, and says so on the button", async () => {
    /* The control. Every assertion above would pass just as well if Add had
       stopped doing the thing it was originally for. */
    render();
    type("example.com/an-essay");

    expect(addButton().textContent).toBe("Add");
    await act(async () => {
      addButton().click();
    });

    expect(went).toEqual(["/add/example.com%2Fan-essay"]);
    expect(grants, "a URL add reached for the upload engine").toEqual([]);
  });

  it("takes whichever of the two was touched last", async () => {
    /* The rule GPT Sol corrected. The plan said "a chosen file wins", and that
       is false the moment the reader chooses a PDF and then goes back to the
       address bar — the URL is the more recent intent, and Add would have sent
       the file they had moved on from. The label is what makes it visible, and
       it is the assertion here for the same reason. */
    render();
    choose(aFile());
    expect(addButton().textContent).toBe("Add file");

    type("example.com/an-essay");
    expect(addButton().textContent, "the file kept winning after the URL was typed").toBe("Add");

    await act(async () => {
      addButton().click();
    });
    expect(went).toEqual(["/add/example.com%2Fan-essay"]);
    expect(grants).toEqual([]);
  });
});

describe("the Add button's enabled state", () => {
  it("is off with nothing to add, and on with either", () => {
    /* It was `disabled={!slug}` until 2026-09-03, which is why a chosen file
       needed its own button. One button for both ways in was Greg's choice. */
    render();
    expect(addButton().disabled).toBe(true);

    choose(aFile());
    expect(addButton().disabled, "a chosen PDF left Add switched off").toBe(false);
  });
});
