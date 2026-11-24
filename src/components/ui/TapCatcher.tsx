import { cn } from './cn';

/**
 * An invisible layer over the whole window, under an open menu or sheet: a tap anywhere outside
 * lands here and only closes it, without also turning the page or picking a highlight. It also
 * catches taps over the EPUB text, whose iframe would otherwise keep them from this document.
 * Give it a z-index just below the thing it closes.
 */
export function TapCatcher({ onTap, className }: { onTap: () => void; className?: string }) {
  return <div aria-hidden="true" data-tap-catcher="" className={cn('fixed inset-0', className)} onClick={onTap} />;
}
