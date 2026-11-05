'use client';

import { useSyncExternalStore } from 'react';
import type { Settings } from './settings.server';
import { THEMES, type Theme } from '@/lib/types';

/** The theme the page shows: the class on <html>, set on the server from the user's settings. */
export function shownTheme(): Theme {
  const classes = document.documentElement.classList;
  return THEMES.find((t) => classes.contains(t)) ?? 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.remove(...THEMES);
  document.documentElement.classList.add(theme);
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** The theme the page shows, kept up to date when it changes. */
export function useShownTheme(): Theme {
  return useSyncExternalStore(subscribe, shownTheme, () => 'light');
}

/**
 * Saves the theme into the user's settings, which the settings API only takes whole: the other
 * settings are read first and sent back unchanged. Throws with the server's message on failure.
 */
export async function saveTheme(theme: Theme): Promise<void> {
  const current = await fetch('/api/settings');
  if (!current.ok) throw new Error('Could not save the theme. Please try again.');
  const { settings } = (await current.json()) as { settings: Settings };
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...settings, theme }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Could not save the theme. Please try again.');
  }
}
