// Generates a small DOCX fixture and exercises the CLI in every mode.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'scripts', '.tmp-cli-test');
const CLI = path.join(ROOT, 'bin', 'markdown-convert.mjs');

await fs.rm(TMP, { recursive: true, force: true });
await fs.mkdir(TMP, { recursive: true });

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Body text for ${text}.</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const a = path.join(TMP, 'a.docx');
const b = path.join(TMP, 'b.docx');
await fs.writeFile(a, await makeDocx('Document A'));
await fs.writeFile(b, await makeDocx('Document B'));

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

console.log('--- 1. stdout mode (single file) ---');
let r = run([a]);
check('exit 0', r.code === 0, `code=${r.code} stderr=${r.stderr}`);
check('markdown on stdout', /^# Document A/.test(r.stdout), `stdout=${JSON.stringify(r.stdout.slice(0, 60))}`);
check('stderr is warnings-only or empty', r.stderr === '' || /^\(warnings:/.test(r.stderr), `stderr=${JSON.stringify(r.stderr)}`);

console.log('--- 2. -o file mode ---');
const outPath = path.join(TMP, 'out.md');
r = run([a, '-o', outPath]);
check('exit 0', r.code === 0);
check('stdout empty (content went to file)', r.stdout === '');
check('file written', (await fs.readFile(outPath, 'utf8')).startsWith('# Document A'));
check('progress line on stderr', /✓.*a\.docx/.test(r.stderr));

console.log('--- 3. --out-dir batch mode ---');
const outDir = path.join(TMP, 'batch');
r = run([a, b, '--out-dir', outDir]);
check('exit 0', r.code === 0);
check('a.md exists', (await fs.readFile(path.join(outDir, 'a.md'), 'utf8')).startsWith('# Document A'));
check('b.md exists', (await fs.readFile(path.join(outDir, 'b.md'), 'utf8')).startsWith('# Document B'));

console.log('--- 4. --json mode ---');
r = run([a, '--json']);
check('exit 0', r.code === 0);
const lines = r.stdout.trim().split('\n');
check('one JSON line', lines.length === 1);
const obj = JSON.parse(lines[0]);
check('json.ok=true', obj.ok === true);
check('json.markdown present', typeof obj.markdown === 'string' && obj.markdown.startsWith('# Document A'));
check('json.warnings is array', Array.isArray(obj.warnings));
check('json.source resolves', obj.source === a);

console.log('--- 5. --json batch ---');
r = run([a, b, '--json', '--out-dir', outDir]);
check('exit 0', r.code === 0);
const ndjson = r.stdout.trim().split('\n').map(l => JSON.parse(l));
check('two JSON lines', ndjson.length === 2);
check('output paths populated', ndjson.every(o => typeof o.output === 'string'));
check('markdown omitted when output set', ndjson.every(o => o.markdown === undefined));

console.log('--- 6. error: no input ---');
r = run([]);
check('exit 2', r.code === 2);
check('help printed', /USAGE/.test(r.stdout));

console.log('--- 7. error: unsupported file ---');
const bad = path.join(TMP, 'bad.txt');
await fs.writeFile(bad, 'plain text');
r = run([bad]);
check('exit 1', r.code === 1);
check('error on stderr', /Unsupported file type/.test(r.stderr));

console.log('--- 8. error: --output with multiple files ---');
r = run([a, b, '-o', outPath]);
check('exit 2', r.code === 2);
check('hint about --out-dir', /--out-dir/.test(r.stderr));

console.log('--- 9. error: --output and --out-dir together ---');
r = run([a, '-o', outPath, '--out-dir', outDir]);
check('exit 2', r.code === 2);
check('mutually exclusive message', /mutually exclusive/.test(r.stderr));

console.log('--- 10. -h help ---');
r = run(['-h']);
check('exit 0', r.code === 0);
check('shows USAGE', /USAGE/.test(r.stdout));

console.log('---');
console.log(`${pass} passed, ${fail} failed`);

await fs.rm(TMP, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
