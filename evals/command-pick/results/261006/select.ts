import { PHRASES } from "../../phrases.js";
const re = /remember|quiz|tutorial|explor|recall|learn|test me|ask me|flashcard|revis|study|memor|teach|chat|summar|gist|tl;?dr|debate|reception/i;
const ids = PHRASES.filter((p) => p.accept.some((a) => /learn|chat|summary|debate/.test(a)) || re.test(p.text)).map((p) => p.id);
console.log(ids.join(","));
console.log(ids.length);
