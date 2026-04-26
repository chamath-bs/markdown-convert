import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { convert } from './converters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const PORT = Number(process.env.PORT) || 3001;
const HOST = '127.0.0.1';
const MAX_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const app = express();

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/convert', upload.single('file'), async (req, res) => {
  const started = Date.now();
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No file in request (expected field "file").' });
  }
  const { originalname, size, buffer } = req.file;
  try {
    const { markdown, warnings } = await convert(buffer, originalname);
    const ms = Date.now() - started;
    console.log(`[convert] ${originalname} (${size} bytes) -> ${markdown.length} chars in ${ms}ms${warnings.length ? ` warnings=${warnings.length}` : ''}`);
    res.json({ ok: true, markdown, warnings });
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`[convert] ${originalname} failed: ${message}`);
    res.status(500).json({ ok: false, error: message });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: `File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit.` });
  }
  res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
});

app.listen(PORT, HOST, () => {
  console.log(`[markdown-convert] listening on http://${HOST}:${PORT}`);
});
