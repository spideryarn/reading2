# Chrome Web Store listing: what to paste where

The words for the Chrome Web Store dashboard, field by field, so that the listing, the privacy
fields and [`/privacy`](https://www.spideryarn.com/privacy) say the same thing. Change them together
(docs/project/privacy.md § The Chrome extension). The steps that use this are in
[docs/project/chrome-extension.md § Publishing](../../docs/project/chrome-extension.md#publishing).

## Package

`extension/dist/spideryarn-extension-<version>.zip`, built by `npm run extension:build`.

## Store listing tab

- **Name**: Spideryarn (from the manifest)
- **Summary** (from the manifest's `description`, 132 characters at most): Adds the page you are
  reading to Spideryarn, as your browser shows it, in one click.
- **Category**: Productivity → Education is the other fair choice; Productivity, because it is a
  reading tool.
- **Language**: English (UK)
- **Description**:

  > Spideryarn helps you read deeply: it turns an article into something you can navigate, question
  > and learn from, without replacing the words with a summary.
  >
  > This extension adds the page you are reading to your Spideryarn shelf in one click. Press its
  > button and a Spideryarn tab opens beside the page with the article coming in.
  >
  > Because it takes the page as your browser shows it, it works on sites that turn automated
  > readers away but let you in: a journal that checks you are human, a page you are signed in to.
  >
  > It only reads the tab you press it on, only when you press it. It asks for no access to your
  > other tabs or to any site, and it holds nothing of your Spideryarn account: the Spideryarn tab
  > adds the page using your own sign-in. You need a Spideryarn account (free to start) at
  > www.spideryarn.com.

- **Icon**: `extension/icons/icon-128.png`
- **Screenshots** (1280×800): `extension/store/screenshot-1.png` and `-2.png`, if present; made
  by the end-to-end check (docs/project/chrome-extension.md § Checking it).
- **Homepage URL**: https://www.spideryarn.com
- **Support URL**: https://www.spideryarn.com/contact

## Privacy practices tab

- **Single purpose**: Add the web page in the current tab to the user's Spideryarn reading shelf,
  when the user presses the extension's button.
- **Permission justifications**:
  - `activeTab`: To read the page in the tab where the user pressed the button, and only that tab,
    only then. No other tab or site is accessible.
  - `scripting`: To run the function that copies that page (its HTML as rendered, with addresses
    made absolute and scripts, password and hidden fields removed) in that tab.
- **Remote code**: No, I am not using remote code.
- **Data usage**, tick:
  - **Website content** (the text, images and HTML of the page the user adds).
  - **Web history**: the address of the page the user adds, which is saved with it as where it
    came from. Nothing else of the browsing history.
  - Nothing else: no personally identifiable information, health, financial, authentication,
    personal communications, location or user activity data is collected by the extension.
    (A page the user adds can show such things, e.g. their name in a site's menu; the description
    and the privacy policy say so.)
- **Certify**: does not sell or transfer data to third parties outside the approved use cases;
  does not use or transfer it for purposes unrelated to the single purpose; does not use or
  transfer it to determine creditworthiness or for lending.
- **Privacy policy URL**: https://www.spideryarn.com/privacy

## Distribution tab

- **Visibility**: Unlisted for the beta (anyone with the link can install it; it does not appear in
  search). Public later, Greg's call.
- **Regions**: all.
