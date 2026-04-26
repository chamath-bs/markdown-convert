// One-shot conversion using the updated converters.mjs directly (bypasses the running server).
// Usage: node scripts/convert-cli.mjs <input-file> [output-file]

import fs from 'node:fs/promises';
import path from 'node:path';
import { convert } from '../server/converters.mjs';

const [, , inputPath, outputPathArg] = process.argv;
if (!inputPath) {
  console.error('Usage: node scripts/convert-cli.mjs <input> [output]');
  process.exit(1);
}

const buffer = await fs.readFile(inputPath);
const filename = path.basename(inputPath);
const result = await convert(buffer, filename);

const outPath = outputPathArg || inputPath.replace(/\.(docx|pdf|pptx)$/i, '.md');
await fs.writeFile(outPath, result.markdown);

console.log(`OK  ${filename}  ->  ${outPath}`);
console.log(`    ${result.markdown.length} chars, ${result.markdown.split('\n').length} lines`);
if (result.warnings.length) console.log(`    warnings: ${result.warnings.join('; ')}`);
