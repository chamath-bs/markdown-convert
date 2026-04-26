export function isFsaSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickOutputDirectory() {
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

async function getOrCreateSubdir(rootHandle, segments) {
  let dir = rootHandle;
  for (const seg of segments) {
    if (!seg) continue;
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  return dir;
}

export async function writeMarkdown(rootHandle, relativePath, markdown) {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const fileName = parts.pop();
  const dir = await getOrCreateSubdir(rootHandle, parts);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(markdown);
  await writable.close();
}

export function toMarkdownPath(originalPath) {
  return originalPath.replace(/\.(docx|pdf|pptx)$/i, '.md');
}
