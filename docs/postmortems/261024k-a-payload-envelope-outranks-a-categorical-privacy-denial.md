# A payload envelope outranks a categorical privacy denial

Nothing reached the Chrome Web Store, but commit `9966db02df90` prepared a false disclosure. The
listing said the extension collected no personal, health, financial, communications, location or
authentication data while its payload was the arbitrary DOM of a page the reader chose.

## The class: categorical claims made from purpose instead of payload

The extension does not seek those data and uses the page only to add an article. That says why it
collects, not what the envelope can contain. A mail thread, bank page or health portal remains that
kind of data when it is nested inside “website content.” The same mistake occurs when logs, archives
or attachments are classified by the feature's intent rather than their possible contents.

The introducing commit was `9966db02df90`. Its own privacy prose mentioned a reader's name in page
chrome, but the store checklist then denied the broader category.

## Why nothing went red

No test can prove the absence of a data category from arbitrary HTML. The sanitiser tests proved
specific credential fields were removed, which was incorrectly read as a bound on the rest of the
DOM. They also omitted executable event attributes and `javascript:` URLs while prose said scripts
were removed.

## What would have caught it, ranked by ease against value

1. **Classify the envelope, then state the purpose** — the listing now tells the publisher to
   declare every content category available in the dashboard and explains that collection is
   incidental to the one user-chosen page. Done.
2. **Test every precise removal claim** — executable script elements, event attributes and
   `javascript:` URLs are removed; MathJax and structured-data scripts remain. Added.
3. **Attempt to enumerate safe page types** — rejected: the `activeTab` gesture permits any web
   page, and a domain allowlist would defeat the extension's purpose without proving its contents.

## The long-term fix

Disclosure describes the rendered DOM, including personalised, sensitive and currently hidden
content, and names the exact form and executable material removed. The capture function now strips
the active attributes that contradicted that statement. Retention and recipients are explicit too.

## The thing I would tell myself

I would not infer data categories from what the feature means to do. For an opaque container, the
honest upper bound is what the container can hold.

---

Up: [postmortems.md](../project/postmortems.md)
