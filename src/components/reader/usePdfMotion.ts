'use client';

import { useEffect, useRef, type RefObject } from 'react';
import {
  REST_MS,
  nextMotion,
  settleTarget,
  startingMotion,
  type Motion,
  type MotionEvent,
} from '@/lib/reader/pdf-motion';
import type { PdfFit } from '@/lib/reader/reading-prefs';

type Options = {
  scrollRef: RefObject<HTMLElement | null>;
  fit: PdfFit;
  zoom: number | null;
  /** A glide ended short of its page, as a hand scroll cut it off: the view decides the page again. */
  onGlideLost: () => void;
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The scrollTop that puts a page slot's top at the top of the view. */
const slotTop = (scroller: HTMLElement, slot: HTMLElement) =>
  slot.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

/** Runs `Motion` against the scroller's real events. */
function watchMotion(scroller: HTMLElement, latest: () => Options) {
  let state = startingMotion(scroller.scrollTop);
  let timer: number | undefined;
  const send = (event: MotionEvent) => {
    state = nextMotion(state, event);
  };

  const slot = (page: number) => scroller.querySelector<HTMLElement>(`[data-slot="${page}"]`);

  function arrived(page: number): boolean {
    const target = slot(page);
    if (!target) return true;
    const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    return atEnd || Math.abs(scroller.scrollTop - slotTop(scroller, target)) <= 1;
  }

  /** Eases a hand scroll that stopped just off a page top onto it (Whole page only). */
  function settle(from: number) {
    const { fit, zoom } = latest();
    const to = settleTarget({
      fit,
      zoom,
      reducedMotion: prefersReducedMotion(),
      from,
      end: scroller.scrollTop,
      viewHeight: scroller.clientHeight,
      tops: () => [...scroller.querySelectorAll<HTMLElement>('[data-slot]')].map((s) => slotTop(scroller, s)),
    });
    if (to === null) return;
    send({ type: 'settle' });
    scroller.scrollTo({ top: to, behavior: 'smooth' });
    // The settle may be too short to scroll at all.
    armRest();
  }

  function rest() {
    window.clearTimeout(timer);
    const before = state;
    send({ type: 'rest' });
    // A pointer or finger is still down; letting go asks again.
    if (state === before) return;
    if (before.kind === 'user') settle(before.from);
    else if (before.kind === 'glide' && !arrived(before.target)) latest().onGlideLost();
  }

  function armRest() {
    window.clearTimeout(timer);
    timer = window.setTimeout(rest, REST_MS);
  }

  function release() {
    send({ type: 'up' });
    armRest();
  }

  const stops: (() => void)[] = [];
  function on<K extends keyof WindowEventMap>(type: K, listener: (e: WindowEventMap[K]) => void) {
    window.addEventListener(type, listener, { passive: true });
    stops.push(() => window.removeEventListener(type, listener));
  }
  // On the window, as a scrollbar drag can end outside the scroller. A touch drag ends its pointer
  // events once the browser takes over the scrolling, so touches are followed by their own events.
  on('pointerdown', (e) => e.pointerType !== 'touch' && send({ type: 'down' }));
  on('pointerup', (e) => e.pointerType !== 'touch' && release());
  on('pointercancel', (e) => e.pointerType !== 'touch' && release());
  const onTouch = (e: TouchEvent) => (e.touches.length > 0 ? send({ type: 'down' }) : release());
  on('touchstart', onTouch);
  on('touchend', onTouch);
  on('touchcancel', onTouch);
  on('blur', release);
  // The browser may keep the button's release for the menu.
  on('contextmenu', release);
  // Where the browser says scrolling ended, the view rests sooner than the timer would say.
  const onScrollEnd = () => {
    if (state.kind === 'glide' && !arrived(state.target)) return;
    rest();
  };
  scroller.addEventListener('scrollend', onScrollEnd);

  return {
    /** Feeds a scroll event in; returns what the scrolling is. */
    scrolled(): Motion['kind'] {
      send({ type: 'scroll', top: scroller.scrollTop });
      armRest();
      return state.kind;
    },
    /** Scrolls smoothly to the top of the page; with reduced motion asked for, cuts there. */
    glideTo(page: number) {
      const target = slot(page);
      if (!target) return;
      const top = slotTop(scroller, target);
      if (prefersReducedMotion()) {
        scroller.scrollTo({ top, behavior: 'instant' });
        return;
      }
      send({ type: 'turn', target: page });
      scroller.scrollTo({ top, behavior: 'smooth' });
      // A glide to where the view already is fires no scroll events to rest on.
      armRest();
    },
    stop() {
      window.clearTimeout(timer);
      for (const stop of stops) stop();
      scroller.removeEventListener('scrollend', onScrollEnd);
    },
  };
}

/** What the PDF's scrolling is doing (see `Motion`), the glide a button or key turn makes, and the Whole page settle. */
export function usePdfMotion(options: Options) {
  const latest = useRef(options);
  const watch = useRef<ReturnType<typeof watchMotion> | null>(null);
  useEffect(() => {
    latest.current = options;
  });
  const { scrollRef } = options;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const watching = watchMotion(scroller, () => latest.current);
    watch.current = watching;
    return () => {
      watching.stop();
      watch.current = null;
    };
  }, [scrollRef]);

  return {
    /** Call on each scroll event of the scroller. */
    scrolled: (): Motion['kind'] => watch.current?.scrolled() ?? 'idle',
    glideTo: (page: number) => watch.current?.glideTo(page),
  };
}
