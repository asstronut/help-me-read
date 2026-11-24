'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/cn';
import { ChevronRightIcon, MenuIcon } from '@/components/ui/icons';
import { TapCatcher } from '@/components/ui/TapCatcher';
import { usePresence } from '@/components/ui/usePresence';
import { findItem, type ContentsItem } from '@/lib/reader/contents';

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
   * `rail`: in the column beside the book (see ContentsRail), with the chapter ticks under the ☰
   * button. `bar`: the ☰ button in the top bar (a phone).
   */
  placement: 'rail' | 'bar';
};

/** The rail's width: the ☰ button, with the chapter ticks under it. */
export const RAIL_WIDTH = 44;

type RailProps = Props & {
  /** Where the ☰ button's box starts, from the top of the column (may be negative), to line it up with the text. */
  top: number;
  /** The book. */
  children: ReactNode;
  /** Classes for the rail itself (not the book), such as hiding it with the other controls. */
  outlineClassName?: string;
  /**
   * Keeps the rail's width free on the right too, so the book stays centred in the window (the
   * default). Without it the book has all the room to the window's right edge.
   */
  balanced?: boolean;
};

/**
 * The book with its contents rail on the left: the ☰ button, which opens the list as a card over
 * the book, and under it a tick for each chapter that shows where you are in the book. The rail
 * keeps its width whatever else is open, so the book never shifts. The same width is kept free on
 * the right, so the book stays centred, unless `balanced` is off. On a phone there is no rail (the
 * ☰ button is in the top bar).
 */
export function ContentsRail({
  top,
  children,
  className,
  outlineClassName,
  balanced = true,
  ...props
}: RailProps) {
  return (
    <div className={cn('flex min-h-0 flex-1', balanced ? 'sm:px-7' : 'sm:pl-7', className)}>
      <ContentsOutline
        {...props}
        placement="rail"
        className={cn('hidden sm:flex', outlineClassName)}
        style={{ width: RAIL_WIDTH, marginTop: top }}
      />
      <div className="flex min-w-0 flex-1">{children}</div>
      {balanced && <div aria-hidden="true" className="hidden sm:block" style={{ flex: `0 1 ${RAIL_WIDTH}px` }} />}
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
  className,
  style,
}: OutlineProps & { style?: CSSProperties }) {
  // The list starts closed.
  const [open, setOpen] = useState(false);
  // The card stays a moment after closing, to lift back toward the button and fade.
  const floating = usePresence(open, FLOAT_EXIT_MS);
  const listId = useId();
  const navRef = useRef<HTMLElement>(null);

  // The list closes on Escape, and on a tap anywhere else: on the TapCatcher, which keeps that tap
  // from also turning the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      navRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    // A press on something above the catcher, such as the Aa popover or the selection menu.
    const onPress = (e: PointerEvent) => {
      const target = e.target as Element;
      // Closing on the catcher's press would take it away before its click, which would then land on the book.
      if (target.closest?.('[data-tap-catcher]') || navRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  const go = (item: ContentsItem) => {
    onGo(item);
    setOpen(false);
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
        onClick={() => setOpen((o) => !o)}
        // The icon lines up with the Library chevron above it.
        className={cn(placement === 'rail' && '-ml-[13px]', open && 'text-ink')}
      >
        <MenuIcon />
      </IconButton>
      {placement === 'rail' && items && items.length > 0 && (
        <ChapterTicks items={items} currentId={currentId} onGo={go} />
      )}
      {/* Just under the card, and over an open thread or highlights panel (z-40). */}
      {open && <TapCatcher onTap={() => setOpen(false)} className="z-44" />}
      {floating.mounted && (
        <FloatingCard
          // Only the open card is the one the button controls.
          id={floating.closing ? undefined : listId}
          placement={placement}
          closing={floating.closing}
        >
          <ContentsList items={items} currentId={currentId} onGo={go} emptyText={emptyText} />
        </FloatingCard>
      )}
    </nav>
  );
}

/** An entry as a tick, with the volume it is in (named on hover). */
type Tick = { item: ContentsItem; volume: string | null; head: boolean; groupStart: boolean };

/**
 * The entries as ticks, in reading order. A volume that goes somewhere gets a longer tick of its
 * own ahead of its chapters. A gap starts each volume, and each run of entries outside a volume.
 */
function ticksOf(items: readonly ContentsItem[]): Tick[] {
  const ticks: Tick[] = [];
  let inLooseRun = false;
  for (const item of items) {
    if (item.children.length === 0) {
      ticks.push({ item, volume: null, head: false, groupStart: !inLooseRun && ticks.length > 0 });
      inLooseRun = true;
      continue;
    }
    inLooseRun = false;
    let first = ticks.length > 0;
    if (item.target) {
      ticks.push({ item, volume: null, head: true, groupStart: first });
      first = false;
    }
    for (const child of item.children) {
      ticks.push({ item: child, volume: item.label, head: false, groupStart: first });
      first = false;
    }
  }
  return ticks;
}

/**
 * Under the ☰ button, a tick for each chapter, the current one long and in the accent colour:
 * where you are in the book at a glance. With a mouse the strip is one scrub area: the tick
 * nearest the pointer grows and names its chapter, and a click goes there. The ticks are too small
 * to be buttons, so they are hidden from screen readers and on touch screens; the ☰ list is the
 * way there. With more entries than room, the ticks press closer, down to touching.
 */
function ChapterTicks({
  items,
  currentId,
  onGo,
}: Pick<Props, 'currentId' | 'onGo'> & { items: ContentsItem[] }) {
  const ticks = ticksOf(items);
  // The tick under the pointer, and where its middle is in the strip (for its name).
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null);
  const tickRefs = useRef<(HTMLDivElement | null)[]>([]);

  const nearest = (y: number): number | null => {
    let best: number | null = null;
    let distance = Infinity;
    tickRefs.current.forEach((el, i) => {
      if (!el || i >= ticks.length) return;
      const box = el.getBoundingClientRect();
      const d = Math.abs(box.top + box.height / 2 - y);
      if (d < distance) {
        distance = d;
        best = i;
      }
    });
    return best;
  };

  const hovered = hover === null ? null : ticks[hover.index];

  return (
    <div
      aria-hidden="true"
      data-contents-ticks=""
      onPointerMove={(e) => {
        if (e.pointerType === 'touch') return;
        const index = nearest(e.clientY);
        const el = index === null ? null : tickRefs.current[index];
        if (index === null || !el) return setHover(null);
        if (index !== hover?.index) setHover({ index, y: el.offsetTop + el.offsetHeight / 2 });
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const at = nearest(e.clientY);
        const item = at === null ? null : ticks[at].item;
        if (item?.target) onGo(item);
      }}
      className="relative -ml-[13px] flex min-h-0 w-11 flex-1 cursor-pointer flex-col pt-2 pb-4 pointer-coarse:hidden"
    >
      {ticks.map((tick, i) => (
        <TickRow
          key={tick.item.id}
          tick={tick}
          current={tick.item.id === currentId}
          hovered={hover?.index === i}
          rowRef={(el) => {
            tickRefs.current[i] = el;
          }}
        />
      ))}
      {hover && hovered && (
        <div
          data-contents-tick-name=""
          className="pointer-events-none absolute left-full z-20 max-w-80 -translate-y-1/2 truncate rounded-lg border border-rule bg-surface px-2.5 py-1 text-[13px] whitespace-nowrap text-ink shadow-[0_4px_12px_var(--shadow)]"
          style={{ top: hover.y }}
        >
          {hovered.volume && <span className="text-muted">{hovered.volume} › </span>}
          {hovered.item.label}
        </div>
      )}
    </div>
  );
}

/** One tick, after a gap when it starts a group. Each row may shrink, so a long book still fits. */
function TickRow({
  tick,
  current,
  hovered,
  rowRef,
}: {
  tick: Tick;
  current: boolean;
  hovered: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <>
      {tick.groupStart && <div className="min-h-0 shrink basis-2.5" />}
      <div ref={rowRef} data-tick="" className="flex min-h-0.5 shrink basis-[5px] items-center pl-[13px]">
        <span
          data-current={current ? '' : undefined}
          className={cn(
            'h-0.5 rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-150',
            current ? 'w-5 bg-accent' : hovered ? 'w-4 bg-muted' : tick.head ? 'w-4 bg-muted/60' : 'w-2.5 bg-muted/35',
          )}
        />
      </div>
    </>
  );
}

/** How long the card over the book takes to lift away (see `motion-drop` in globals.css). */
const FLOAT_EXIT_MS = 120;

const SCROLLS = 'scrollbar-slim flex min-h-0 flex-col overflow-y-auto overscroll-contain';

/**
 * The list over the book: a card under the ☰ button (on a phone, across the width under the bar).
 * It drops into place from the button when it opens and lifts back when it closes.
 */
function FloatingCard({
  id,
  placement,
  closing,
  children,
}: {
  id: string | undefined;
  placement: 'rail' | 'bar';
  closing: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      data-closing={closing ? '' : undefined}
      className={cn(
        SCROLLS,
        'motion-drop z-45 max-h-[70dvh] rounded-xl border border-rule bg-surface px-3 py-2 text-ink shadow-[0_8px_24px_var(--shadow)]',
        placement === 'rail' ? 'absolute top-12 -left-[13px] w-72' : 'fixed inset-x-2 top-14',
      )}
    >
      {children}
    </div>
  );
}

/** A row of the list: compact for a mouse, a full 44px for a finger. */
const ROW =
  'flex min-h-8 w-full items-center rounded-lg py-1 text-left text-[13px] leading-snug pointer-coarse:min-h-11 pointer-coarse:text-sm';

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
              className={cn(ROW, 'cursor-pointer gap-2 font-medium text-ink focus-visible:outline-2 focus-visible:outline-accent')}
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
    ROW,
    'gap-2.5 pl-1',
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
