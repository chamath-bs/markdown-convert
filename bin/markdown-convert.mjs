#!/usr/bin/env node
// markdown-convert — CLI for converting .docx, .pdf, and .pptx files to markdown.
//
// Usage:
//   markdown-convert FILE                  → write markdown to stdout
//   markdown-convert FILE -o OUT.md        → write markdown to OUT.md
//   markdown-convert FILE1 FILE2 ... --out-dir DIR
//                                          → batch convert; each FILE.{ext} → DIR/FILE.md
//   markdown-convert FILE --json           → JSON {markdown, warnings, source} on stdout
//   markdown-convert -h | --help           → show this help

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { convert } from '../server/converters.mjs';

const HELP = `markdown-convert — convert .docx / .pdf / .pptx to lightweight markdown

USAGE
  markdown-convert FILE                       Write markdown to stdout
  markdown-convert FILE -o OUT.md             Write markdown to OUT.md
  markdown-convert FILE1 FILE2 --out-dir DIR  Batch convert; FILE.ext → DIR/FILE.md
  markdown-convert FILE --json                Emit JSON {markdown, warnings, source}

OPTIONS
  -o, --output FILE     Write the markdown to FILE (single-input mode only)
      --out-dir DIR     Output directory for batch mode (created if missing)
      --json            Machine-readable output (one JSON object per file, NDJSON)
  -h, --help            Show this help

EXIT CODES
  0  all files converted successfully
  1  one or more files failed (errors logged to stderr)
  2  CLI usage error (bad flags, no input, conflicting options)

EXAMPLES
  # Pipe a PDF straight into another tool
  markdown-convert report.pdf | head -40

  # Convert a folder of decks alongside a release script
  markdown-convert decks/*.pptx --out-dir build/notes

  # JSON for programmatic callers (one object per input, newline-delimited)
  markdown-convert *.docx --json | jq -r '.warnings[]'
`;

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output:  { type: 'string', short: 'o' },
      'out-dir': { type: 'string' },
      json:    { type: 'boolean', default: false },
      help:    { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (err) {
  process.stderr.write(`markdown-convert: ${err.message}\n\n${HELP}`);
  process.exit(2);
}

const { values, positionals } = parsed;

if (values.help || positionals.length === 0) {
  process.stdout.write(HELP);
  process.exit(values.help ? 0 : 2);
}

if (values.output && values['out-dir']) {
  process.stderr.write('markdown-convert: --output and --out-dir are mutually exclusive\n');
  process.exit(2);
}
if (values.output && positionals.length > 1) {
  process.stderr.write('markdown-convert: --output works with one input file. Use --out-dir for batch mode.\n');
  process.exit(2);
}

if (values['out-dir']) {
  await fs.mkdir(values['out-dir'], { recursive: true });
}

let failures = 0;

for (const input of positionals) {
  const source = path.resolve(input);
  let buffer;
  try {
    buffer = await fs.readFile(source);
  } catch (err) {
    failures++;
    if (values.json) {
      process.stdout.write(JSON.stringify({ source, ok: false, error: err.message }) + '\n');
    } else {
      process.stderr.write(`markdown-convert: cannot read ${input}: ${err.message}\n`);
    }
    continue;
  }

  const filename = path.basename(input);
  let result;
  try {
    result = await convert(buffer, filename);
  } catch (err) {
    failures++;
    if (values.json) {
      process.stdout.write(JSON.stringify({ source, ok: false, error: err.message }) + '\n');
    } else {
      process.stderr.write(`markdown-convert: ${input}: ${err.message}\n`);
    }
    continue;
  }

  const baseName = filename.replace(/\.(docx|pdf|pptx)$/i, '.md');
  let outputPath = null;
  if (values.output) outputPath = path.resolve(values.output);
  else if (values['out-dir']) outputPath = path.resolve(values['out-dir'], baseName);

  if (outputPath) {
    await fs.writeFile(outputPath, result.markdown);
  }

  if (values.json) {
    process.stdout.write(JSON.stringify({
      source,
      ok: true,
      output: outputPath,
      markdown: outputPath ? undefined : result.markdown,
      warnings: result.warnings,
    }) + '\n');
  } else if (outputPath) {
    process.stderr.write(`✓ ${input} → ${outputPath}${result.warnings.length ? ` (${result.warnings.join('; ')})` : ''}\n`);
  } else {
    process.stdout.write(result.markdown);
    if (result.warnings.length) {
      process.stderr.write(`(warnings: ${result.warnings.join('; ')})\n`);
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
