import path from 'node:path';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import pdf2md from '@opendocsg/pdf2md';
import JSZip from 'jszip';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});
turndown.remove(['img', 'picture', 'svg']);

async function convertDocx(buffer) {
  const warnings = [];
  let imageCount = 0;
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(() => {
        imageCount += 1;
        return { src: '' };
      }),
    }
  );
  if (imageCount > 0) warnings.push(`${imageCount} image(s) stripped`);
  for (const m of result.messages) {
    if (m.type === 'warning') warnings.push(m.message);
  }
  const markdown = turndown.turndown(result.value).trim() + '\n';
  return { markdown, warnings };
}

async function convertPdf(buffer) {
  const md = await pdf2md(buffer);
  return { markdown: md.trim() + '\n', warnings: [] };
}

function joinWrappedRun(parts) {
  let out = parts[0].trim();
  for (let i = 1; i < parts.length; i++) {
    const cur = parts[i].trim();
    if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(cur)) {
      out = out.slice(0, -1) + cur;
    } else {
      out = out + ' ' + cur;
    }
  }
  return out;
}

function postProcessMarkdown(markdown) {
  let lines = markdown.split('\n');

  const collapsed = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(#{2,6})\s+(.+?)\s*$/);
    if (m) {
      const level = m[1];
      const run = [m[2]];
      let j = i + 1;
      while (j < lines.length) {
        let k = j;
        while (k < lines.length && lines[k].trim() === '') k++;
        if (k - j > 1) break;
        if (k >= lines.length) break;
        const nm = lines[k].match(/^(#{2,6})\s+(.+?)\s*$/);
        if (!nm || nm[1] !== level) break;
        const isWrapContinuation = /^[a-z]/.test(nm[2]);
        const aggressiveMerge = level.length >= 6;
        if (!isWrapContinuation && !aggressiveMerge) break;
        run.push(nm[2]);
        j = k + 1;
      }
      if (run.length > 1) {
        const joined = joinWrappedRun(run);
        const isPullQuote = level.length >= 4 && (/[.!?]$/.test(joined) || joined.split(/\s+/).length > 14);
        collapsed.push(isPullQuote ? `**${joined}**` : `${level} ${joined}`);
        i = j;
      } else {
        collapsed.push(lines[i]);
        i++;
      }
    } else {
      collapsed.push(lines[i]);
      i++;
    }
  }

  const counts = new Map();
  const chapterTitles = new Set();
  for (const ln of collapsed) {
    const t = ln.trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
    const h2 = t.match(/^##\s+(.+?)\s*$/);
    if (h2) chapterTitles.add(h2[1].trim().toLowerCase());
  }
  const noise = new Set();
  for (const [ln, count] of counts) {
    const isHeading = /^#{4,6}\s+/.test(ln);
    if (isHeading && count >= 4) {
      noise.add(ln);
    } else if (!isHeading && count >= 4 && ln.length <= 80 && !/[.!?]$/.test(ln)) {
      noise.add(ln);
    } else if (isHeading) {
      const text = ln.replace(/^#{4,6}\s+/, '').trim().toLowerCase();
      if (chapterTitles.has(text)) noise.add(ln);
    }
  }

  const phrasePrefixCounts = new Map();
  for (const ln of collapsed) {
    const t = ln.trim();
    if (!t || /^#{1,6}\s+/.test(t)) continue;
    const sentences = t.split(/(?<=[.!?])\s+/);
    const head = sentences[0]?.trim();
    if (!head || head.length < 12 || head.length > 80) continue;
    if (/[.!?]$/.test(head)) continue;
    phrasePrefixCounts.set(head, (phrasePrefixCounts.get(head) || 0) + 1);
  }
  const recurringPhrases = [];
  for (const [phrase, count] of phrasePrefixCounts) {
    if (count >= 4) recurringPhrases.push(phrase);
  }
  recurringPhrases.sort((a, b) => b.length - a.length);

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const dedup = collapsed
    .filter((ln) => !noise.has(ln.trim()))
    .map((ln) => {
      let out = ln;
      for (const phrase of recurringPhrases) {
        const re = new RegExp(`(^|\\s)${escapeRegex(phrase)}(\\s+|$)`, 'g');
        out = out.replace(re, (_, pre, post) => (pre && post.trim() ? ' ' : pre || post));
      }
      return out;
    });

  const tocCleaned = dedup.map((ln) =>
    ln
      .replace(/_{3,}\s*(\d+)\s*$/g, '— $1')
      .replace(/_{3,}/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
  );

  const final = [];
  let blanks = 0;
  for (const ln of tocCleaned) {
    if (ln.trim() === '') {
      blanks++;
      if (blanks <= 1) final.push('');
    } else {
      blanks = 0;
      final.push(ln);
    }
  }

  return final.join('\n').replace(/^\n+|\n+$/g, '') + '\n';
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function extractParagraphsFromSlideXml(xml) {
  const paragraphs = [];
  const paraRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  const textRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  let pMatch;
  while ((pMatch = paraRe.exec(xml)) !== null) {
    const inner = pMatch[1];
    const runs = [];
    let tMatch;
    while ((tMatch = textRe.exec(inner)) !== null) {
      runs.push(decodeXmlEntities(tMatch[1]));
    }
    const text = runs.join('').trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function extractNotesFromXml(xml) {
  return extractParagraphsFromSlideXml(xml).filter((p) => !/^\d+$/.test(p));
}

async function convertPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const an = Number(a.match(/slide(\d+)\.xml$/)[1]);
      const bn = Number(b.match(/slide(\d+)\.xml$/)[1]);
      return an - bn;
    });

  if (slideEntries.length === 0) {
    return { markdown: '', warnings: ['No slides found in pptx'] };
  }

  const sections = [];
  let imageCount = 0;
  for (let i = 0; i < slideEntries.length; i++) {
    const slideNum = i + 1;
    const xml = await zip.file(slideEntries[i]).async('string');
    const paragraphs = extractParagraphsFromSlideXml(xml);

    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notes = [];
    if (zip.file(notesPath)) {
      const notesXml = await zip.file(notesPath).async('string');
      notes = extractNotesFromXml(notesXml);
    }

    const heading = paragraphs[0] || `Slide ${slideNum}`;
    const body = paragraphs.slice(paragraphs.length > 1 ? 1 : 0).map((p) => `- ${p}`).join('\n');

    let section = `## Slide ${slideNum}: ${heading}`;
    if (paragraphs.length > 1) section += `\n\n${body}`;
    if (notes.length) section += `\n\n_Notes_\n\n${notes.map((n) => `> ${n}`).join('\n')}`;
    sections.push(section);
  }

  const mediaFiles = Object.keys(zip.files).filter((n) => /^ppt\/media\//.test(n));
  imageCount = mediaFiles.length;
  const warnings = imageCount > 0 ? [`${imageCount} image(s) stripped`] : [];

  return { markdown: sections.join('\n\n').trim() + '\n', warnings };
}

export async function convert(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  let result;
  switch (ext) {
    case '.docx':
      result = await convertDocx(buffer);
      break;
    case '.pdf':
      result = await convertPdf(buffer);
      break;
    case '.pptx':
      result = await convertPptx(buffer);
      break;
    default:
      throw new Error(`Unsupported file type: ${ext || '(none)'}. Supported: .docx, .pdf, .pptx`);
  }
  return { markdown: postProcessMarkdown(result.markdown), warnings: result.warnings };
}
