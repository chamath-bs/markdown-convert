// Quick smoke test of /api/convert with small generated fixtures.
// Generates a minimal DOCX and PPTX using JSZip, plus a tiny PDF crafted by hand.
// Then POSTs each to /api/convert and prints the result.

import JSZip from 'jszip';

const BASE = 'http://127.0.0.1:3001';

async function makeDocx() {
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
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Hello Heading</w:t></w:r></w:p>
    <w:p><w:r><w:t>This is a test paragraph.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Bullet one</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makePptx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.folder('ppt').file('presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`);
  zip.folder('ppt').folder('_rels').file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
  zip.folder('ppt').folder('slides').file('slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>Slide title text</a:t></a:r></a:p>
      <a:p><a:r><a:t>Body line on slide 1</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function makePdf() {
  // Minimal valid PDF with a single text object "Hello PDF"
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 24 Tf 100 700 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000109 00000 n
0000000211 00000 n
0000000305 00000 n
trailer << /Size 6 /Root 1 0 R >>
startxref
369
%%EOF
`;
  return Buffer.from(pdf, 'binary');
}

async function post(filename, buffer, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime }), filename);
  const r = await fetch(`${BASE}/api/convert`, { method: 'POST', body: fd });
  return r.json();
}

const fixtures = [
  ['hello.docx', await makeDocx(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['hello.pdf',  makePdf(),         'application/pdf'],
  ['hello.pptx', await makePptx(), 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
];

for (const [name, buf, mime] of fixtures) {
  try {
    const result = await post(name, buf, mime);
    const ok = result.ok ? 'OK ' : 'FAIL';
    const preview = result.ok
      ? JSON.stringify(result.markdown.slice(0, 120))
      : result.error;
    console.log(`[${ok}] ${name}  ->  ${preview}`);
  } catch (err) {
    console.log(`[FAIL] ${name}  ->  ${err.message}`);
  }
}
