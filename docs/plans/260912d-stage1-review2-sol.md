F12 — closed: server/browser text and skip rules agree for every named shape and namespace.

F13 — closed: all model-backed resolvers use the safe path; two careful matches return `null` without trying the forgiving pass.

F14 — closed: every actual handoff preserves the symbol. No JSON/`structuredClone`/whitelist copy occurs; introducing one would drop provenance unsafely.