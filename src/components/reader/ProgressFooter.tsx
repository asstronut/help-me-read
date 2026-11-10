import { cn } from '@/components/ui/cn';

type Props = {
  /** How far through the book the reader is, 0 to 1; null until it is known. */
  fraction: number | null;
  className?: string;
};

/** A thin line under the book showing how far through it the reader is, with the percentage beside it. */
export function ProgressFooter({ fraction, className }: Props) {
  const percent = fraction === null ? null : Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <footer className={cn('flex items-center gap-3 px-4 py-2 sm:px-7', className)}>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-0.5 flex-1 overflow-hidden rounded-[1px] bg-rule"
      >
        <div className="h-full bg-muted" style={{ width: `${percent ?? 0}%` }} />
      </div>
      {/* The progress bar beside it already gives screen readers the number. */}
      <div aria-hidden="true" className="min-h-4 min-w-8 text-right text-xs leading-4 text-muted tabular-nums">
        {percent !== null && `${percent}%`}
      </div>
    </footer>
  );
}
