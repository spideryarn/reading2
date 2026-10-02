# 4 candidates for "Replication crisis"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-replication-crisis-spya-hrjamq.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-replication-crisis-spya-hrjamq-W.png

Scene:

```json
{
  "title": "Crisis diagnosed, then addressed",
  "caption": "The piece is a chain: concepts set up, a crisis is named, evidence piles up across fields, two clusters of causes are diagnosed, then responses and reforms follow in turn — a funnel-then-chain shape ending in broader rethinking.",
  "scenes": [
    {
      "id": "overview",
      "title": "Replication crisis: overview",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "concepts",
          "shape": "box",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 80,
          "text": "Defining replication & the statistics behind it",
          "size": "md",
          "detail": "Reproducibility, effect size, power, p-values.",
          "block": "spya-kv0w8d"
        },
        {
          "kind": "node",
          "id": "origins",
          "shape": "box",
          "x": 280,
          "y": 150,
          "w": 220,
          "h": 70,
          "text": "Early-2010s failures name 'the crisis'",
          "size": "md",
          "block": "spya-yru28f",
          "opens": "inside-origins"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 260,
          "w": 712,
          "h": 220,
          "style": "band",
          "label": "EVIDENCE ACROSS FIELDS",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "psych",
          "shape": "box",
          "x": 48,
          "y": 300,
          "w": 150,
          "h": 70,
          "text": "Psychology: 36-50% replicate",
          "size": "sm",
          "tone": 1,
          "block": "spya-bha57y"
        },
        {
          "kind": "node",
          "id": "medcancer",
          "shape": "box",
          "x": 220,
          "y": 300,
          "w": 150,
          "h": 70,
          "text": "Cancer biology: as low as 11%",
          "size": "sm",
          "tone": 1,
          "block": "spya-esjmns"
        },
        {
          "kind": "node",
          "id": "otherfields",
          "shape": "box",
          "x": 392,
          "y": 300,
          "w": 150,
          "h": 70,
          "text": "Economics, nutrition, water science shaky too",
          "size": "sm",
          "tone": 1,
          "block": "spya-acfh3t"
        },
        {
          "kind": "node",
          "id": "llm",
          "shape": "box",
          "x": 564,
          "y": 300,
          "w": 150,
          "h": 70,
          "text": "LLM research: new reproducibility hazards",
          "size": "sm",
          "tone": 1,
          "block": "spya-ypznph"
        },
        {
          "kind": "node",
          "id": "surveys",
          "shape": "box",
          "x": 220,
          "y": 400,
          "w": 300,
          "h": 60,
          "text": "Surveys: most scientists fail to reproduce others' work",
          "size": "sm",
          "tone": 1,
          "block": "spya-fuynra"
        },
        {
          "kind": "node",
          "id": "causes",
          "shape": "diamond",
          "x": 280,
          "y": 520,
          "w": 220,
          "h": 100,
          "text": "Why so much fails to replicate?",
          "size": "md",
          "block": "spya-sy87zk"
        },
        {
          "kind": "node",
          "id": "pubsystem",
          "shape": "hex",
          "x": 100,
          "y": 660,
          "w": 200,
          "h": 80,
          "text": "Publication system rewards flash over rigor",
          "size": "sm",
          "tone": 2,
          "block": "spya-d040tg"
        },
        {
          "kind": "node",
          "id": "statpractice",
          "shape": "hex",
          "x": 460,
          "y": 660,
          "w": 200,
          "h": 80,
          "text": "Weak power, p-hacking, shaky statistics",
          "size": "sm",
          "tone": 2,
          "block": "spya-bfx638",
          "opens": "inside-statistics"
        },
        {
          "kind": "node",
          "id": "perception",
          "shape": "box",
          "x": 280,
          "y": 790,
          "w": 220,
          "h": 70,
          "text": "Public trust & academic backlash",
          "size": "md",
          "block": "spya-qht6nk"
        },
        {
          "kind": "node",
          "id": "reform",
          "shape": "box",
          "x": 280,
          "y": 900,
          "w": 220,
          "h": 70,
          "text": "Reforms: preregistration, result-blind review, smaller p-values",
          "size": "md",
          "block": "spya-h32yv9"
        },
        {
          "kind": "node",
          "id": "broader",
          "shape": "box",
          "x": 280,
          "y": 1010,
          "w": 220,
          "h": 90,
          "text": "Broader change: triangulation, new theories, open science",
          "size": "md",
          "block": "spya-hc3p7c"
        },
        {
          "kind": "edge",
          "from": "concepts",
          "to": "origins",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "surveys",
          "to": "causes",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "causes",
          "to": "pubsystem",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "causes",
          "to": "statpractice",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pubsystem",
          "to": "perception",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "statpractice",
          "to": "perception",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "perception",
          "to": "reform",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "reform",
          "to": "broader",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Down the page follows the article's own order: define terms, name the crisis, show the evidence, diagnose two clusters of causes, then trace the responses and reforms that followed."
    },
    {
      "id": "inside-origins",
      "title": "How the crisis got its name",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "priming",
          "shape": "box",
          "x": 40,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Social priming studies fail to replicate",
          "size": "sm",
          "tone": 1,
          "block": "spya-t3scy3"
        },
        {
          "kind": "node",
          "id": "esp",
          "shape": "box",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Bem's ESP studies debunked",
          "size": "sm",
          "tone": 1,
          "block": "spya-vux5b3"
        },
        {
          "kind": "node",
          "id": "biomed",
          "shape": "box",
          "x": 520,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Amgen/Bayer: 11-20% of cancer findings replicate",
          "size": "sm",
          "tone": 1,
          "block": "spya-yj72uc"
        },
        {
          "kind": "node",
          "id": "phack",
          "shape": "box",
          "x": 280,
          "y": 150,
          "w": 200,
          "h": 70,
          "text": "P-hacking studies expose common bad practice",
          "size": "sm",
          "tone": 1,
          "block": "spya-t3us9w"
        },
        {
          "kind": "node",
          "id": "named",
          "shape": "ellipse",
          "x": 280,
          "y": 260,
          "w": 220,
          "h": 80,
          "text": "'Crisis of confidence' declared",
          "size": "md",
          "block": "spya-dg8j93"
        },
        {
          "kind": "node",
          "id": "older",
          "shape": "note",
          "x": 40,
          "y": 380,
          "w": 280,
          "h": 80,
          "text": "Concerns actually go back to the 1960s-90s",
          "size": "sm",
          "block": "spya-z3zj97"
        },
        {
          "kind": "node",
          "id": "spellman",
          "shape": "box",
          "x": 380,
          "y": 380,
          "w": 300,
          "h": 80,
          "text": "Spellman: tech & a bigger field turned old worries into full crisis",
          "size": "sm",
          "block": "spya-ytj90k"
        },
        {
          "kind": "node",
          "id": "power",
          "shape": "box",
          "x": 200,
          "y": 500,
          "w": 360,
          "h": 80,
          "text": "Chronic low statistical power noted since 1962, ignored for 50 years",
          "size": "sm",
          "block": "spya-u3tg84"
        },
        {
          "kind": "edge",
          "from": "priming",
          "to": "named",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "esp",
          "to": "named",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "biomed",
          "to": "named",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "phack",
          "to": "named",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "named",
          "to": "older",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "named",
          "to": "spellman",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spellman",
          "to": "power",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "older",
          "to": "power",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain: several independent replication failures accumulated in the early 2010s, which together prompted declarations of crisis, even though concerns had simmered for decades beforehand."
    },
    {
      "id": "inside-statistics",
      "title": "Statistical and practice causes",
      "height": 820,
      "items": [
        {
          "kind": "node",
          "id": "qrp",
          "shape": "box",
          "x": 40,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Questionable research practices inflate false positives",
          "size": "sm",
          "tone": 2,
          "block": "spya-bfx638"
        },
        {
          "kind": "node",
          "id": "lowpower",
          "shape": "box",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Low power (~20-35%) across fields",
          "size": "sm",
          "tone": 2,
          "block": "spya-p7pun6"
        },
        {
          "kind": "node",
          "id": "posbias",
          "shape": "box",
          "x": 520,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Underpowered studies inflate effect sizes",
          "size": "sm",
          "tone": 2,
          "block": "spya-nqwfh4"
        },
        {
          "kind": "node",
          "id": "meta",
          "shape": "box",
          "x": 40,
          "y": 160,
          "w": 200,
          "h": 80,
          "text": "Meta-analysis has its own flaws",
          "size": "sm",
          "tone": 2,
          "block": "spya-z2xbqp"
        },
        {
          "kind": "node",
          "id": "forking",
          "shape": "box",
          "x": 280,
          "y": 160,
          "w": 200,
          "h": 80,
          "text": "Forking paths & optional stopping p-hack results",
          "size": "sm",
          "tone": 2,
          "block": "spya-qsad7n"
        },
        {
          "kind": "node",
          "id": "heterog",
          "shape": "box",
          "x": 520,
          "y": 160,
          "w": 200,
          "h": 80,
          "text": "Statistical heterogeneity: effects genuinely vary",
          "size": "sm",
          "tone": 2,
          "block": "spya-ngbkx2"
        },
        {
          "kind": "node",
          "id": "context",
          "shape": "box",
          "x": 160,
          "y": 280,
          "w": 200,
          "h": 80,
          "text": "Context sensitivity & hidden moderators",
          "size": "sm",
          "tone": 2,
          "block": "spya-z4db8z"
        },
        {
          "kind": "node",
          "id": "bayes",
          "shape": "box",
          "x": 400,
          "y": 280,
          "w": 200,
          "h": 80,
          "text": "Bayesian view: p<0.05 implies low replication odds",
          "size": "sm",
          "tone": 2,
          "block": "spya-pytr5c"
        },
        {
          "kind": "node",
          "id": "nhst",
          "shape": "box",
          "x": 280,
          "y": 400,
          "w": 240,
          "h": 90,
          "text": "Null hypothesis testing poorly suited to soft sciences",
          "size": "md",
          "tone": 2,
          "block": "spya-h9wzrk"
        },
        {
          "kind": "node",
          "id": "unreplicable",
          "shape": "ellipse",
          "x": 280,
          "y": 540,
          "w": 240,
          "h": 80,
          "text": "Many published effects do not actually replicate",
          "size": "md"
        },
        {
          "kind": "edge",
          "from": "qrp",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lowpower",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "posbias",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "meta",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "forking",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "heterog",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "context",
          "to": "unreplicable",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bayes",
          "to": "nhst",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "nhst",
          "to": "unreplicable",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A converge: several independent statistical weaknesses — low power, biased effect sizes, meta-analysis flaws, forking paths, heterogeneity, context sensitivity, and misread p-values — all push toward the same outcome, findings that fail to replicate."
    }
  ]
}
```

## Candidate X

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-replication-crisis-spya-hrjamq-X.png

Scene:

```json
{
  "title": "chain with converging causes",
  "caption": "The piece runs as one long chain in time—from defining the crisis and its statistics, through its 2010s origins and the evidence across fields, into two converging clusters of causes, then out to public reaction and a spine of reforms—so the diagram is a chain with two zoom-able cause clusters in the middle.",
  "scenes": [
    {
      "id": "overview",
      "title": "Replication crisis: overview",
      "height": 1280,
      "items": [
        {
          "kind": "node",
          "id": "def",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 200,
          "h": 70,
          "text": "What the crisis is",
          "size": "md",
          "sub": "+ key statistics",
          "block": "spya-kv0w8d"
        },
        {
          "kind": "node",
          "id": "origins",
          "shape": "box",
          "x": 280,
          "y": 140,
          "w": 200,
          "h": 70,
          "text": "Early-2010s failures name the crisis",
          "size": "sm",
          "block": "spya-yru28f"
        },
        {
          "kind": "node",
          "id": "evidence",
          "shape": "box",
          "x": 280,
          "y": 250,
          "w": 200,
          "h": 80,
          "text": "Across fields, only ~half of findings replicate",
          "size": "sm",
          "sub": "psych, medicine, econ, LLMs...",
          "block": "spya-bha57y"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 370,
          "w": 330,
          "h": 260,
          "style": "band",
          "label": "CAUSES: PUBLICATION SYSTEM",
          "tone": 1,
          "muted": true
        },
        {
          "kind": "node",
          "id": "pubbias",
          "shape": "hex",
          "x": 60,
          "y": 420,
          "w": 250,
          "h": 70,
          "text": "Publication bias hides null results",
          "size": "sm",
          "tone": 1,
          "block": "spya-d040tg"
        },
        {
          "kind": "node",
          "id": "incentive",
          "shape": "hex",
          "x": 60,
          "y": 520,
          "w": 250,
          "h": 70,
          "text": "\"Publish or perish\" rewards flash over rigor",
          "size": "sm",
          "tone": 1,
          "block": "spya-h2nvfj"
        },
        {
          "kind": "region",
          "x": 390,
          "y": 370,
          "w": 346,
          "h": 260,
          "style": "band",
          "label": "CAUSES: RESEARCH & STATISTICS",
          "tone": 2,
          "muted": true
        },
        {
          "kind": "node",
          "id": "qrp",
          "shape": "hex",
          "x": 420,
          "y": 420,
          "w": 280,
          "h": 70,
          "text": "Flexible choices inflate false positives",
          "size": "sm",
          "sub": "questionable research practices",
          "tone": 2,
          "block": "spya-bfx638"
        },
        {
          "kind": "node",
          "id": "power",
          "shape": "hex",
          "x": 420,
          "y": 520,
          "w": 280,
          "h": 70,
          "text": "Chronically low statistical power (~20-35%)",
          "size": "sm",
          "tone": 2,
          "block": "spya-p7pun6"
        },
        {
          "kind": "node",
          "id": "perception",
          "shape": "box",
          "x": 280,
          "y": 660,
          "w": 200,
          "h": 80,
          "text": "Public mostly unaware; academics clash openly",
          "size": "sm",
          "block": "spya-qht6nk"
        },
        {
          "kind": "node",
          "id": "reform",
          "shape": "box",
          "x": 280,
          "y": 780,
          "w": 200,
          "h": 80,
          "text": "Metascience reforms: preregistration, result-blind review, smaller p-values",
          "size": "sm",
          "block": "spya-h32yv9"
        },
        {
          "kind": "node",
          "id": "broader",
          "shape": "box",
          "x": 280,
          "y": 900,
          "w": 200,
          "h": 90,
          "text": "Funding, education, triangulation, theory-revision",
          "size": "sm",
          "block": "spya-hc3p7c"
        },
        {
          "kind": "node",
          "id": "seealso",
          "shape": "note",
          "x": 280,
          "y": 1030,
          "w": 200,
          "h": 60,
          "text": "See also & references",
          "size": "xs",
          "muted": true,
          "block": "spya-wc96k8"
        },
        {
          "kind": "edge",
          "from": "def",
          "to": "origins",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "origins",
          "to": "evidence",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "evidence",
          "to": "pubbias",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "evidence",
          "to": "qrp",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pubbias",
          "to": "incentive",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "qrp",
          "to": "power",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "incentive",
          "to": "perception",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "power",
          "to": "perception",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "perception",
          "to": "reform",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "reform",
          "to": "broader",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "broader",
          "to": "seealso",
          "via": "straight",
          "line": "dashed",
          "arrow": "none"
        }
      ],
      "caption": "A chain from definition through origins and evidence, into two clusters of causes, then outward to response and reform."
    },
    {
      "id": "inside-publication-causes",
      "title": "Causes: the publication system",
      "height": 720,
      "items": [
        {
          "kind": "node",
          "id": "hist",
          "shape": "box",
          "x": 40,
          "y": 40,
          "w": 300,
          "h": 80,
          "text": "Explosive growth + commodification of science",
          "size": "sm",
          "block": "spya-sy87zk"
        },
        {
          "kind": "node",
          "id": "bias2",
          "shape": "box",
          "x": 40,
          "y": 160,
          "w": 300,
          "h": 80,
          "text": "Positive results get published, nulls vanish into the 'file drawer'",
          "size": "sm",
          "block": "spya-d040tg"
        },
        {
          "kind": "node",
          "id": "matherr",
          "shape": "box",
          "x": 40,
          "y": 280,
          "w": 300,
          "h": 80,
          "text": "Even top journals contain frequent statistical errors",
          "size": "sm",
          "block": "spya-xxd5as"
        },
        {
          "kind": "node",
          "id": "ppp",
          "shape": "box",
          "x": 40,
          "y": 400,
          "w": 300,
          "h": 80,
          "text": "Career pressure rewards volume over validity",
          "size": "sm",
          "block": "spya-h2nvfj"
        },
        {
          "kind": "node",
          "id": "report",
          "shape": "box",
          "x": 40,
          "y": 520,
          "w": 300,
          "h": 80,
          "text": "Methods often too sparse to redo the study",
          "size": "sm",
          "block": "spya-wjstmr"
        },
        {
          "kind": "node",
          "id": "result",
          "shape": "ellipse",
          "x": 420,
          "y": 280,
          "w": 260,
          "h": 90,
          "text": "Many published findings cannot be reproduced",
          "size": "md"
        },
        {
          "kind": "edge",
          "from": "hist",
          "to": "bias2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias2",
          "to": "matherr",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "matherr",
          "to": "ppp",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ppp",
          "to": "report",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias2",
          "to": "result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "matherr",
          "to": "result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ppp",
          "to": "result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "report",
          "to": "result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A converging set of structural flaws in how science gets published, each feeding the next, all pushing toward unreplicable findings."
    },
    {
      "id": "inside-stats-causes",
      "title": "Causes: research practice and statistics",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "qrp2",
          "shape": "hex",
          "x": 40,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "Flexible analysis choices inflate false positives",
          "size": "sm",
          "block": "spya-bfx638"
        },
        {
          "kind": "node",
          "id": "power2",
          "shape": "hex",
          "x": 40,
          "y": 140,
          "w": 300,
          "h": 70,
          "text": "Power averages only ~20-35% across fields",
          "size": "sm",
          "block": "spya-p7pun6"
        },
        {
          "kind": "node",
          "id": "bias3",
          "shape": "hex",
          "x": 40,
          "y": 240,
          "w": 300,
          "h": 70,
          "text": "Underpowered studies inflate effect sizes",
          "size": "sm",
          "block": "spya-nqwfh4"
        },
        {
          "kind": "node",
          "id": "meta",
          "shape": "hex",
          "x": 40,
          "y": 340,
          "w": 300,
          "h": 70,
          "text": "Meta-analysis has its own fragile methods",
          "size": "sm",
          "block": "spya-z2xbqp"
        },
        {
          "kind": "node",
          "id": "forking",
          "shape": "hex",
          "x": 40,
          "y": 440,
          "w": 300,
          "h": 70,
          "text": "Many defensible analysis paths let p-hacking creep in unnoticed",
          "size": "sm",
          "block": "spya-qsad7n"
        },
        {
          "kind": "node",
          "id": "heterog",
          "shape": "hex",
          "x": 40,
          "y": 540,
          "w": 300,
          "h": 70,
          "text": "Effects genuinely vary study to study",
          "size": "sm",
          "block": "spya-ngbkx2"
        },
        {
          "kind": "node",
          "id": "context",
          "shape": "hex",
          "x": 40,
          "y": 640,
          "w": 300,
          "h": 70,
          "text": "Hidden context shifts change results",
          "size": "sm",
          "block": "spya-z4db8z"
        },
        {
          "kind": "node",
          "id": "bayes",
          "shape": "diamond",
          "x": 420,
          "y": 240,
          "w": 260,
          "h": 100,
          "text": "p<0.05 implies less than assumed",
          "size": "sm",
          "block": "spya-pytr5c"
        },
        {
          "kind": "node",
          "id": "nhst",
          "shape": "note",
          "x": 420,
          "y": 400,
          "w": 260,
          "h": 90,
          "text": "Null hypothesis testing may be ill-suited to 'soft' sciences",
          "size": "sm",
          "block": "spya-h9wzrk"
        },
        {
          "kind": "edge",
          "from": "qrp2",
          "to": "power2",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "power2",
          "to": "bias3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias3",
          "to": "meta",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "meta",
          "to": "forking",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "forking",
          "to": "heterog",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "heterog",
          "to": "context",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "power2",
          "to": "bayes",
          "via": "curve",
          "line": "dotted",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bayes",
          "to": "nhst",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several independent statistical weaknesses converge on the same outcome: findings that look solid but will not replicate."
    }
  ]
}
```

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-replication-crisis-spya-hrjamq-Y.png

Scene:

```json
{
  "title": "Funnel, fork, loop",
  "caption": "A funnel into definitions narrows to the named crisis, which chains into evidence, forks into two parallel columns of causes (publication system vs. research practices/statistics), then converges into responses and reforms, looping back at the end to the idea that replication should revise theory rather than just confirm it.",
  "scenes": [
    {
      "id": "overview",
      "title": "The replication crisis: shape of the argument",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "def",
          "shape": "ellipse",
          "x": 270,
          "y": 30,
          "w": 220,
          "h": 80,
          "text": "Published findings often fail to reproduce",
          "size": "md",
          "block": "spya-kv0w8d"
        },
        {
          "kind": "node",
          "id": "stats",
          "shape": "box",
          "x": 270,
          "y": 150,
          "w": 220,
          "h": 70,
          "text": "Vocabulary: power, effect size, p-value",
          "size": "sm",
          "block": "spya-cxcn8h"
        },
        {
          "kind": "node",
          "id": "origins",
          "shape": "box",
          "x": 270,
          "y": 260,
          "w": 220,
          "h": 70,
          "text": "Early-2010s failures name the 'crisis'",
          "size": "sm",
          "block": "spya-yru28f"
        },
        {
          "kind": "node",
          "id": "evidence",
          "shape": "box",
          "x": 270,
          "y": 370,
          "w": 220,
          "h": 70,
          "text": "~Half of findings fail across fields",
          "size": "md",
          "block": "spya-bha57y"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 480,
          "w": 320,
          "h": 260,
          "style": "band",
          "label": "CAUSES: PUBLISHING SYSTEM",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "pub",
          "shape": "box",
          "x": 70,
          "y": 540,
          "w": 260,
          "h": 80,
          "text": "Bias, sloppy errors, publish-or-perish",
          "size": "sm",
          "tone": 1,
          "block": "spya-sy87zk"
        },
        {
          "kind": "region",
          "x": 400,
          "y": 480,
          "w": 320,
          "h": 260,
          "style": "band",
          "label": "CAUSES: RESEARCH PRACTICE & STATS",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "rp",
          "shape": "box",
          "x": 430,
          "y": 540,
          "w": 260,
          "h": 80,
          "text": "Low power, p-hacking, bad null tests",
          "size": "sm",
          "tone": 2,
          "block": "spya-bfx638"
        },
        {
          "kind": "node",
          "id": "public",
          "shape": "box",
          "x": 270,
          "y": 780,
          "w": 220,
          "h": 70,
          "text": "Public trust and academic backlash",
          "size": "sm",
          "block": "spya-qht6nk"
        },
        {
          "kind": "node",
          "id": "reform",
          "shape": "box",
          "x": 270,
          "y": 890,
          "w": 220,
          "h": 70,
          "text": "Reforms: preregistration, review, p<0.005",
          "size": "sm",
          "block": "spya-h32yv9"
        },
        {
          "kind": "node",
          "id": "efforts",
          "shape": "box",
          "x": 270,
          "y": 1000,
          "w": 220,
          "h": 70,
          "text": "Funding, education, databases, collaboration",
          "size": "sm",
          "block": "spya-hc3p7c"
        },
        {
          "kind": "node",
          "id": "theory",
          "shape": "ellipse",
          "x": 270,
          "y": 1090,
          "w": 220,
          "h": 70,
          "text": "Replication should revise theory, not just confirm",
          "size": "md",
          "block": "spya-d4kvnh"
        },
        {
          "kind": "edge",
          "from": "def",
          "to": "stats",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "stats",
          "to": "origins",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "origins",
          "to": "evidence",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "evidence",
          "to": "pub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "evidence",
          "to": "rp",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pub",
          "to": "public",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rp",
          "to": "public",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "public",
          "to": "reform",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "reform",
          "to": "efforts",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "efforts",
          "to": "theory",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "theory:left",
          "to": "def:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "returns to the opening question, changed"
        }
      ],
      "caption": "Definitions narrow into a named crisis; evidence of failure feeds two parallel streams of cause (publishing system, research practice/statistics); both converge on institutional response and reform, which loops back to a call for better theory."
    },
    {
      "id": "inside-publishing",
      "title": "Inside: causes in the publishing system",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "hist",
          "shape": "box",
          "x": 270,
          "y": 30,
          "w": 260,
          "h": 70,
          "text": "Explosive growth, commodified science",
          "size": "sm",
          "block": "spya-sy87zk"
        },
        {
          "kind": "node",
          "id": "filedrawer",
          "shape": "box",
          "x": 270,
          "y": 140,
          "w": 260,
          "h": 70,
          "text": "Publication bias: null results go unpublished",
          "size": "sm",
          "block": "spya-d040tg"
        },
        {
          "kind": "node",
          "id": "matherr",
          "shape": "box",
          "x": 270,
          "y": 250,
          "w": 260,
          "h": 70,
          "text": "Even top journals contain math/stat errors",
          "size": "sm",
          "block": "spya-xxd5as"
        },
        {
          "kind": "node",
          "id": "ppp",
          "shape": "box",
          "x": 270,
          "y": 360,
          "w": 260,
          "h": 70,
          "text": "'Publish or perish' punishes replication work",
          "size": "sm",
          "block": "spya-h2nvfj"
        },
        {
          "kind": "node",
          "id": "reporting",
          "shape": "box",
          "x": 270,
          "y": 470,
          "w": 260,
          "h": 70,
          "text": "Missing methodological detail blocks redo",
          "size": "sm",
          "block": "spya-wjstmr"
        },
        {
          "kind": "node",
          "id": "result",
          "shape": "box",
          "x": 270,
          "y": 580,
          "w": 260,
          "h": 70,
          "text": "Result: flashy, unreplicable work gets published",
          "size": "md",
          "block": "spya-d040tg"
        },
        {
          "kind": "edge",
          "from": "hist",
          "to": "filedrawer",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "filedrawer",
          "to": "matherr",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "matherr",
          "to": "ppp",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ppp",
          "to": "reporting",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "reporting",
          "to": "result",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain showing how the structure of publishing itself—incentives, bias, sloppiness—discourages reliable science, each problem feeding the next."
    },
    {
      "id": "inside-research-practice",
      "title": "Inside: causes in research practice and statistics",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "qrp",
          "shape": "box",
          "x": 40,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Questionable practices: HARKing, data dredging",
          "size": "sm",
          "block": "spya-bfx638"
        },
        {
          "kind": "node",
          "id": "power",
          "shape": "box",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Chronic low power (~20-35%)",
          "size": "sm",
          "block": "spya-p7pun6"
        },
        {
          "kind": "node",
          "id": "bias",
          "shape": "box",
          "x": 520,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Underpowered studies inflate effect sizes",
          "size": "sm",
          "block": "spya-nqwfh4"
        },
        {
          "kind": "node",
          "id": "meta",
          "shape": "box",
          "x": 40,
          "y": 180,
          "w": 200,
          "h": 80,
          "text": "Meta-analysis has its own flaws",
          "size": "sm",
          "block": "spya-z2xbqp"
        },
        {
          "kind": "node",
          "id": "forking",
          "shape": "box",
          "x": 280,
          "y": 180,
          "w": 200,
          "h": 80,
          "text": "Forking paths inflate false positives",
          "size": "sm",
          "block": "spya-qsad7n"
        },
        {
          "kind": "node",
          "id": "heterog",
          "shape": "box",
          "x": 520,
          "y": 180,
          "w": 200,
          "h": 80,
          "text": "High, unexplained heterogeneity",
          "size": "sm",
          "block": "spya-ngbkx2"
        },
        {
          "kind": "node",
          "id": "context",
          "shape": "box",
          "x": 40,
          "y": 320,
          "w": 200,
          "h": 80,
          "text": "Effects sensitive to hidden context",
          "size": "sm",
          "block": "spya-z4db8z"
        },
        {
          "kind": "node",
          "id": "bayes",
          "shape": "box",
          "x": 280,
          "y": 320,
          "w": 200,
          "h": 80,
          "text": "Bayes: p<0.05 implies less than assumed",
          "size": "sm",
          "block": "spya-pytr5c"
        },
        {
          "kind": "node",
          "id": "nhst",
          "shape": "box",
          "x": 520,
          "y": 320,
          "w": 200,
          "h": 80,
          "text": "Null hypothesis testing ill-suited to 'soft' science",
          "size": "sm",
          "block": "spya-h9wzrk"
        },
        {
          "kind": "node",
          "id": "conv",
          "shape": "box",
          "x": 270,
          "y": 470,
          "w": 240,
          "h": 80,
          "text": "Together: many published effects are genuinely unreplicable",
          "size": "md",
          "block": "spya-bfx638"
        },
        {
          "kind": "edge",
          "from": "qrp",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "power",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "meta",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "forking",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "heterog",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "context",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bayes",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "nhst",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several independent statistical and practical problems converge on the same outcome: findings that cannot be reproduced."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-replication-crisis-spya-hrjamq-Z.png

Scene:

```json
{
  "title": "Chain with two expansions",
  "caption": "A chain running from definitions through the crisis's origins and evidence to its causes, then its responses and reforms — each stage building on the one above it, with two crowded stages (causes, and responses/reform) expanded in their own views.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview: the replication crisis",
      "height": 1000,
      "items": [
        {
          "kind": "node",
          "id": "n1",
          "shape": "ellipse",
          "x": 230,
          "y": 30,
          "w": 300,
          "h": 70,
          "text": "Replication crisis: findings that won't reproduce",
          "size": "md",
          "block": "spya-kv0w8d"
        },
        {
          "kind": "node",
          "id": "n2",
          "shape": "hex",
          "x": 230,
          "y": 130,
          "w": 300,
          "h": 70,
          "text": "Vocabulary: p-values, power, effect size",
          "size": "sm",
          "block": "spya-cxcn8h"
        },
        {
          "kind": "node",
          "id": "n3",
          "shape": "box",
          "x": 230,
          "y": 230,
          "w": 300,
          "h": 70,
          "text": "Early-2010s failures (priming, ESP, cancer) spark the crisis",
          "size": "sm",
          "block": "spya-yru28f"
        },
        {
          "kind": "node",
          "id": "n4",
          "shape": "box",
          "x": 230,
          "y": 330,
          "w": 300,
          "h": 70,
          "text": "Across fields, roughly half of findings fail to replicate",
          "size": "sm",
          "block": "spya-bha57y"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 430,
          "w": 712,
          "h": 180,
          "style": "band",
          "label": "WHY REPLICATION FAILS",
          "opens": "inside-causes",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "n5",
          "shape": "box",
          "x": 70,
          "y": 470,
          "w": 280,
          "h": 100,
          "text": "Publication system rewards flashy, positive results",
          "size": "sm",
          "tone": 1,
          "block": "spya-d040tg"
        },
        {
          "kind": "node",
          "id": "n6",
          "shape": "box",
          "x": 410,
          "y": 470,
          "w": 280,
          "h": 100,
          "text": "Weak methods, low power, and shaky statistics",
          "size": "sm",
          "tone": 1,
          "block": "spya-bfx638"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 630,
          "w": 712,
          "h": 330,
          "style": "band",
          "label": "RESPONSES & REFORM",
          "opens": "inside-responses",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "n7",
          "shape": "box",
          "x": 230,
          "y": 670,
          "w": 300,
          "h": 80,
          "text": "Public trust and academic backlash",
          "size": "sm",
          "tone": 2,
          "block": "spya-qht6nk"
        },
        {
          "kind": "node",
          "id": "n8",
          "shape": "box",
          "x": 230,
          "y": 770,
          "w": 300,
          "h": 80,
          "text": "Reforms: transparency, preregistration, stricter stats",
          "size": "sm",
          "tone": 2,
          "block": "spya-h32yv9"
        },
        {
          "kind": "node",
          "id": "n9",
          "shape": "box",
          "x": 230,
          "y": 870,
          "w": 300,
          "h": 80,
          "text": "Building infrastructure, rethinking science itself",
          "size": "sm",
          "tone": 2,
          "block": "spya-hc3p7c"
        },
        {
          "kind": "edge",
          "from": "n1",
          "to": "n2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n2",
          "to": "n3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n3",
          "to": "n4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n4",
          "to": "n5",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n4",
          "to": "n6",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n5",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n6",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n7",
          "to": "n8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n8",
          "to": "n9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain: define the problem, trace its outbreak, survey the evidence, diagnose two kinds of cause, then follow the reactions — public, academic, and institutional — that try to fix it."
    },
    {
      "id": "inside-causes",
      "title": "Two kinds of cause",
      "height": 860,
      "items": [
        {
          "kind": "region",
          "x": 24,
          "y": 50,
          "w": 340,
          "h": 430,
          "style": "band",
          "label": "PUBLICATION SYSTEM",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "c1",
          "shape": "box",
          "x": 50,
          "y": 100,
          "w": 290,
          "h": 80,
          "text": "Publication bias: only positive results get published",
          "size": "sm",
          "tone": 1,
          "block": "spya-d040tg"
        },
        {
          "kind": "node",
          "id": "c2",
          "shape": "box",
          "x": 50,
          "y": 200,
          "w": 290,
          "h": 80,
          "text": "Even top journals contain frequent math/stats errors",
          "size": "sm",
          "tone": 1,
          "block": "spya-xxd5as"
        },
        {
          "kind": "node",
          "id": "c3",
          "shape": "box",
          "x": 50,
          "y": 300,
          "w": 290,
          "h": 80,
          "text": "'Publish or perish' discourages doing replications",
          "size": "sm",
          "tone": 1,
          "block": "spya-h2nvfj"
        },
        {
          "kind": "node",
          "id": "c4",
          "shape": "box",
          "x": 50,
          "y": 400,
          "w": 290,
          "h": 80,
          "text": "Papers often lack detail needed to redo the study",
          "size": "sm",
          "tone": 1,
          "block": "spya-wjstmr"
        },
        {
          "kind": "region",
          "x": 396,
          "y": 50,
          "w": 340,
          "h": 740,
          "style": "band",
          "label": "RESEARCH PRACTICES & STATISTICS",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "c5",
          "shape": "box",
          "x": 420,
          "y": 100,
          "w": 290,
          "h": 70,
          "text": "Flexible choices (HARKing, selective reporting) inflate false positives",
          "size": "sm",
          "tone": 3,
          "block": "spya-bfx638"
        },
        {
          "kind": "node",
          "id": "c6",
          "shape": "box",
          "x": 420,
          "y": 190,
          "w": 290,
          "h": 70,
          "text": "Chronically low statistical power (~20-35%)",
          "size": "sm",
          "tone": 3,
          "block": "spya-p7pun6"
        },
        {
          "kind": "node",
          "id": "c7",
          "shape": "box",
          "x": 420,
          "y": 280,
          "w": 290,
          "h": 70,
          "text": "Underpowered studies overstate effect sizes",
          "size": "sm",
          "tone": 3,
          "block": "spya-nqwfh4"
        },
        {
          "kind": "node",
          "id": "c8",
          "shape": "box",
          "x": 420,
          "y": 370,
          "w": 290,
          "h": 70,
          "text": "Meta-analysis has its own vulnerabilities",
          "size": "sm",
          "tone": 3,
          "block": "spya-z2xbqp"
        },
        {
          "kind": "node",
          "id": "c9",
          "shape": "box",
          "x": 420,
          "y": 460,
          "w": 290,
          "h": 70,
          "text": "P-hacking via many defensible 'forking paths'",
          "size": "sm",
          "tone": 3,
          "block": "spya-qsad7n"
        },
        {
          "kind": "node",
          "id": "c10",
          "shape": "box",
          "x": 420,
          "y": 550,
          "w": 290,
          "h": 70,
          "text": "High, often unexplained variation across studies",
          "size": "sm",
          "tone": 3,
          "block": "spya-ngbkx2"
        },
        {
          "kind": "node",
          "id": "c11",
          "shape": "box",
          "x": 420,
          "y": 640,
          "w": 290,
          "h": 70,
          "text": "Effects sensitive to hidden context replicate poorly",
          "size": "sm",
          "tone": 3,
          "block": "spya-z4db8z"
        },
        {
          "kind": "node",
          "id": "c12",
          "shape": "box",
          "x": 420,
          "y": 730,
          "w": 290,
          "h": 70,
          "text": "Null-hypothesis testing suits 'soft sciences' badly",
          "size": "sm",
          "tone": 3,
          "block": "spya-h9wzrk"
        }
      ],
      "caption": "Two parallel columns, not a sequence: failures in how science is published sit beside failures in how studies are designed and analyzed, each sufficient on its own to make findings unreplicable."
    },
    {
      "id": "inside-responses",
      "title": "Public reaction, then reform, then broader change",
      "height": 980,
      "items": [
        {
          "kind": "node",
          "id": "r1",
          "shape": "box",
          "x": 230,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "Public mostly unaware, sees replication as quality control",
          "size": "sm",
          "block": "spya-qht6nk"
        },
        {
          "kind": "node",
          "id": "r2",
          "shape": "box",
          "x": 230,
          "y": 130,
          "w": 300,
          "h": 70,
          "text": "Academics clash: reformers vs 'methodological terrorists'",
          "size": "sm",
          "block": "spya-rx27qq"
        },
        {
          "kind": "node",
          "id": "r3",
          "shape": "box",
          "x": 230,
          "y": 220,
          "w": 300,
          "h": 70,
          "text": "Framed as a 'credibility revolution'",
          "size": "sm",
          "block": "spya-n0zj55"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 310,
          "w": 712,
          "h": 330,
          "style": "band",
          "label": "REFORMS IN PUBLISHING",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "r4",
          "shape": "box",
          "x": 50,
          "y": 350,
          "w": 200,
          "h": 70,
          "text": "Clearer reporting of methods required",
          "size": "xs",
          "tone": 2,
          "block": "spya-bzdyqn"
        },
        {
          "kind": "node",
          "id": "r5",
          "shape": "box",
          "x": 280,
          "y": 350,
          "w": 200,
          "h": 70,
          "text": "Result-blind review at 140+ journals",
          "size": "xs",
          "tone": 2,
          "block": "spya-wv05ca"
        },
        {
          "kind": "node",
          "id": "r6",
          "shape": "box",
          "x": 510,
          "y": 350,
          "w": 200,
          "h": 70,
          "text": "Preregistration locks in methods early",
          "size": "xs",
          "tone": 2,
          "block": "spya-wraexy"
        },
        {
          "kind": "node",
          "id": "r7",
          "shape": "box",
          "x": 50,
          "y": 450,
          "w": 200,
          "h": 70,
          "text": "Proposal: lower significance to p<0.005",
          "size": "xs",
          "tone": 2,
          "block": "spya-pge7t0"
        },
        {
          "kind": "node",
          "id": "r8",
          "shape": "box",
          "x": 280,
          "y": 450,
          "w": 200,
          "h": 70,
          "text": "Larger samples, cross-validation urged",
          "size": "xs",
          "tone": 2,
          "block": "spya-vnwm97"
        },
        {
          "kind": "node",
          "id": "r9",
          "shape": "box",
          "x": 510,
          "y": 450,
          "w": 200,
          "h": 70,
          "text": "Funders back replication, metascience centers",
          "size": "xs",
          "tone": 2,
          "block": "spya-hc3p7c"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 660,
          "w": 712,
          "h": 200,
          "style": "band",
          "label": "BROADER CHANGE",
          "tone": 4
        },
        {
          "kind": "node",
          "id": "r10",
          "shape": "box",
          "x": 150,
          "y": 710,
          "w": 230,
          "h": 80,
          "text": "Triangulate across methods, not just replicate",
          "size": "sm",
          "tone": 4,
          "block": "spya-sbakqy"
        },
        {
          "kind": "node",
          "id": "r11",
          "shape": "box",
          "x": 410,
          "y": 710,
          "w": 230,
          "h": 80,
          "text": "Replication should build revised, stronger theories",
          "size": "sm",
          "tone": 4,
          "block": "spya-d4kvnh"
        },
        {
          "kind": "edge",
          "from": "r1",
          "to": "r2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r2",
          "to": "r3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A short chain (public reaction, academic clash, credibility revolution) opens into two grouped sets of parallel efforts: concrete publishing reforms, and broader changes to how science itself is practiced."
    }
  ]
}
```
