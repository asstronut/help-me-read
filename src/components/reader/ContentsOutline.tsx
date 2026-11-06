'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/cn';
import { ChevronRightIcon, MenuIcon } from '@/components/ui/icons';
import { findItem, type ContentsItem } from '@/lib/reader/contents';
import { TOUCH, WIDE, useMediaQuery } from './useMediaQuery';

type Props = {
  /** The book's contents; null while they are being read. */
  items: ContentsItem[] | null;
  /** The entry the reader is in. */
  currentId: string | null;
  onGo: (item: ContentsItem) => void;
  /** Shown when the book has no contents, e.g. "No contents in this PDF". */
  emptyText: string;
  className?: string;
};

type OutlineProps = Props & {
  /**
   * `rail`: in the column beside the book (see ContentsRail). `bar`: the ☰ button in the top bar
   * (a phone), opening the list over the book.
   */
  placement: 'rail' | 'bar';
  /** The rail has room to stay open beside the book; when false the list opens over the book. */
  docked?: boolean;
  /** The rail is open (when docked), and the button that opens and closes it. */
  railOpen?: boolean;
  onRailToggle?: () => void;
};

/** The rail's width when open (the ☰ button alone is 44px). */
export const RAIL_WIDTH = 240;

type RailProps = Props & {
  /** False while a side panel is open: the rail then folds to its ☰ button. */
  roomBeside: boolean;
  /** Where the ☰ button's box starts, from the top of the column (may be negative), to line it up with the text. */
  top: number;
  /** The book. */
  children: ReactNode;
  /** Classes for the rail itself (not the book), such as hiding it with the other controls. */
  outlineClassName?: string;
};

/**
 * The book with its contents rail on the left: open (240px) when the window is wide and no side
 * panel needs the room, else just the ☰ button (44px). The same width is kept free on the right,
 * so the book stays centred. On a phone there is no rail (the ☰ button is in the top bar). On a
 * tablet it is just the ☰ button too, so a page held sideways has room for two columns.
 */
export function ContentsRail({ roomBeside, top, children, className, outlineClassName, ...props }: RailProps) {
  const wide = useMediaQuery(WIDE);
  const touch = useMediaQuery(TOUCH);
  const docked = wide && !touch && roomBeside;
  const [railOpen, setRailOpen] = useState(true);
  const width = docked && railOpen ? RAIL_WIDTH : 44;
  return (
    <div className={cn('flex min-h-0 flex-1 sm:px-7', className)}>
      <ContentsOutline
        {...props}
        placement="rail"
        docked={docked}
        railOpen={railOpen}
        onRailToggle={() => setRailOpen((o) => !o)}
        className={cn('hidden sm:flex', outlineClassName)}
        style={{ width, marginTop: top }}
      />
      <div className="flex min-w-0 flex-1">{children}</div>
      <div aria-hidden="true" className="hidden sm:block" style={{ flex: `0 1 ${width}px` }} />
    </div>
  );
}

/** The book's contents: Volume › Chapter, the current entry marked. */
export function ContentsOutline({
  items,
  currentId,
  onGo,
  emptyText,
  placement,
  docked = false,
  railOpen = false,
  onRailToggle,
  className,
  style,
}: OutlineProps & { style?: CSSProperties }) {
  // The list over the book starts closed.
  const [floatOpen, setFloatOpen] = useState(false);
  const open = docked ? railOpen : floatOpen;
  const listId = useId();
  const navRef = useRef<HTMLElement>(null);

  // The list over the book closes on Escape and on a press anywhere else.
  useEffect(() => {
    if (docked || !floatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setFloatOpen(false);
      navRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    const onPress = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setFloatOpen(false);
    };
    // The EPUB text is in an iframe, whose presses never reach this document: leaving the window
    // for it shows up as a blur.
    const onBlur = () => setFloatOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
      window.removeEventListener('blur', onBlur);
    };
  }, [docked, floatOpen]);

  const toggle = () => (docked ? onRailToggle?.() : setFloatOpen((o) => !o));
  const go = (item: ContentsItem) => {
    onGo(item);
    if (!docked) setFloatOpen(false);
  };

  return (
    <nav
      ref={navRef}
      aria-label="Contents"
      style={style}
      // No display class here: the rail hides it on a phone (`hidden sm:flex`).
      className={cn('relative min-h-0 shrink-0 flex-col font-sans', placement === 'bar' && 'flex', className)}
    >
      <IconButton
        aria-label="Contents"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={toggle}
        // The icon lines up with the Library chevron above it.
        className={cn(placement === 'rail' && '-ml-[13px]', open && 'text-ink')}
      >
        <MenuIcon />
      </IconButton>
      {open && (
        <div
          id={listId}
          className={cn(
            'flex min-h-0 flex-col overflow-y-auto overscroll-contain',
            docked
              ? 'pb-4'
              : // Over the book: a card under the button (on a phone, across the width under the bar).
                'z-30 max-h-[70dvh] rounded-xl border border-rule bg-surface px-3 py-2 text-ink shadow-[0_8px_24px_var(--shadow)]',
            !docked && placement === 'rail' && 'absolute top-12 -left-[13px] w-72',
            placement === 'bar' && 'fixed inset-x-2 top-14',
          )}
        >
          <ContentsList items={items} currentId={currentId} onGo={go} emptyText={emptyText} />
        </div>
      )}
    </nav>
  );
}

function ContentsList({
  items,
  currentId,
  onGo,
  emptyText,
}: Pick<Props, 'items' | 'currentId' | 'onGo' | 'emptyText'>) {
  // A volume is open when the reader asked for it, else when the current chapter is in it.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (items === null) return <p className="py-3 text-sm text-muted">Loading…</p>;
  if (items.length === 0) return <p className="py-3 text-sm text-muted">{emptyText}</p>;
  const currentParent = findItem(items, currentId)?.parent?.id ?? null;

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        if (item.children.length === 0) {
          return (
            <li key={item.id}>
              <Entry item={item} current={item.id === currentId} onGo={onGo} />
            </li>
          );
        }
        const expanded = toggled[item.id] ?? item.id === currentParent;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setToggled((t) => ({ ...t, [item.id]: !expanded }))}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg text-left text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ChevronRightIcon
                size={14}
                className={cn('shrink-0 transition-transform', expanded && 'rotate-90')}
              />
              <span className="min-w-0 break-words">{item.label}</span>
            </button>
            {expanded && (
              <ul>
                {item.children.map((child) => (
                  <li key={child.id}>
                    <Entry item={child} current={child.id === currentId} onGo={onGo} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A chapter: goes there; the current one has a dot and full ink. */
function Entry({
  item,
  current,
  onGo,
}: {
  item: ContentsItem;
  current: boolean;
  onGo: (item: ContentsItem) => void;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', current ? 'bg-accent' : 'bg-transparent')}
      />
      <span className="min-w-0 break-words">{item.label}</span>
    </>
  );
  const classes = cn(
    'flex min-h-11 w-full items-center gap-2.5 rounded-lg py-1 pl-1 text-left text-sm',
    current ? 'text-ink' : 'text-muted',
  );
  if (!item.target) return <span className={classes}>{body}</span>;
  return (
    <button
      type="button"
      aria-current={current ? 'location' : undefined}
      onClick={() => onGo(item)}
      className={cn(
        classes,
        'cursor-pointer hover:text-ink focus-visible:outline-2 focus-visible:outline-accent',
      )}
    >
      {body}
    </button>
  );
}
