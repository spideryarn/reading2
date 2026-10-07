// Writes the brief for a session that takes items off the Overseer's queue.
// usage: node mkq.cjs QUEUE.json NAME "focus line" id1 id2 ...   (writes $OVERSEER_SCRATCH/brief-NAME.md)
const fs=require("fs");const [file,name,focus,...ids]=process.argv.slice(2);
const j=JSON.parse(fs.readFileSync(file,"utf8"));const a=Array.isArray(j)?j:(j.items||Object.values(j));
let out=`Overseer here. Greg, 2026-10-04, on the Overseer's list of small queued fixes: "If you're confident, address all of the Q-queue-yeses". The Overseer is, so these queue items are yours. Their text follows verbatim.\n\n${focus}\n`;
for(const id of ids){const it=a.find(x=>x.id===id);out+=`\n### ${id}: ${it.title}\n${it.text}\n${it.source?"source: "+it.source+"\n":""}`;}
out+=`
How to work:
- Follow docs/reusable/engineering-manager.md in a worktree: a short plan reviewed by GPT Sol, a Sol code review, a failing test seen red first for every defect, npm test and typecheck. Grep the reviewer's doc edits for "Greg" before committing (a write-capable reviewer once invented a Greg quote).
- Run git log on each area first; a sibling session may already have fixed part of it.
- One commit per item where practical. If an item turns out wrong, unneeded, or bigger than it looks, say so in the debrief rather than forcing it.
- For anything a reader sees, a browser check by a Sonnet subagent (read docs/project/browser-control.md first) at desktop, iPad and phone widths.
- Push to dev, remove the worktree after worktree:check, and message the Overseer a short debrief naming each item id and what happened to it, with any [Q-...] for Greg and a recommendation. Do not edit the queue. NEVER run npm run deploy.
`;
const dir=process.env.OVERSEER_SCRATCH;if(!dir){console.error("set OVERSEER_SCRATCH to the Overseer working directory; see scripts/overseer-tools/README.md");process.exit(1);}
fs.writeFileSync(`${dir}/brief-${name}.md`,out);console.log(name, out.length);
