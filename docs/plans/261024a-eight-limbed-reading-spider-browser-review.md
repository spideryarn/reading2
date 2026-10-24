# Browser verification availability

2026-10-24. Nonce LOGO-BROWSER-261024. Parent dispatched the prescribed Sonnet browser specialist with the local app at `http://127.0.0.1:5286`, using `scripts/run-claude.ts --model sonnet --access write --mcp`. Wrapper exited 0 and returned a report.

The specialist reported that no Claude-in-Chrome tools, including `list_connected_browsers`, were exposed. It never reached the handshake, opened no page, made no edits and did not substitute another automation mechanism. Consequently landing header/footer, app themes, `/design`, Semaphore, reduced motion, console errors and installed-icon appearance were **not verified in a live browser**.

This is an environment limitation, not a passing browser check. The available evidence is the deterministic size/theme preview, canvas motion/rest proof, focused component/pixel tests and build recorded in the [plan](261024a-eight-limbed-reading-spider-brand-assets.md). The connection procedure is [claude-in-chrome.md](../reusable/claude-in-chrome.md).

## Live check after the deploy, 2026-10-24

The check above was later run against production, after deploy `dpl_8cfeUip2yTU6pZrXyQ6G5emCa5T8`
(`e7be80a9`), by a Sonnet subagent using Playwright on the box's system Chrome, signed out, for
report `spya-krx3dz` ([its note](../user-feedback/261024_1458-the-reading-spider-icon-is-live.md)).
On `/` and `/changelog`, the header showed the new mark at 20px, and it stayed whole at rest,
mid-hover and with reduced motion. The `<head>` icon links, the manifest and its icons, and
`og:image` all returned 200 with the right types and sizes. The sha256 of every served brand file
matched `public/` at `17362a3d5`. There were no console errors.

Still not checked: a light-theme page (the signed-out pages are dark only), how a real tab strip
draws the 16px favicon, phone widths, and how an installed home-screen icon looks on a device. The
last of these is the physical-device check in [main-icon.md](../project/main-icon.md).
