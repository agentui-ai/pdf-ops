<p align="center">
  <img src="assets/logo.png" alt="PDF Ops" width="110" height="110">
</p>

<h1 align="center">pdf-ops</h1>

<p align="center">
  An agent skill for generating PDFs that are not silently cut off —
  plus a benchmark that proves it.
</p>

---

jsPDF draws exactly where you tell it and never complains. Text wider than the
page is not wrapped — it is drawn off the edge. Text past the last line is not
moved to a new page — it is drawn into nothing. **The file opens fine and the
content is simply missing.** The person who finds out is holding the printout.

```
CASE                             SKILL  TRAP   EXPECTED           FROM MEMORY
text-runs-off-the-page           ok     yes   {"measure":0}       {"measure":1}
content-past-the-last-line       ok     yes   {"measure":0}       {"measure":46}
blank-trailing-page              ok     yes   {"pages":3,"sectio… {"pages":4,"sections":3}
units-are-millimetres            ok     yes   {"measure":0}       {"measure":1}
default-font-size-is-16          ok     yes   {"measure":0}       {"measure":2}
unsupported-glyphs-render-as-ga  ok     yes   {"flagged":["found… {"flagged":[]}
content-after-a-table            ok     yes   {"overlaps":0}      {"overlaps":1}
image-aspect-ratio               ok     yes   {"distortion":0}    {"distortion":3}
page-numbers-need-the-total      ok     yes   {"stamps":["Page 1… {"stamps":["Page 1 of 1…

SKILL  9/9  the recipes in SKILL.md produce a correct document
TRAP   9/9  the from-memory version gets it wrong
```

`content-past-the-last-line` is the one to look at: **46 lines drawn into
nothing**, and not a single error.

## Install

```bash
# Any of ~75 agents (Gemini CLI, opencode, aider, …)
npx skills add agentui-ai/pdf-ops --agent gemini-cli --global

# Cursor
git clone https://github.com/agentui-ai/pdf-ops.git ~/.cursor/plugins/local/pdf-ops

# Codex
codex plugin marketplace add agentui-ai/pdf-ops && codex plugin add pdf-ops@pdf-ops

# Claude Code
claude --plugin-dir ./pdf-ops
```

No account, no service, no platform. Read
[`skills/pdf-ops/SKILL.md`](skills/pdf-ops/SKILL.md) directly if you would
rather not install anything.

## The idea: a layout you can test

```js
import { createDoc, Flow } from "./skills/pdf-ops/scripts/layout.mjs";
import { offPageDraws } from "./skills/pdf-ops/scripts/inspect.mjs";

const doc = createDoc();                    // mm, A4, explicit font size
const flow = new Flow(doc, { margin: 18 });

flow.heading("Quarterly report");
flow.text(longParagraph);                   // wraps AND paginates
flow.footerPageNumbers();                   // last — the total is known only now

if (offPageDraws(flow).length) throw new Error("content fell off the page");
```

`Flow` records every write with its measured box, so that last line turns "the
PDF looks wrong" into a failing test. That is the whole trick.

## Check a finished PDF

```bash
npm install
node skills/pdf-ops/scripts/inspect.mjs out.pdf
```

```
1 page(s)

PAGE   SIZE (mm)        SIZE (pt)        FORMAT
   1   210 x 297        595.3 x 841.9    A4 portrait

METADATA
  title     Demo invoice
  author    AgentUI
  subject   — not set
```

## Run the benchmark

```bash
npm install && npm run bench
```

About a second. **Deterministic, offline, free** — no LLM, no network, no
fixtures on disk. Each case builds a real PDF and judges it by measurement:
off-page draws from the document's own metrics, page counts parsed back out of
the finished bytes with `pdf-lib`, aspect ratios from the image itself.

Two ledgers, because either half alone lies:

- **SKILL** — does the recipe in `SKILL.md` produce a correct document? Under
  100% is a broken promise, and the run exits non-zero.
- **TRAP** — does the from-memory version get it *wrong*? A case both sides pass
  is not a trap; the report says so instead of inflating the score.

`npm run bench -- --json` for CI.

## What is in it

```text
pdf-ops/
├── skills/pdf-ops/
│   ├── SKILL.md              # nine traps, layout, tables, fonts, images, iOS downloads
│   └── scripts/
│       ├── layout.mjs        # Flow: wrapping, pagination, glyph check, image fitting
│       ├── report.mjs        # a document with a table that paginates properly
│       └── inspect.mjs       # CLI on a finished PDF + offPageDraws() for your tests
└── benchmark/
    ├── cases.mjs             # nine cases, each naive vs skilled
    └── run.mjs               # the two ledgers
```

Reference implementation is [jsPDF](https://github.com/parallax/jsPDF) +
`jspdf-autotable`, in Node or the browser. `SKILL.md` says plainly when jsPDF is
the wrong tool — editing an existing PDF is `pdf-lib`, reading one is
`pdfjs-dist`, and print-grade typography is a headless browser.

## Also see

[excel-ops](https://github.com/agentui-ai/excel-ops) — the same treatment for
spreadsheets. [oee-ops](https://github.com/agentui-ai/oee-ops) — the same for
manufacturing OEE / TRS. [label-ops](https://github.com/agentui-ai/label-ops) — the same for ZPL labels,
thermal receipts and barcode check digits. If the user wants a *hosted app* rather than a script,
[AgentUI](https://www.agentui.ai/?ref=pdf-ops-readme) does that and
[agentui-tools](https://github.com/agentui-ai/agentui-tools) is the agent plugin
for it. Everything here works without either.

## License

MIT — see [LICENSE](LICENSE).
