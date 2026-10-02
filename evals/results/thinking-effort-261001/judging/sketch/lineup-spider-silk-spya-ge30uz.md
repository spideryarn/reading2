# 4 candidates for "Spider silk"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-spider-silk-spya-ge30uz.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-spider-silk-spya-ge30uz-W.png

Scene:

```json
{
  "title": "Spine with two branch-outs",
  "caption": "The article runs as one spine from what silk is, through its properties and natural uses, to how humans try to copy and then apply it — with the properties section fanning out into several measured traits that reconverge, and the artificial-synthesis section splitting into the two separate problems (protein and apparatus) that engineers must solve before silk becomes useful to people.",
  "scenes": [
    {
      "id": "overview",
      "title": "From spider biology to human use",
      "height": 1160,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 230,
          "y": 30,
          "w": 300,
          "h": 70,
          "text": "Silk serves many functions",
          "size": "md",
          "detail": "Spiders use silk for traps, restraint, signalling, nests, flight, and even food.",
          "tone": 1,
          "block": "spya-gp4t9x"
        },
        {
          "kind": "node",
          "id": "prop",
          "shape": "box",
          "x": 230,
          "y": 150,
          "w": 300,
          "h": 70,
          "text": "Properties: strength, toughness, stickiness",
          "size": "md",
          "detail": "A hierarchical molecular structure gives silk its mechanical and adhesive traits.",
          "tone": 1,
          "block": "spya-py9zw6"
        },
        {
          "kind": "region",
          "x": 20,
          "y": 260,
          "w": 720,
          "h": 160,
          "style": "band",
          "label": "PROPERTIES",
          "opens": "inside-properties",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "struct",
          "shape": "box",
          "x": 40,
          "y": 300,
          "w": 200,
          "h": 70,
          "text": "Hard crystals, stretchy matrix",
          "size": "sm",
          "tone": 1,
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "mech",
          "shape": "box",
          "x": 280,
          "y": 300,
          "w": 200,
          "h": 70,
          "text": "Strong, stretchy, tough fibres",
          "size": "sm",
          "tone": 1,
          "block": "spya-b0sewq"
        },
        {
          "kind": "node",
          "id": "adh",
          "shape": "box",
          "x": 520,
          "y": 300,
          "w": 200,
          "h": 70,
          "text": "Glue-like attachment discs",
          "size": "sm",
          "tone": 1,
          "block": "spya-m8z9e7"
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 230,
          "y": 460,
          "w": 300,
          "h": 70,
          "text": "Silk used for prey capture, nests, courtship",
          "size": "sm",
          "tone": 1,
          "block": "spya-rty5kb"
        },
        {
          "kind": "node",
          "id": "types",
          "shape": "box",
          "x": 230,
          "y": 560,
          "w": 300,
          "h": 70,
          "text": "Seven silk types, matched to glands",
          "size": "sm",
          "tone": 1,
          "block": "spya-hg7j7e"
        },
        {
          "kind": "node",
          "id": "spin",
          "shape": "hex",
          "x": 230,
          "y": 660,
          "w": 300,
          "h": 80,
          "text": "Spun on demand, not grown",
          "size": "sm",
          "detail": "Silk is pulled from glands as a liquid-to-solid phase change, not continuously grown.",
          "tone": 1,
          "block": "spya-g3h8qq"
        },
        {
          "kind": "node",
          "id": "art",
          "shape": "hex",
          "x": 230,
          "y": 770,
          "w": 300,
          "h": 80,
          "text": "Replicating silk in the lab",
          "size": "md",
          "detail": "Needs both the right protein and the right spinning apparatus.",
          "tone": 2,
          "block": "spya-d7d7m8",
          "opens": "inside-synthesis"
        },
        {
          "kind": "node",
          "id": "res",
          "shape": "note",
          "x": 230,
          "y": 880,
          "w": 300,
          "h": 70,
          "text": "Decades of research map silk's chemistry",
          "size": "sm",
          "tone": 2,
          "block": "spya-jvxbb8"
        },
        {
          "kind": "node",
          "id": "human",
          "shape": "box",
          "x": 230,
          "y": 980,
          "w": 300,
          "h": 70,
          "text": "Textiles, medicine, technology",
          "size": "sm",
          "tone": 2,
          "block": "spya-chy97m"
        },
        {
          "kind": "node",
          "id": "back",
          "shape": "note",
          "x": 230,
          "y": 1080,
          "w": 300,
          "h": 50,
          "text": "References & further resources",
          "size": "xs",
          "tone": 7,
          "block": "spya-jdybu5"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "prop",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "prop",
          "to": "struct",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "prop",
          "to": "mech",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "prop",
          "to": "adh",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "struct",
          "to": "uses",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mech",
          "to": "uses",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "adh",
          "to": "uses",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "uses",
          "to": "types",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "types",
          "to": "spin",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "art",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "art",
          "to": "res",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "res",
          "to": "human",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "human",
          "to": "back",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        }
      ],
      "caption": "Down the page follows the article's own order: what silk does for spiders, how it's built and performs, where it's used in nature, the gland types behind it, how spiders spin it, then how people try to copy and finally apply it."
    },
    {
      "id": "inside-properties",
      "title": "Properties: one structure, several measured traits",
      "height": 480,
      "items": [
        {
          "kind": "node",
          "id": "p-hub",
          "shape": "ellipse",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Structure shapes mechanical traits",
          "size": "md",
          "detail": "Crystalline beta-sheets plus an elastic amorphous matrix explain all the traits below.",
          "block": "spya-py9zw6"
        },
        {
          "kind": "node",
          "id": "p-struct",
          "shape": "box",
          "x": 30,
          "y": 200,
          "w": 210,
          "h": 80,
          "text": "Hard crystals, stretchy matrix",
          "size": "sm",
          "detail": "Alanine blocks form crystalline sheets; glycine-rich regions form the flexible matrix between them.",
          "tone": 1,
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "p-young",
          "shape": "box",
          "x": 275,
          "y": 200,
          "w": 210,
          "h": 80,
          "text": "Stiffness: Young's modulus",
          "size": "sm",
          "detail": "Spider silk is far more elastic than steel or Kevlar, which are stiffer but less yielding.",
          "tone": 2,
          "block": "spya-dq9b7q"
        },
        {
          "kind": "node",
          "id": "p-tensile",
          "shape": "box",
          "x": 520,
          "y": 200,
          "w": 210,
          "h": 80,
          "text": "Tensile strength rivals steel",
          "size": "sm",
          "detail": "Comparable to high-grade alloy steel, about half as strong as Kevlar fibres.",
          "tone": 2,
          "block": "spya-mhe2r5"
        },
        {
          "kind": "node",
          "id": "p-tough",
          "shape": "box",
          "x": 30,
          "y": 340,
          "w": 210,
          "h": 80,
          "text": "Toughness beats Kevlar",
          "size": "sm",
          "detail": "The combination of strength and stretch lets silk absorb more energy before breaking than aramid fibres.",
          "tone": 2,
          "block": "spya-gfykz5"
        },
        {
          "kind": "node",
          "id": "p-super",
          "shape": "box",
          "x": 275,
          "y": 340,
          "w": 210,
          "h": 80,
          "text": "Water causes supercontraction",
          "size": "sm",
          "detail": "Wet dragline silk can shrink by half in length and behave like a weak rubber.",
          "tone": 2,
          "block": "spya-qdjb0x"
        },
        {
          "kind": "node",
          "id": "p-adh",
          "shape": "box",
          "x": 520,
          "y": 340,
          "w": 210,
          "h": 80,
          "text": "Glue-like attachment discs",
          "size": "sm",
          "detail": "A separate adhesive secretion that sets instantly and stays usable indefinitely.",
          "tone": 3,
          "block": "spya-k8bh7d"
        },
        {
          "kind": "edge",
          "from": "p-hub",
          "to": "p-struct",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p-hub",
          "to": "p-young",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p-hub",
          "to": "p-tensile",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p-hub",
          "to": "p-tough",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p-hub",
          "to": "p-super",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p-hub",
          "to": "p-adh",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A hub-and-satellite picture: the layered molecular structure is a single central idea, and the measured traits (stiffness, strength, toughness, stretchiness under water, stickiness) are separate elaborations of it, not a sequence or a ranking."
    },
    {
      "id": "inside-synthesis",
      "title": "Artificial synthesis: two separate problems",
      "height": 640,
      "items": [
        {
          "kind": "node",
          "id": "s-hub",
          "shape": "ellipse",
          "x": 190,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "Two tasks: protein + apparatus",
          "size": "md",
          "detail": "Making artificial silk needs both the right unspun protein feedstock and a way to spin it.",
          "block": "spya-wgee6t"
        },
        {
          "kind": "node",
          "id": "s-feed",
          "shape": "box",
          "x": 60,
          "y": 160,
          "w": 260,
          "h": 70,
          "text": "Feedstock: copy the silk protein",
          "size": "sm",
          "tone": 1,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "s-geo",
          "shape": "box",
          "x": 400,
          "y": 160,
          "w": 260,
          "h": 70,
          "text": "Geometry: copy the spinning duct",
          "size": "sm",
          "tone": 2,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "s-feedex",
          "shape": "note",
          "x": 60,
          "y": 280,
          "w": 260,
          "h": 70,
          "text": "Drawn from E. coli, silkworms, goats",
          "size": "sm",
          "detail": "Each source yields fibres with different strength and stretch, none matching nature exactly.",
          "tone": 1,
          "block": "spya-gjan3e"
        },
        {
          "kind": "node",
          "id": "s-geoex",
          "shape": "note",
          "x": 400,
          "y": 280,
          "w": 260,
          "h": 70,
          "text": "Syringes, microfluidics, electrospinning",
          "size": "sm",
          "detail": "Methods of varying cost and control for pulling or pushing the protein into a fibre.",
          "tone": 2,
          "block": "spya-up6vkg"
        },
        {
          "kind": "node",
          "id": "s-other",
          "shape": "note",
          "x": 400,
          "y": 400,
          "w": 260,
          "h": 70,
          "text": "Also: capsules, nanowires, membranes",
          "size": "sm",
          "detail": "The same apparatus work enables non-fibre forms, for drug delivery and tissue scaffolds.",
          "tone": 2,
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "s-final",
          "shape": "box",
          "x": 190,
          "y": 520,
          "w": 300,
          "h": 70,
          "text": "Engineered silk: commercial, still weaker",
          "size": "md",
          "detail": "Thicker, simpler, and less strong than natural dragline silk, but now sold commercially.",
          "block": "spya-j7hems"
        },
        {
          "kind": "edge",
          "from": "s-hub",
          "to": "s-feed",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s-hub",
          "to": "s-geo",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s-feed",
          "to": "s-feedex",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s-geo",
          "to": "s-geoex",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s-feedex",
          "to": "s-final",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s-geoex",
          "to": "s-final",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s-geoex",
          "to": "s-other",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        }
      ],
      "caption": "A fork into two independent requirements — copying the protein and copying the spinning apparatus — each pursued by its own methods, which then come back together in today's still-imperfect synthetic silks; a side branch shows the apparatus work also enables non-fibre products."
    }
  ]
}
```

## Candidate X

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-spider-silk-spya-ge30uz-X.png

Scene:

```json
{
  "title": "Natural-to-artificial spinning chain",
  "caption": "A chain down the page: the article moves from what silk is and how it behaves, through its ecological uses and the glands that make it, to how spiders spin it naturally, how humans try to copy that, and finally what humans do with it.",
  "scenes": [
    {
      "id": "overview",
      "title": "Spider silk: from gland to synthetic copy",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 200,
          "h": 70,
          "text": "Silk: a protein fibre spiders spin for many jobs",
          "size": "md",
          "block": "spya-gp4t9x"
        },
        {
          "kind": "node",
          "id": "props",
          "shape": "box",
          "x": 260,
          "y": 140,
          "w": 240,
          "h": 80,
          "text": "Structure gives strength, toughness, stretch, adhesion",
          "size": "md",
          "sub": "beta-sheets + amorphous matrix",
          "tone": 1,
          "block": "spya-py9zw6"
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 60,
          "y": 270,
          "w": 220,
          "h": 80,
          "text": "Used for trapping, mating, nesting, dispersal, food",
          "size": "sm",
          "tone": 2,
          "block": "spya-rty5kb"
        },
        {
          "kind": "node",
          "id": "types",
          "shape": "box",
          "x": 480,
          "y": 270,
          "w": 220,
          "h": 80,
          "text": "Seven silk types, one per gland, one per job",
          "size": "sm",
          "tone": 2,
          "block": "spya-hg7j7e"
        },
        {
          "kind": "node",
          "id": "gland-corr",
          "shape": "box",
          "x": 260,
          "y": 380,
          "w": 240,
          "h": 70,
          "text": "A silk's job traces back to its gland",
          "size": "sm",
          "tone": 2,
          "block": "spya-bgtqr0"
        },
        {
          "kind": "node",
          "id": "spin",
          "shape": "hex",
          "x": 260,
          "y": 490,
          "w": 240,
          "h": 90,
          "text": "Natural spinning: pulled, not squeezed, through a tapering duct",
          "size": "md",
          "sub": "liquid crystal to solid fibre",
          "tone": 3,
          "block": "spya-g3h8qq"
        },
        {
          "kind": "node",
          "id": "artificial",
          "shape": "hex",
          "x": 260,
          "y": 640,
          "w": 240,
          "h": 90,
          "text": "Artificial synthesis copies feedstock and spinning conditions",
          "size": "md",
          "sub": "still thicker, weaker than natural",
          "tone": 3,
          "block": "spya-d7d7m8"
        },
        {
          "kind": "node",
          "id": "research",
          "shape": "note",
          "x": 560,
          "y": 640,
          "w": 160,
          "h": 70,
          "text": "Decades of research mapped the chemistry",
          "size": "xs",
          "block": "spya-jvxbb8"
        },
        {
          "kind": "node",
          "id": "synth-silk",
          "shape": "box",
          "x": 260,
          "y": 790,
          "w": 240,
          "h": 70,
          "text": "Engineered bacteria, yeast, goats, silkworms make silk-like protein",
          "size": "sm",
          "block": "spya-j7hems"
        },
        {
          "kind": "node",
          "id": "human",
          "shape": "box",
          "x": 260,
          "y": 910,
          "w": 240,
          "h": 80,
          "text": "Humans weave, heal, and build instruments with it",
          "size": "md",
          "tone": 4,
          "block": "spya-chy97m"
        },
        {
          "kind": "node",
          "id": "medtech",
          "shape": "note",
          "x": 40,
          "y": 1020,
          "w": 200,
          "h": 70,
          "text": "Medicine: wound dressing, nerve regrowth",
          "size": "xs",
          "block": "spya-ce0yqp"
        },
        {
          "kind": "node",
          "id": "scitech",
          "shape": "note",
          "x": 280,
          "y": 1020,
          "w": 200,
          "h": 70,
          "text": "Crosshairs, lenses, fusion-target supports",
          "size": "xs",
          "block": "spya-vr82sv"
        },
        {
          "kind": "node",
          "id": "backmatter",
          "shape": "bare",
          "x": 540,
          "y": 1020,
          "w": 180,
          "h": 50,
          "text": "References & related topics",
          "size": "xs",
          "tone": 0,
          "block": "spya-jdybu5"
        }
      ],
      "caption": "A single chain of stages: properties set up uses and types, uses and types are explained by glands, glands explain natural spinning, which artificial synthesis tries (and struggles) to copy, feeding into human applications."
    },
    {
      "id": "inside-properties",
      "title": "Structure, uses, and types",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "structure",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 80,
          "text": "Crystalline beta-sheets in an amorphous matrix",
          "size": "md",
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "mech",
          "shape": "box",
          "x": 40,
          "y": 160,
          "w": 210,
          "h": 80,
          "text": "High strength + high stretch = exceptional toughness",
          "size": "sm",
          "tone": 1,
          "block": "spya-nwva2u"
        },
        {
          "kind": "node",
          "id": "adhesive",
          "shape": "box",
          "x": 280,
          "y": 160,
          "w": 210,
          "h": 80,
          "text": "Attachment discs polymerise instantly into glue-like bonds",
          "size": "sm",
          "tone": 1,
          "block": "spya-m8z9e7"
        },
        {
          "kind": "node",
          "id": "supercontraction",
          "shape": "note",
          "x": 520,
          "y": 160,
          "w": 200,
          "h": 80,
          "text": "Wet silk shrinks up to 50%, re-tensioning webs",
          "size": "xs",
          "block": "spya-qdjb0x"
        },
        {
          "kind": "node",
          "id": "usetable",
          "shape": "box",
          "x": 40,
          "y": 300,
          "w": 300,
          "h": 90,
          "text": "Trapping, mating, dispersal, nesting, alarm, pheromone trails",
          "size": "sm",
          "tone": 2,
          "block": "spya-jyg3uw"
        },
        {
          "kind": "node",
          "id": "sevenkinds",
          "shape": "box",
          "x": 420,
          "y": 300,
          "w": 300,
          "h": 90,
          "text": "Dragline, capture-spiral, wrapping, egg-sac, glue, attachment silks",
          "size": "sm",
          "tone": 2,
          "block": "spya-gu2z3s"
        },
        {
          "kind": "node",
          "id": "glandtable",
          "shape": "box",
          "x": 200,
          "y": 440,
          "w": 360,
          "h": 90,
          "text": "Each gland (ampullate, flagelliform, tubuliform...) makes one silk for one job",
          "size": "sm",
          "tone": 2,
          "block": "spya-nprqdc"
        },
        {
          "kind": "node",
          "id": "speciesvary",
          "shape": "note",
          "x": 200,
          "y": 580,
          "w": 360,
          "h": 80,
          "text": "Species vary in gland number and specialisation",
          "size": "xs",
          "block": "spya-nn5s8z"
        }
      ],
      "caption": "A hub: silk's layered structure is the central fact, with its mechanical consequences, ecological uses, and the specialised silk types all branching from it and converging again on which gland made which silk."
    },
    {
      "id": "inside-spinning",
      "title": "Spinning: natural then artificial",
      "height": 820,
      "items": [
        {
          "kind": "node",
          "id": "pultrusion",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Silk is pulled out on demand, not grown or pushed",
          "size": "md",
          "block": "spya-g2gw42"
        },
        {
          "kind": "node",
          "id": "tail",
          "shape": "box",
          "x": 260,
          "y": 130,
          "w": 240,
          "h": 60,
          "text": "Tail secretes the silk proteins",
          "size": "sm",
          "tone": 3,
          "block": "spya-f29a84"
        },
        {
          "kind": "node",
          "id": "ampulla",
          "shape": "box",
          "x": 260,
          "y": 210,
          "w": 240,
          "h": 60,
          "text": "Ampulla stores the liquid silk dope",
          "size": "sm",
          "tone": 3,
          "block": "spya-jezt06"
        },
        {
          "kind": "node",
          "id": "duct",
          "shape": "box",
          "x": 260,
          "y": 290,
          "w": 240,
          "h": 70,
          "text": "Tapering duct: shear, acid, water removal align and solidify it",
          "size": "sm",
          "tone": 3,
          "block": "spya-ba6knb"
        },
        {
          "kind": "node",
          "id": "valve",
          "shape": "note",
          "x": 540,
          "y": 290,
          "w": 170,
          "h": 70,
          "text": "A valve may regulate thickness, rejoin breaks",
          "size": "xs",
          "block": "spya-s5073r"
        },
        {
          "kind": "node",
          "id": "garden",
          "shape": "note",
          "x": 20,
          "y": 290,
          "w": 190,
          "h": 80,
          "text": "One garden spider: 800+ glands of six kinds",
          "size": "xs",
          "block": "spya-zrcs7h"
        },
        {
          "kind": "node",
          "id": "feedstock",
          "shape": "box",
          "x": 120,
          "y": 440,
          "w": 230,
          "h": 90,
          "text": "Copying the protein feedstock: E. coli, silkworms, goats, plants",
          "size": "sm",
          "tone": 4,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "geometry",
          "shape": "box",
          "x": 410,
          "y": 440,
          "w": 230,
          "h": 90,
          "text": "Copying the duct: syringes, microfluidics, electrospinning",
          "size": "sm",
          "tone": 4,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "gap",
          "shape": "box",
          "x": 260,
          "y": 580,
          "w": 240,
          "h": 90,
          "text": "Artificial fibres: thicker, weaker than natural dragline",
          "size": "md",
          "tone": 4,
          "block": "spya-jzcepa"
        },
        {
          "kind": "node",
          "id": "commercial",
          "shape": "note",
          "x": 260,
          "y": 710,
          "w": 240,
          "h": 70,
          "text": "Still, commercial spidroin products now exist",
          "size": "xs",
          "block": "spya-m99ub7"
        }
      ],
      "caption": "A chain followed by two columns: the natural spinning process runs step by step down the gland, and then artificial synthesis sits beside it as an attempted copy, split into matching feedstock and matching geometry."
    }
  ]
}
```

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-spider-silk-spya-ge30uz-Y.png

Scene:

```json
{
  "title": "Silk's Spine and Hubs",
  "caption": "A single spine runs top to bottom through the article's stages — properties, uses, silk types, natural spinning, artificial synthesis, research, human uses — with the two richest stages (properties, artificial synthesis) drawn as hubs branching into their sub-topics before the spine continues.",
  "scenes": [
    {
      "id": "overview",
      "title": "Spider silk: from biology to imitation",
      "height": 1440,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 230,
          "y": 30,
          "w": 300,
          "h": 70,
          "text": "Spider silk: a multipurpose protein fibre",
          "size": "md",
          "sub": "prey capture, shelter, courtship, mobility",
          "detail": "Nearly all spiders make silk, even species that build no web at all.",
          "tone": 0,
          "block": "spya-gp4t9x"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 120,
          "w": 712,
          "h": 300,
          "style": "band",
          "label": "PROPERTIES",
          "opens": "inside-properties",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "propHub",
          "shape": "box",
          "x": 230,
          "y": 160,
          "w": 300,
          "h": 50,
          "text": "Strength, stretch, stickiness",
          "size": "md",
          "detail": "A layered molecular structure gives silk its mix of toughness and give.",
          "tone": 1,
          "block": "spya-py9zw6"
        },
        {
          "kind": "node",
          "id": "structural",
          "shape": "box",
          "x": 50,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Hard crystals in a stretchy matrix",
          "size": "sm",
          "detail": "Stiff beta-sheet crystals sit inside soft, folded protein regions.",
          "tone": 1,
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "mechanical",
          "shape": "box",
          "x": 280,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Tougher than steel, stretchier too",
          "size": "sm",
          "detail": "High strength plus high stretch lets silk absorb huge energy before it snaps.",
          "tone": 1,
          "block": "spya-nwva2u"
        },
        {
          "kind": "node",
          "id": "adhesive",
          "shape": "box",
          "x": 510,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Glue that sets on contact",
          "size": "sm",
          "detail": "Pyriform silk forms attachment discs that bond instantly and later biodegrade.",
          "tone": 1,
          "block": "spya-m8z9e7"
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 230,
          "y": 460,
          "w": 300,
          "h": 60,
          "text": "Many jobs: trapping, escaping, mating",
          "size": "sm",
          "sub": "up to 7 silk types per spider",
          "detail": "From orb webs to ballooning threads to pheromone-laced trails.",
          "tone": 2,
          "block": "spya-rty5kb"
        },
        {
          "kind": "node",
          "id": "silktypes",
          "shape": "box",
          "x": 230,
          "y": 560,
          "w": 300,
          "h": 60,
          "text": "Each gland makes its own silk",
          "size": "sm",
          "sub": "dragline, capture-spiral, wrapping, egg case",
          "detail": "A silk's job can be traced back to the specific gland that made it.",
          "tone": 2,
          "block": "spya-hg7j7e"
        },
        {
          "kind": "node",
          "id": "spinning",
          "shape": "box",
          "x": 230,
          "y": 680,
          "w": 300,
          "h": 60,
          "text": "Pulled, not squeezed out",
          "size": "sm",
          "sub": "liquid protein hardens as it's drawn",
          "detail": "Spinning is pultrusion: the fibre forms as it is pulled, not pumped out under pressure.",
          "tone": 2,
          "block": "spya-g3h8qq"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 860,
          "w": 712,
          "h": 300,
          "style": "band",
          "label": "ARTIFICIAL SYNTHESIS",
          "opens": "inside-synthesis",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "synthHub",
          "shape": "box",
          "x": 230,
          "y": 900,
          "w": 300,
          "h": 50,
          "text": "Copying silk: protein plus machine",
          "size": "md",
          "detail": "Making artificial silk means recreating both the liquid protein and the spinning duct.",
          "tone": 3,
          "block": "spya-d7d7m8"
        },
        {
          "kind": "node",
          "id": "feedstock",
          "shape": "box",
          "x": 40,
          "y": 1000,
          "w": 150,
          "h": 90,
          "text": "Borrowed proteins, mixed results",
          "size": "xs",
          "detail": "E. coli, silkworms and goats have all been engineered to make silk-like protein.",
          "tone": 3,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "geometry",
          "shape": "box",
          "x": 210,
          "y": 1000,
          "w": 150,
          "h": 90,
          "text": "Syringes, microfluidics, electrospinning",
          "size": "xs",
          "detail": "Simple protein still needs a duct-like device to become a real fibre.",
          "tone": 3,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "othershapes",
          "shape": "box",
          "x": 380,
          "y": 1000,
          "w": 150,
          "h": 90,
          "text": "Beyond fibres: capsules, membranes",
          "size": "xs",
          "detail": "The same protein can self-assemble into sheets, nanowires and drug capsules.",
          "tone": 3,
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "syntheticsilk",
          "shape": "box",
          "x": 550,
          "y": 1000,
          "w": 150,
          "h": 90,
          "text": "Still short of natural silk",
          "size": "xs",
          "detail": "Lab-made fibres come out thicker and weaker than a spider's own dragline silk.",
          "tone": 3,
          "block": "spya-j7hems"
        },
        {
          "kind": "node",
          "id": "research",
          "shape": "box",
          "x": 230,
          "y": 1200,
          "w": 300,
          "h": 50,
          "text": "Decades of mapping silk's chemistry",
          "size": "sm",
          "detail": "From 1960s amino-acid analysis to 2000s X-ray studies of silk as it's spun.",
          "tone": 4,
          "block": "spya-jvxbb8"
        },
        {
          "kind": "node",
          "id": "humanuses",
          "shape": "box",
          "x": 230,
          "y": 1280,
          "w": 300,
          "h": 60,
          "text": "From stockings to violin strings",
          "size": "sm",
          "sub": "textiles, medicine, optics",
          "detail": "Centuries of attempts to harvest spider silk for cloth, wound care and instruments.",
          "tone": 4,
          "block": "spya-chy97m"
        },
        {
          "kind": "node",
          "id": "backmatter",
          "shape": "note",
          "x": 230,
          "y": 1360,
          "w": 300,
          "h": 50,
          "text": "References & further reading",
          "size": "xs",
          "detail": "Citations, external links and related topics.",
          "tone": 0,
          "block": "spya-jdybu5"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "propHub",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "propHub",
          "to": "structural",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "propHub",
          "to": "mechanical",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "propHub",
          "to": "adhesive",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mechanical",
          "to": "uses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "uses",
          "to": "silktypes",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "silktypes",
          "to": "spinning",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spinning",
          "to": "synthHub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synthHub",
          "to": "feedstock",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synthHub",
          "to": "geometry",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synthHub",
          "to": "othershapes",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synthHub",
          "to": "syntheticsilk",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "syntheticsilk",
          "to": "research",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "research",
          "to": "humanuses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "humanuses",
          "to": "backmatter",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Down the page follows the article's own order; the two hub regions (Properties, Artificial synthesis) are where the piece has the most going on and open into their own scenes."
    },
    {
      "id": "inside-properties",
      "title": "Inside Properties",
      "height": 480,
      "items": [
        {
          "kind": "node",
          "id": "z-structural",
          "shape": "box",
          "x": 230,
          "y": 30,
          "w": 300,
          "h": 60,
          "text": "Hard crystal blocks in a soft, stretchy web",
          "size": "sm",
          "detail": "Stiff beta-sheet crystals are linked by softer, helix-and-turn regions.",
          "tone": 1,
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "z-mechHub",
          "shape": "box",
          "x": 230,
          "y": 130,
          "w": 300,
          "h": 60,
          "text": "Strong, stretchy and tough, together",
          "size": "md",
          "detail": "Dragline silk's rare combination of high strength and high stretch.",
          "tone": 1,
          "block": "spya-nwva2u"
        },
        {
          "kind": "node",
          "id": "z-stiffness",
          "shape": "box",
          "x": 24,
          "y": 240,
          "w": 125,
          "h": 80,
          "text": "Softer, bendier than steel",
          "size": "xs",
          "detail": "Silk's Young's modulus is far lower than steel's or Kevlar's — it gives more easily.",
          "tone": 1,
          "block": "spya-dq9b7q"
        },
        {
          "kind": "node",
          "id": "z-strength",
          "shape": "box",
          "x": 160,
          "y": 240,
          "w": 125,
          "h": 80,
          "text": "Near steel, half of Kevlar",
          "size": "xs",
          "detail": "Dragline silk's tensile strength rivals high-grade steel.",
          "tone": 1,
          "block": "spya-mhe2r5"
        },
        {
          "kind": "node",
          "id": "z-density",
          "shape": "box",
          "x": 296,
          "y": 240,
          "w": 125,
          "h": 80,
          "text": "A sixth the density of steel",
          "size": "xs",
          "detail": "A silk strand long enough to circle the Earth would weigh about 2 kg.",
          "tone": 1,
          "block": "spya-hng89u"
        },
        {
          "kind": "node",
          "id": "z-toughness",
          "shape": "box",
          "x": 432,
          "y": 240,
          "w": 125,
          "h": 80,
          "text": "Matches top synthetic fibres",
          "size": "xs",
          "detail": "Dragline silk's toughness rivals the best commercial polyaramid fibres.",
          "tone": 1,
          "block": "spya-gfykz5"
        },
        {
          "kind": "node",
          "id": "z-supercontract",
          "shape": "box",
          "x": 568,
          "y": 240,
          "w": 125,
          "h": 80,
          "text": "Shrinks and softens when wet",
          "size": "xs",
          "detail": "Dragline silk can shrink up to 50% in water, possibly to re-tension webs.",
          "tone": 1,
          "block": "spya-qdjb0x"
        },
        {
          "kind": "node",
          "id": "z-adhesive",
          "shape": "box",
          "x": 230,
          "y": 360,
          "w": 300,
          "h": 70,
          "text": "Glue that sets on contact, then biodegrades",
          "size": "md",
          "detail": "Attachment-disc silk polymerises immediately and stays usable indefinitely.",
          "tone": 1,
          "block": "spya-m8z9e7"
        },
        {
          "kind": "edge",
          "from": "z-structural",
          "to": "z-mechHub",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-mechHub",
          "to": "z-stiffness",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-mechHub",
          "to": "z-strength",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-mechHub",
          "to": "z-density",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-mechHub",
          "to": "z-toughness",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-mechHub",
          "to": "z-supercontract",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-density",
          "to": "z-adhesive",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A hub shape: structural basis above feeds a cluster of five mechanical measures, which funnel down into the separate story of adhesive glue."
    },
    {
      "id": "inside-synthesis",
      "title": "Inside Artificial synthesis",
      "height": 560,
      "items": [
        {
          "kind": "node",
          "id": "z-hub",
          "shape": "box",
          "x": 220,
          "y": 30,
          "w": 320,
          "h": 60,
          "text": "Two tasks: make the protein, build the duct",
          "size": "md",
          "sub": "feedstock and spinning conditions",
          "detail": "Few strategies so far have managed both well enough to spin usable fibre.",
          "tone": 3,
          "block": "spya-wgee6t"
        },
        {
          "kind": "node",
          "id": "z-feedHead",
          "shape": "box",
          "x": 40,
          "y": 150,
          "w": 300,
          "h": 60,
          "text": "Feedstock: borrowed silk proteins",
          "size": "sm",
          "detail": "Silk's protein is long and complex, so stand-in organisms are used instead.",
          "tone": 3,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "z-ecoli",
          "shape": "box",
          "x": 40,
          "y": 240,
          "w": 300,
          "h": 70,
          "text": "E. coli-made protein matches real silk",
          "size": "sm",
          "detail": "Engineered bacteria produced fibre matching natural dragline silk's strength and stretch.",
          "tone": 3,
          "block": "spya-f399m7"
        },
        {
          "kind": "node",
          "id": "z-goats",
          "shape": "box",
          "x": 40,
          "y": 340,
          "w": 300,
          "h": 70,
          "text": "Goat milk: silk protein, weaker fibre",
          "size": "sm",
          "detail": "Goats secreted silk protein in their milk, but spun fibres fell short of natural silk.",
          "tone": 3,
          "block": "spya-brz8bx"
        },
        {
          "kind": "node",
          "id": "z-geoHead",
          "shape": "box",
          "x": 420,
          "y": 150,
          "w": 300,
          "h": 60,
          "text": "Geometry: copying the spinning duct",
          "size": "sm",
          "detail": "Simple protein still needs a duct-like apparatus to become a working fibre.",
          "tone": 3,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "z-syringe",
          "shape": "box",
          "x": 420,
          "y": 240,
          "w": 300,
          "h": 70,
          "text": "Syringe & needle: cheap, crude",
          "size": "sm",
          "detail": "Easy to build, but needs chemicals or stretching to harden the fibre properly.",
          "tone": 3,
          "block": "spya-y4ay23"
        },
        {
          "kind": "node",
          "id": "z-microfluidics",
          "shape": "box",
          "x": 420,
          "y": 340,
          "w": 300,
          "h": 70,
          "text": "Microfluidics: precise, costly",
          "size": "sm",
          "detail": "Controllable small-scale spinning, now reaching commercial continuous fibre.",
          "tone": 3,
          "block": "spya-qbrkma"
        },
        {
          "kind": "node",
          "id": "z-otherShapes",
          "shape": "note",
          "x": 600,
          "y": 440,
          "w": 130,
          "h": 70,
          "text": "Also: capsules, membranes, nanowires",
          "size": "xs",
          "detail": "The same proteins can self-assemble into shapes besides fibres.",
          "tone": 3,
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "z-result",
          "shape": "box",
          "x": 190,
          "y": 440,
          "w": 380,
          "h": 70,
          "text": "Close, but still short of natural silk",
          "size": "md",
          "detail": "Artificial fibres end up thicker, weaker and less flexible than a spider's own.",
          "tone": 3,
          "block": "spya-j7hems"
        },
        {
          "kind": "edge",
          "from": "z-hub",
          "to": "z-feedHead",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-hub",
          "to": "z-geoHead",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-feedHead",
          "to": "z-ecoli",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-feedHead",
          "to": "z-goats",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-geoHead",
          "to": "z-syringe",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-geoHead",
          "to": "z-microfluidics",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-geoHead",
          "to": "z-otherShapes",
          "via": "curve",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-ecoli",
          "to": "z-result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-goats",
          "to": "z-result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-syringe",
          "to": "z-result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z-microfluidics",
          "to": "z-result",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Two columns off one starting claim — matching feedstock attempts against matching spinning-duct attempts — converge on one verdict, with a side note on non-fibre uses."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-spider-silk-spya-ge30uz-Z.png

Scene:

```json
{
  "title": "Chain: nature to imitation",
  "caption": "The article is a chain running from what silk is and how it behaves, through how spiders make it, to how humans try to copy and use it — each stage building on the last.",
  "scenes": [
    {
      "id": "overview",
      "title": "Spider silk: from web to lab",
      "height": 1150,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Silk's many jobs for spiders",
          "size": "md",
          "sub": "prey, shelter, mating, food",
          "block": "spya-gp4t9x"
        },
        {
          "kind": "node",
          "id": "props",
          "shape": "hex",
          "x": 260,
          "y": 140,
          "w": 240,
          "h": 80,
          "text": "Structure gives it strength and stretch",
          "size": "md",
          "sub": "crystal sheets + stretchy matrix",
          "tone": 1,
          "block": "spya-py9zw6",
          "opens": "inside-properties"
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 40,
          "y": 260,
          "w": 220,
          "h": 70,
          "text": "Many ecological uses",
          "size": "sm",
          "sub": "capture, dispersal, nests, signals",
          "tone": 2,
          "block": "spya-rty5kb"
        },
        {
          "kind": "node",
          "id": "types",
          "shape": "box",
          "x": 500,
          "y": 260,
          "w": 220,
          "h": 70,
          "text": "Different glands, different silks",
          "size": "sm",
          "sub": "dragline, capture-spiral, wrap, glue",
          "tone": 2,
          "block": "spya-hg7j7e"
        },
        {
          "kind": "node",
          "id": "spin",
          "shape": "hex",
          "x": 260,
          "y": 370,
          "w": 240,
          "h": 80,
          "text": "Spun on demand through a tapering duct",
          "size": "md",
          "sub": "liquid protein → solid fibre",
          "block": "spya-g3h8qq"
        },
        {
          "kind": "node",
          "id": "gland",
          "shape": "note",
          "x": 40,
          "y": 480,
          "w": 220,
          "h": 70,
          "text": "One spider, hundreds of glands",
          "size": "sm",
          "sub": "garden cross spider example",
          "block": "spya-zrcs7h"
        },
        {
          "kind": "node",
          "id": "synth",
          "shape": "hex",
          "x": 260,
          "y": 580,
          "w": 240,
          "h": 80,
          "text": "Copying silk is still hard",
          "size": "md",
          "sub": "feedstock + duct both needed",
          "tone": 3,
          "block": "spya-d7d7m8",
          "opens": "inside-synthesis"
        },
        {
          "kind": "node",
          "id": "research",
          "shape": "note",
          "x": 500,
          "y": 580,
          "w": 220,
          "h": 70,
          "text": "Decades of mapping silk's science",
          "size": "sm",
          "sub": "chemistry, genes, mechanics",
          "block": "spya-jvxbb8"
        },
        {
          "kind": "node",
          "id": "human",
          "shape": "box",
          "x": 260,
          "y": 700,
          "w": 240,
          "h": 80,
          "text": "Human uses: cloth, medicine, tech",
          "size": "md",
          "sub": "rare textile, wound dressing, optics",
          "tone": 4,
          "block": "spya-chy97m"
        },
        {
          "kind": "node",
          "id": "back",
          "shape": "note",
          "x": 260,
          "y": 820,
          "w": 240,
          "h": 55,
          "text": "References & related topics",
          "size": "xs",
          "tone": 0,
          "block": "spya-jdybu5"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "props",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "props",
          "to": "uses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "props",
          "to": "types",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "uses",
          "to": "spin",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "types",
          "to": "spin",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "gland",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "synth",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synth",
          "to": "research",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synth",
          "to": "human",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "research",
          "to": "human",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "human",
          "to": "back",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        }
      ],
      "caption": "A chain down the page: silk's biology and properties lead to its natural production, then to artificial copying, then to human application; research and references sit as apparatus alongside."
    },
    {
      "id": "inside-properties",
      "title": "Properties: structure, mechanics, glue",
      "height": 650,
      "items": [
        {
          "kind": "node",
          "id": "p0",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "Hierarchical protein structure",
          "size": "md",
          "sub": "beta-sheets + amorphous matrix",
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "p1",
          "shape": "box",
          "x": 60,
          "y": 180,
          "w": 210,
          "h": 70,
          "text": "Models of the fibre's architecture",
          "size": "sm",
          "sub": "Termonia's 1994 model, refined",
          "tone": 1,
          "block": "spya-ns50b2"
        },
        {
          "kind": "node",
          "id": "p2",
          "shape": "box",
          "x": 280,
          "y": 180,
          "w": 220,
          "h": 80,
          "text": "Strength, toughness, elasticity",
          "size": "sm",
          "sub": "tougher than Kevlar, lighter than steel",
          "tone": 2,
          "block": "spya-nwva2u"
        },
        {
          "kind": "node",
          "id": "p3",
          "shape": "box",
          "x": 520,
          "y": 180,
          "w": 200,
          "h": 70,
          "text": "Adhesive attachment discs",
          "size": "sm",
          "sub": "instant cure, biodegradable",
          "tone": 3,
          "block": "spya-k8bh7d"
        },
        {
          "kind": "node",
          "id": "p2a",
          "shape": "note",
          "x": 200,
          "y": 320,
          "w": 190,
          "h": 60,
          "text": "Stiffness (Young's modulus)",
          "size": "xs",
          "tone": 2,
          "block": "spya-w9q80j"
        },
        {
          "kind": "node",
          "id": "p2b",
          "shape": "note",
          "x": 400,
          "y": 320,
          "w": 190,
          "h": 60,
          "text": "Tensile strength & toughness",
          "size": "xs",
          "tone": 2,
          "block": "spya-mhe2r5"
        },
        {
          "kind": "node",
          "id": "p2c",
          "shape": "note",
          "x": 200,
          "y": 400,
          "w": 190,
          "h": 60,
          "text": "Stretch & supercontraction in water",
          "size": "xs",
          "tone": 2,
          "block": "spya-qdjb0x"
        },
        {
          "kind": "node",
          "id": "p2d",
          "shape": "note",
          "x": 400,
          "y": 400,
          "w": 190,
          "h": 60,
          "text": "Darwin's bark spider: toughest known",
          "size": "xs",
          "tone": 2,
          "block": "spya-ug9bz2"
        },
        {
          "kind": "edge",
          "from": "p0",
          "to": "p1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p0",
          "to": "p2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p0",
          "to": "p3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p2",
          "to": "p2a",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p2",
          "to": "p2b",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p2",
          "to": "p2c",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p2",
          "to": "p2d",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "One starting point, molecular structure, fanning into the three kinds of performance it explains."
    },
    {
      "id": "inside-synthesis",
      "title": "Artificial synthesis: two problems at once",
      "height": 700,
      "items": [
        {
          "kind": "node",
          "id": "s0",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "Two tasks: protein + spinning conditions",
          "size": "md",
          "block": "spya-wgee6t"
        },
        {
          "kind": "node",
          "id": "s1",
          "shape": "box",
          "x": 60,
          "y": 160,
          "w": 260,
          "h": 80,
          "text": "Feedstock from E. coli, silkworms, goats, plants",
          "size": "sm",
          "sub": "results vary in strength",
          "tone": 1,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "s2",
          "shape": "box",
          "x": 440,
          "y": 160,
          "w": 260,
          "h": 80,
          "text": "Reproducing the spinning duct",
          "size": "sm",
          "sub": "syringe, microfluidics, electrospinning",
          "tone": 2,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "s3",
          "shape": "note",
          "x": 60,
          "y": 280,
          "w": 260,
          "h": 60,
          "text": "Also used for capsules, sheets, nanowires",
          "size": "xs",
          "tone": 2,
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "s4",
          "shape": "box",
          "x": 220,
          "y": 400,
          "w": 320,
          "h": 80,
          "text": "Synthetic silk still thinner, weaker than natural",
          "size": "sm",
          "sub": "wet-spun fibres from engineered organisms",
          "tone": 3,
          "block": "spya-j7hems"
        },
        {
          "kind": "node",
          "id": "s5",
          "shape": "box",
          "x": 220,
          "y": 520,
          "w": 320,
          "h": 70,
          "text": "Commercial efforts",
          "size": "sm",
          "sub": "AMSilk, Bolt Threads, Spiber, Nexia",
          "tone": 4,
          "block": "spya-m99ub7"
        },
        {
          "kind": "edge",
          "from": "s0",
          "to": "s1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s0",
          "to": "s2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s2",
          "to": "s3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s1",
          "to": "s4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s2",
          "to": "s4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s4",
          "to": "s5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Two columns running together: getting the right protein, and getting it to form a fibre, before either reaches real-world use."
    }
  ]
}
```
