import React from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import { html } from './lib/htm.js';
import { C } from './lib/theme.js';
import { isFsaSupported, pickOutputDirectory, writeMarkdown, toMarkdownPath } from './lib/fsa.js';
import {
  FileText, FileType2, Presentation, Folder, FolderOpen, Upload, Play, X,
  CheckCircle2, AlertCircle, Loader2, Trash2,
} from './lib/icons.js';

const { useCallback, useMemo, useRef, useState } = React;

const SUPPORTED_EXTS = ['docx', 'pdf', 'pptx'];

function extOf(name) {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}
function isSupported(name) { return SUPPORTED_EXTS.includes(extOf(name)); }
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function uid() { return Math.random().toString(36).slice(2, 10); }

function iconFor(ext) {
  if (ext === 'docx') return FileText;
  if (ext === 'pdf') return FileType2;
  if (ext === 'pptx') return Presentation;
  return FileText;
}

function statusBadge(status) {
  switch (status) {
    case 'queued':     return { label: 'Queued',     fg: C.greyDark, bg: C.greyPale };
    case 'converting': return { label: 'Converting', fg: C.orange,   bg: C.peachLight };
    case 'done':       return { label: 'Done',       fg: C.green,    bg: C.greenLight };
    case 'failed':     return { label: 'Failed',     fg: C.redOrange, bg: '#FCE5DF' };
    case 'cancelled':  return { label: 'Cancelled',  fg: C.greyMid,  bg: C.greyPale };
    default:           return { label: status,       fg: C.greyDark, bg: C.greyPale };
  }
}

function App() {
  const fsaOk = isFsaSupported();
  const [items, setItems] = useState([]);
  const [outputDir, setOutputDir] = useState(null);
  const [outputDirName, setOutputDirName] = useState('');
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cancelRef = useRef(false);
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const counts = useMemo(() => {
    const c = { total: items.length, done: 0, failed: 0, queued: 0, converting: 0, cancelled: 0 };
    for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
    return c;
  }, [items]);

  const progressPct = counts.total === 0
    ? 0
    : Math.round(((counts.done + counts.failed + counts.cancelled) / counts.total) * 100);

  const addFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;
    setItems((prev) => {
      const existing = new Set(prev.map((p) => p.relativePath + '|' + p.size));
      const next = [...prev];
      for (const f of incoming) {
        const relativePath = f.webkitRelativePath || f.name;
        const key = relativePath + '|' + f.size;
        if (existing.has(key)) continue;
        existing.add(key);
        const supported = isSupported(f.name);
        next.push({
          id: uid(),
          file: f,
          name: f.name,
          relativePath,
          size: f.size,
          ext: extOf(f.name),
          status: supported ? 'queued' : 'failed',
          error: supported ? null : `Unsupported file type (.${extOf(f.name) || '?'})`,
          warnings: [],
        });
      }
      return next;
    });
  }, []);

  const onPickFiles = () => filesInputRef.current?.click();
  const onPickFolder = () => folderInputRef.current?.click();

  const onPickOutput = async () => {
    try {
      const dir = await pickOutputDirectory();
      setOutputDir(dir);
      setOutputDirName(dir.name);
    } catch (err) {
      if (err?.name !== 'AbortError') console.error(err);
    }
  };

  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.id !== id));
  const clearAll = () => setItems([]);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const updateItem = (id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const runOne = async (item) => {
    const fd = new FormData();
    fd.append('file', item.file, item.name);
    const resp = await fetch('/api/convert', { method: 'POST', body: fd });
    const data = await resp.json().catch(() => ({ ok: false, error: `HTTP ${resp.status}` }));
    if (!data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  };

  const start = async () => {
    if (!outputDir || running) return;
    cancelRef.current = false;
    setRunning(true);
    const queue = items.filter((it) => it.status === 'queued');
    for (const item of queue) {
      if (cancelRef.current) {
        updateItem(item.id, { status: 'cancelled' });
        continue;
      }
      updateItem(item.id, { status: 'converting', error: null, warnings: [] });
      try {
        const { markdown, warnings } = await runOne(item);
        const targetPath = toMarkdownPath(preserveStructure ? item.relativePath : item.name);
        await writeMarkdown(outputDir, targetPath, markdown);
        const outputBytes = new TextEncoder().encode(markdown).length;
        updateItem(item.id, { status: 'done', warnings: warnings || [], outputPath: targetPath, outputBytes });
      } catch (err) {
        updateItem(item.id, { status: 'failed', error: err?.message || String(err) });
      }
    }
    setRunning(false);
  };

  const cancel = () => { cancelRef.current = true; };

  const styles = {
    page: { minHeight: '100vh', padding: '24px 32px 64px', maxWidth: 1100, margin: '0 auto' },
    header: { display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: `4px solid ${C.orange}`, marginBottom: 24 },
    title: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: 0 },
    tagline: { fontSize: 13, color: C.greyDark, marginLeft: 'auto' },
    card: { background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 16 },
    sectionTitle: { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.greyMid, marginBottom: 12 },
    dropZone: {
      border: `2px dashed ${dragOver ? C.orange : C.border}`,
      background: dragOver ? C.peachLight : C.white,
      borderRadius: 10, padding: 32, textAlign: 'center', transition: 'all 120ms ease',
    },
    btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: `1px solid ${C.border}`, background: C.white, borderRadius: 6, cursor: 'pointer', fontSize: 14, color: C.black },
    btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', border: 'none', background: C.orange, color: C.white, borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
    btnGhost: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: C.greyDark },
    btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
    row: { display: 'flex', alignItems: 'center', gap: 10 },
    flexBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    progressTrack: { height: 6, background: C.greyPale, borderRadius: 999, overflow: 'hidden', flex: 1 },
    progressFill: { height: '100%', background: C.orange, width: `${progressPct}%`, transition: 'width 200ms ease' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', fontWeight: 600, color: C.greyDark, padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' },
    td: { padding: '10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle' },
    notice: { padding: 12, background: C.peachLight, color: C.redOrange, borderRadius: 6, fontSize: 13, marginBottom: 16 },
    smallNote: { fontSize: 12, color: C.greyMid, marginTop: 6 },
  };

  const badgeStyle = (b) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
    borderRadius: 999, fontSize: 11, fontWeight: 600, color: b.fg, background: b.bg,
  });

  if (!fsaOk) {
    return html`
      <div style=${styles.page}>
        <div style=${styles.header}>
          <h1 style=${styles.title}>Markdown Convert</h1>
        </div>
        <div style=${{ ...styles.card, ...styles.notice }}>
          This app uses the File System Access API to auto-save converted files. It only works in Chrome or Edge. Please re-open this page in one of those browsers.
        </div>
      </div>
    `;
  }

  const canConvert = !!outputDir && !running && items.some((i) => i.status === 'queued');

  return html`
    <div style=${styles.page}>
      <div style=${styles.header}>
        <h1 style=${styles.title}>Markdown Convert</h1>
        <span style=${styles.tagline}>DOCX · PDF · PPTX → lightweight .md</span>
      </div>

      <div style=${styles.card}>
        <div style=${styles.sectionTitle}>1. Add files</div>
        <div
          style=${styles.dropZone}
          onDragOver=${onDragOver}
          onDragLeave=${onDragLeave}
          onDrop=${onDrop}
        >
          <${Upload} size=${28} color=${C.greyMid} style=${{ marginBottom: 8 }} />
          <div style=${{ fontSize: 14, color: C.greyDark, marginBottom: 12 }}>
            Drag & drop files here, or pick them below.
          </div>
          <div style=${{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button style=${styles.btn} onClick=${onPickFiles}>
              <${FileText} size=${14} /> Choose files
            </button>
            <button style=${styles.btn} onClick=${onPickFolder}>
              <${Folder} size=${14} /> Choose folder
            </button>
          </div>
          <input
            ref=${filesInputRef}
            type="file"
            multiple
            accept=".docx,.pdf,.pptx"
            style=${{ display: 'none' }}
            onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <input
            ref=${folderInputRef}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            style=${{ display: 'none' }}
            onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      </div>

      <div style=${styles.card}>
        <div style=${styles.sectionTitle}>2. Choose output folder</div>
        <div style=${styles.flexBetween}>
          <div style=${styles.row}>
            <button style=${styles.btn} onClick=${onPickOutput}>
              <${FolderOpen} size=${14} /> ${outputDir ? 'Change folder' : 'Choose output folder'}
            </button>
            ${outputDir && html`
              <span style=${{ fontSize: 13, color: C.greyDark }}>
                Saving to <strong style=${{ color: C.black }}>${outputDirName}/</strong>
              </span>
            `}
          </div>
          <label style=${{ ...styles.row, fontSize: 13, color: C.greyDark, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked=${preserveStructure}
              onChange=${(e) => setPreserveStructure(e.target.checked)}
            />
            Preserve folder structure
          </label>
        </div>
        <div style=${styles.smallNote}>
          Images, charts, and graphics are stripped from output. Image/chart summarisation coming later.
        </div>
      </div>

      <div style=${styles.card}>
        <div style=${styles.flexBetween}>
          <div style=${styles.sectionTitle}>3. Convert</div>
          <div style=${{ fontSize: 12, color: C.greyMid }}>
            ${counts.total} file${counts.total === 1 ? '' : 's'} · ${counts.done} done · ${counts.failed} failed
          </div>
        </div>
        <div style=${{ ...styles.row, marginTop: 4 }}>
          ${!running
            ? html`<button
                style=${{ ...styles.btnPrimary, ...(canConvert ? {} : styles.btnDisabled) }}
                onClick=${start}
                disabled=${!canConvert}
              >
                <${Play} size=${14} /> Convert all
              </button>`
            : html`<button style=${styles.btn} onClick=${cancel}>
                <${X} size=${14} /> Cancel
              </button>`}
          ${items.length > 0 && !running && html`
            <button style=${styles.btnGhost} onClick=${clearAll}>
              <${Trash2} size=${14} /> Clear list
            </button>
          `}
          <div style=${styles.progressTrack}>
            <div style=${styles.progressFill}></div>
          </div>
          <span style=${{ fontSize: 12, color: C.greyMid, minWidth: 36, textAlign: 'right' }}>${progressPct}%</span>
        </div>
        ${!outputDir && html`
          <div style=${{ ...styles.smallNote, color: C.redOrange }}>
            Choose an output folder before converting.
          </div>
        `}
      </div>

      ${items.length > 0 && html`
        <div style=${styles.card}>
          <table style=${styles.table}>
            <thead>
              <tr>
                <th style=${styles.th}>File</th>
                <th style=${{ ...styles.th, width: 70 }}>Type</th>
                <th style=${{ ...styles.th, width: 80 }}>Size</th>
                <th style=${{ ...styles.th, width: 110 }}>Status</th>
                <th style=${{ ...styles.th, width: 90 }}>Output</th>
                <th style=${styles.th}>Notes</th>
                <th style=${{ ...styles.th, width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              ${items.map((it) => {
                const Icon = iconFor(it.ext);
                const badge = statusBadge(it.status);
                return html`
                  <tr key=${it.id}>
                    <td style=${styles.td}>
                      <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <${Icon} size=${14} color=${C.greyDark} />
                        <div>
                          <div style=${{ color: C.black }}>${it.name}</div>
                          ${it.relativePath !== it.name && html`
                            <div style=${{ fontSize: 11, color: C.greyMid }}>${it.relativePath}</div>
                          `}
                        </div>
                      </div>
                    </td>
                    <td style=${{ ...styles.td, color: C.greyDark, textTransform: 'uppercase', fontSize: 11 }}>${it.ext}</td>
                    <td style=${{ ...styles.td, color: C.greyDark }}>${fmtBytes(it.size)}</td>
                    <td style=${styles.td}>
                      <span style=${badgeStyle(badge)}>
                        ${it.status === 'converting' && html`<${Loader2} size=${11} className="spin" />`}
                        ${it.status === 'done' && html`<${CheckCircle2} size=${11} />`}
                        ${it.status === 'failed' && html`<${AlertCircle} size=${11} />`}
                        ${badge.label}
                      </span>
                    </td>
                    <td style=${{ ...styles.td, color: C.greyDark }}>
                      ${typeof it.outputBytes === 'number' ? fmtBytes(it.outputBytes) : ''}
                    </td>
                    <td style=${{ ...styles.td, color: it.status === 'failed' ? C.redOrange : C.greyMid, fontSize: 12 }}>
                      ${it.error
                        ? it.error
                        : it.warnings && it.warnings.length
                          ? it.warnings.join('; ')
                          : it.status === 'done' && it.outputPath
                            ? `→ ${it.outputPath}`
                            : ''}
                    </td>
                    <td style=${styles.td}>
                      ${!running && html`
                        <button
                          onClick=${() => removeItem(it.id)}
                          style=${{ ...styles.btnGhost, padding: 4 }}
                          title="Remove"
                        >
                          <${X} size=${14} />
                        </button>
                      `}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
