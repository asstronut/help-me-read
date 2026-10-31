'use client';

import { SelectionMenu } from '@/components/reader/SelectionMenu';

export function MenuPreview({ words }: { words: number }) {
  const text = Array.from({ length: words }, () => 'word').join(' ');
  return (
    <SelectionMenu
      selection={{ bookId: 'test', segmentSeq: 0, text, prefix: '', anchor: { format: 'epub', cfi: '' } }}
      box={{ top: 200, bottom: 220, left: 100, right: 200 }}
      onPick={() => undefined}
      onColor={() => undefined}
    />
  );
}
