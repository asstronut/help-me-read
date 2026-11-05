// Generates the test books in tests/fixtures. Run: npx tsx tests/fixtures/make-fixtures.ts
// sample.*: the books most tests use. contents.*: books with a two-level table of contents.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, StandardFonts, type PDFRef } from 'pdf-lib';

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

type Chapter = { id: string; title: string; body: string };

/** An EPUB 3 with these chapters in its spine and `toc` (the <ol> of its nav) as its contents. */
async function makeEpub(title: string, chapters: Chapter[], toc: string): Promise<Uint8Array> {
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
  const manifest = chapters
    .map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n');
  add(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:7b0f2a52-3c1e-4f55-9a50-2f6c5d1e8a01</dc:identifier>
<dc:title>${title}</dc:title>
<dc:creator>${AUTHOR}</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
</manifest>
<spine>
${spine}
</spine>
</package>
`,
  );
  add('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc" id="toc">${toc}</nav>`));
  for (const c of chapters) add(`OEBPS/${c.id}.xhtml`, xhtml(c.title, c.body));

  return zip.generateAsync({
    type: 'uint8array',
    mimeType: 'application/epub+zip',
  });
}

const sampleEpub = () =>
  makeEpub(
    TITLE,
    [
      { id: 'ch1', title: 'One', body: Array.from({ length: 12 }, (_, i) => `<p>${paragraph(i + 1)}</p>`).join('\n') },
      { id: 'ch2', title: 'Two', body: '<p>Second chapter text.</p>' },
    ],
    `<ol>
<li><a href="ch1.xhtml">One</a></li>
<li><a href="ch2.xhtml">Two</a></li>
</ol>`,
  );

/** Two volumes of chapters: Volume I › Chapter 1, Chapter 2; Volume II › Chapter 3. */
const contentsEpub = () =>
  makeEpub(
    'Contents Book',
    [1, 2, 3].map((n) => ({
      id: `ch${n}`,
      title: `Chapter ${n}`,
      body: Array.from({ length: 3 }, (_, i) => `<p>C${n} ${paragraph(i + 1)}</p>`).join('\n'),
    })),
    `<ol>
<li><span>Volume I</span><ol>
<li><a href="ch1.xhtml">Chapter 1</a></li>
<li><a href="ch2.xhtml">Chapter 2</a></li>
</ol></li>
<li><span>Volume II</span><ol>
<li><a href="ch3.xhtml">Chapter 3</a></li>
</ol></li>
</ol>`,
  );

type Bookmark = { title: string; page?: number; children?: Bookmark[] };

/**
 * Adds a bookmark tree (the PDF's /Outlines) to the document. Each bookmark with a page goes to
 * the top of that page (0-based here, as pdf-lib counts).
 */
function addBookmarks(doc: PDFDocument, bookmarks: Bookmark[]) {
  const { context } = doc;
  const pages = doc.getPages();
  const build = (items: Bookmark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = items.map(() => context.nextRef());
    let count = items.length;
    items.forEach((item, i) => {
      const dict = context.obj({});
      dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
      dict.set(PDFName.of('Parent'), parent);
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      if (item.page !== undefined) {
        dict.set(PDFName.of('Dest'), context.obj([pages[item.page].ref, 'Fit']));
      }
      if (item.children?.length) {
        const sub = build(item.children, refs[i]);
        dict.set(PDFName.of('First'), sub.first);
        dict.set(PDFName.of('Last'), sub.last);
        dict.set(PDFName.of('Count'), PDFNumber.of(sub.count));
        count += sub.count;
      }
      context.assign(refs[i], dict);
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  };
  const outlines = context.nextRef();
  const top = build(bookmarks, outlines);
  context.assign(
    outlines,
    context.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }),
  );
  doc.catalog.set(PDFName.of('Outlines'), outlines);
}

/** Six pages with bookmarks: Part One › Chapter 1 (page 1), Chapter 2 (page 3); Part Two › Chapter 3 (page 5). */
async function makeContentsPdf(): Promise<Uint8Array> {
  // No dates in the file, so it comes out the same every time.
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle('Contents Book');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const chapterOf = [1, 1, 2, 2, 3, 3];
  chapterOf.forEach((chapter, i) => {
    const page = doc.addPage([612, 792]);
    page.drawText(`Chapter ${chapter}, page ${i + 1}.`, { x: 72, y: 720, size: 14, font });
    page.drawText(`Words on page ${i + 1} of the contents book.`, { x: 72, y: 400, size: 14, font });
  });
  addBookmarks(doc, [
    {
      title: 'Part One',
      children: [
        { title: 'Chapter 1', page: 0 },
        { title: 'Chapter 2', page: 2 },
      ],
    },
    { title: 'Part Two', children: [{ title: 'Chapter 3', page: 4 }] },
  ]);
  return doc.save();
}

writeFileSync(join(dir, 'sample.pdf'), await makePdf());
writeFileSync(join(dir, 'sample.epub'), await sampleEpub());
writeFileSync(join(dir, 'contents.pdf'), await makeContentsPdf());
writeFileSync(join(dir, 'contents.epub'), await contentsEpub());
console.log('Wrote sample.pdf, sample.epub, contents.pdf and contents.epub');
