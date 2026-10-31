// Generates tests/fixtures/sample.pdf and sample.epub. Run: npx tsx tests/fixtures/make-fixtures.ts
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const dir = dirname(fileURLToPath(import.meta.url));
const TITLE = 'Sample Book';
const AUTHOR = 'Test Author';

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(TITLE);
  doc.setAuthor(AUTHOR);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const pages: string[][] = [
    [
      'She sat on the bank. The bank was steep. She sat on the bank.',
      '',
      'The river moved slowly under a pale and ephem-',
      'eral light.',
      'Across the page break',
    ],
    ['into page two.', '', 'Ephemeral joys fade quickly.'],
    ['Final page.'],
  ];

  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    let y = 720;
    for (const line of lines) {
      if (line) page.drawText(line, { x: 72, y, size: 14, font });
      y -= 20;
    }
  }
  return doc.save();
}

const FILLER =
  'the quiet river carried small boats past old stone bridges while patient readers turned pages beneath tall trees and listened to distant bells ring across the valley as evening settled slowly over every field and road'.split(
    ' ',
  );

function paragraph(n: number): string {
  const words = [`P${n}`];
  for (let i = 0; words.length < 60; i++) words.push(FILLER[(i + n) % FILLER.length]);
  return words.join(' ');
}

const xhtml = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
<h1>${title}</h1>
${body}
</body>
</html>
`;

async function makeEpub(): Promise<Uint8Array> {
  const date = new Date(Date.UTC(2026, 0, 1));
  const zip = new JSZip();
  const add = (name: string, content: string, compress = true) =>
    zip.file(name, content, {
      date,
      compression: compress ? 'DEFLATE' : 'STORE',
    });

  add('mimetype', 'application/epub+zip', false);
  add(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
  );
  add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:7b0f2a52-3c1e-4f55-9a50-2f6c5d1e8a01</dc:identifier>
<dc:title>${TITLE}</dc:title>
<dc:creator>${AUTHOR}</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine>
<itemref idref="ch1"/>
<itemref idref="ch2"/>
</spine>
</package>
`,
  );
  add(
    'OEBPS/nav.xhtml',
    xhtml(
      'Contents',
      `<nav epub:type="toc" id="toc"><ol>
<li><a href="ch1.xhtml">One</a></li>
<li><a href="ch2.xhtml">Two</a></li>
</ol></nav>`,
    ),
  );
  const chapterOne = Array.from({ length: 12 }, (_, i) => `<p>${paragraph(i + 1)}</p>`).join('\n');
  add('OEBPS/ch1.xhtml', xhtml('One', chapterOne));
  add('OEBPS/ch2.xhtml', xhtml('Two', '<p>Second chapter text.</p>'));

  return zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/epub+zip',
  });
}

writeFileSync(join(dir, 'sample.pdf'), await makePdf());
writeFileSync(join(dir, 'sample.epub'), await makeEpub());
console.log('Wrote sample.pdf and sample.epub');
