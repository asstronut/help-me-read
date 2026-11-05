'use client';

type Props = {
  onPrev: () => void;
  onNext: () => void;
};

const button = 'rounded px-2 py-1 text-sm hover:bg-gray-500/10 disabled:opacity-40';

/** The EPUB's page-turn buttons. */
export function ReaderToolbar({ onPrev, onNext }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-300/50 px-2 py-1">
      <button type="button" aria-label="Previous page" onClick={onPrev} className={button}>
        ‹
      </button>
      <button type="button" aria-label="Next page" onClick={onNext} className={button}>
        ›
      </button>
    </div>
  );
}
