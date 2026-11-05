import Link from 'next/link';
import { cn } from './ui/cn';

const PAGES = [
  { href: '/library', label: 'Library' },
  { href: '/vocab', label: 'Vocab' },
  { href: '/settings', label: 'Settings' },
] as const;

export type SitePage = (typeof PAGES)[number]['label'];

/** The name of the app and the links between the pages around the books. */
export function SiteNav({ current }: { current: SitePage }) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="font-serif text-xl italic">help me read</span>
      <div className="flex gap-1 text-sm">
        {PAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            aria-current={p.label === current ? 'page' : undefined}
            className={cn(
              'inline-flex h-11 items-center rounded-full px-3.5 transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              p.label === current ? 'bg-chip text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
