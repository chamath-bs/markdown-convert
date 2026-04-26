# markdown-convert

A small local utility for converting `.docx`, `.pdf`, and `.pptx` files into lightweight markdown. Drag in files (or a whole folder), pick an output folder, and the app writes one `.md` per source document.

## Requirements

- **Node.js 18+** (tested on 20 and 24)
- **Chromium-based browser** (Edge, Chrome, Brave, Arc) — the auto-save feature uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API), which Firefox and Safari don't support.

## Install and run

```sh
git clone https://github.com/chamath-bs/markdown-convert.git
cd markdown-convert
npm install --ignore-scripts
npm run dev
```

Then open <http://127.0.0.1:3001> in Edge or Chrome.

> The `--ignore-scripts` flag skips a postinstall validation step in `esbuild`. It's only needed on Windows machines under corporate policies that block unsigned `.exe` execution. The runtime never invokes `esbuild` so this is harmless.

## How it works

```
┌────────────────────────────┐
│  Browser (Edge / Chrome)   │
│  - drag-drop / pick files  │
│  - File System Access API  │ ← writes .md files into your chosen folder
└────────────┬───────────────┘
             │  POST /api/convert  (one file at a time)
             ▼
┌────────────────────────────┐
│  Express server :3001      │
│  - serves /public          │
│  - dispatches by extension │
└────────────┬───────────────┘
             │
   ┌─────────┼──────────┐
   ▼         ▼          ▼
 .docx     .pdf       .pptx
mammoth   pdf2md     JSZip + slide XML
+ turndown            parser
```

Single port. No build step. React + [HTM](https://github.com/developit/htm) tagged templates loaded via `esm.sh`, no Vite or bundler.

## Supported formats

| Format | Library | Notes |
|---|---|---|
| `.docx` | `mammoth` → HTML → `turndown` → markdown | Headings, lists, and tables preserved. Images stripped. |
| `.pdf` | `@opendocsg/pdf2md` | Text + heading detection, then a post-processing pass cleans up common defects (see below). |
| `.pptx` | Custom JSZip-based slide XML parser | Each slide becomes a `## Slide N: title` section with paragraphs as bullets. Speaker notes appended as blockquotes. |

Files are processed strictly **one at a time** (no parallel uploads), with a 50 MB per-file cap.

## Image handling

All three converters **strip images** from output. Image/chart-to-text summarisation (via Claude vision) is on the roadmap but not implemented. The `warnings` field returned per file reports how many images were skipped.

## PDF post-processing

`@opendocsg/pdf2md` does a reasonable job of body text but mangles a few things in design-heavy PDFs. `server/converters.mjs` runs a post-pass that fixes the most common defects:

- Collapses consecutive `######` "pull-quote stacks" into a single bold paragraph.
- Merges wrapped chapter titles (`## Economic outlook` + `## and key themes` → `## Economic outlook and key themes`).
- Strips recurring header/footer lines that appear ≥4 times across the document.
- Strips H4-H6 breadcrumb headings whose text duplicates an existing H2 chapter title.
- Cleans up TOC dot-leaders (`Introduction __________ 3` → `Introduction — 3`).
- Normalises whitespace.

These heuristics are tuned to be conservative — DOCX and PPTX outputs (which already arrive clean) are unchanged.

## Project layout

```
markdown-convert/
├── package.json
├── server/
│   ├── index.mjs         # Express, serves /public + /api/convert
│   └── converters.mjs    # docx/pdf/pptx adapters + post-processor
├── public/
│   ├── index.html
│   ├── app.js            # React + HTM, single-page UI
│   └── lib/
│       ├── htm.js        # React + HTM bindings (loaded from esm.sh)
│       ├── theme.js      # colour palette
│       ├── icons.js      # inline SVG icons
│       └── fsa.js        # File System Access API helpers
└── scripts/
    ├── smoke.mjs         # POSTs generated fixtures to a running server
    ├── smoke-direct.mjs  # calls converters.mjs directly (no server)
    └── convert-cli.mjs   # one-shot CLI: convert a file from disk
```

## Quick CLI usage

To convert a single file without going through the browser:

```sh
node scripts/convert-cli.mjs path/to/document.pdf
# writes path/to/document.md
```

## Known limitations

- **Tables in PDFs** are flattened to run-on text. `pdf2md` doesn't reconstruct table structure.
- **Charts and images** are not summarised — only stripped. Whole pages of data viz reduce to their captions.
- **Multi-column PDFs** are merged into single-column prose. Reading order is usually correct but column boundaries are lost.
- **Hyphenated words that wrap** in the source PDF occasionally lose their hyphen (e.g. `AI-related` → `AIrelated`).
- The File System Access API is **Chromium-only**. There's no fallback to per-file download dialogs.

## License

Internal use. No license specified.
