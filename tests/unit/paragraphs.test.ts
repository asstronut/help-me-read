import { expect, test } from 'vitest';
import { cleanParagraphs } from '../../src/lib/extract/paragraphs';

test('a NUL character in extracted text reads as a space, since Postgres cannot store it', () => {
  expect(cleanParagraphs(['edible\u0000Label the item', '\u0000', 'plain  text'])).toEqual([
    'edible Label the item',
    'plain text',
  ]);
});
