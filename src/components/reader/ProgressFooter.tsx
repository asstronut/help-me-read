import { cn } from '@/components/ui/cn';

type Props = {
  /** How far through the book the reader is, 0 to 1; null until it is known. */
  fraction: number | null;
  className?: string;
};

/** A thin line under the book showing how far through it the reader is, with the percentage. */
export function ProgressFooter({ fraction, className }: Props) {
  const percent = fraction === null ? null : Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <footer className={cn('flex flex-col gap-2 px-4 pt-2 pb-3 sm:gap-2.5 sm:px-7 sm:pt-4 sm:pb-[22px]', className)}>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-0.5 overflow-hidden rounded-[1px] bg-rule"
      >
        <div className="h-full bg-muted" style={{ width: `${percent ?? 0}%` }} />
      </div>
      {/* The progress bar above already gives screen readers the number. */}
      <div aria-hidden="true" className="min-h-4 text-xs text-muted tabular-nums">
        {percent !== null && `${percent}%`}
      </div>
    </footer>
  );
}
