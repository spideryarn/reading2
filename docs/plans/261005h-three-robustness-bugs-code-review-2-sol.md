No blocking findings. **Both commits: ship**, subject to the full-suite and browser results still pending.

| Commit | Verdict |
|---|---|
| `26b87446f` | **ship** |
| `529d038ae` | **ship** |

- **D-1 — P2, established:** [Exact layout comparison](src/web/keynav.ts:162) can discard a useful clamped aim after an insignificant change. I reproduced this through the real arrow hook: target row 2, clamped offset 300, measured row 1; increasing only the target’s bottom by **1/64px** made the next ↓ repeat row 2 instead of reaching row 3. Changing only the controls bottom also reproduced it through the helpers. This is conservative invalidation under the chosen policy; spontaneous browser jitter remains unestablished. The tests cover substantial reflow and unchanged clamped layouts, but miss this boundary. Worth adding coverage before refining the predicate.

- **D-2 — P3, reasoned:** [Maths’ five-second grace](src/web/maths.ts:265) bounds the wait but cannot guarantee document replacement. A reload completing after that deadline could still encounter newly editable content. The delay is a reasonable fallback tradeoff, and the tests correctly verify it.

On the other doubts:

- **Completion geometry:** the scroll’s final move precedes `done`, and `endChain` reads the resulting rectangle synchronously. Fractional coordinates alone do not establish instability.
- **Controls movement:** invalidation is sensible when the reading position changes, but equality also rejects changes that leave it unchanged, as D-1 demonstrates.
- **Memo holder:** it carries navigation state, so retention matters to behavior. I found no demonstrated production eviction problem. Both effects depend on `chain` and clean up their listeners, observer and queued frame; replacement does not strand them.
- **Measurement state:** no render loop found. Invalidation forces one update; subsequent unchanged samples retain the previous object.
- **Server guards:** both preserve valid-tree behavior and safely treat missing lists as leaves. The added tests exercise the real projection and walker.

I independently ran all **12 requested test files: 337 tests passed**. The candidate diff passes whitespace checks. **No files changed.**