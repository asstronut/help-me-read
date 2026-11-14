'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { COMMON_LANGUAGES } from '@/lib/languages';
import { cn } from './cn';
import { FIELD } from './field';
import { ChevronDownIcon } from './icons';

const DEFAULT_CHOICE = 'default';
const OTHER_CHOICE = 'other';

type Props = {
  /** Names the dropdown, e.g. "Translate into". */
  label: string;
  className?: string;
} & (
  | { value: string; onChange: (language: string) => void; defaultLanguage?: undefined }
  | {
      /** null while the default is chosen. */
      value: string | null;
      onChange: (language: string | null) => void;
      /** Adds "Default (<language>)" as the first option; choosing it gives null. */
      defaultLanguage: string;
    }
);

const isCustom = (language: string | null): language is string =>
  language !== null && !COMMON_LANGUAGES.includes(language);

/**
 * A dropdown of common languages, with "Other…" to type any other. A pick from the list is
 * reported at once; a typed language when the field loses focus or Enter is pressed, never empty.
 */
export function LanguagePicker(props: Props) {
  const { label, value, defaultLanguage, className } = props;
  // "Other…" is picked, so the language is typed instead of chosen from the list.
  const [typing, setTyping] = useState(isCustom(value));
  const [draft, setDraft] = useState(isCustom(value) ? value : '');
  const focusDraft = useRef(false);

  function report(language: string | null) {
    if (props.defaultLanguage !== undefined) props.onChange(language);
    else if (language !== null) props.onChange(language);
  }

  function choose(choice: string) {
    if (choice === OTHER_CHOICE) {
      focusDraft.current = true;
      setTyping(true);
      return;
    }
    setTyping(false);
    setDraft('');
    report(choice === DEFAULT_CHOICE ? null : choice);
  }

  function commitDraft() {
    const language = draft.trim();
    if (language !== '' && language !== value) report(language);
  }

  function onDraftKeyDown(e: KeyboardEvent) {
    // No preventDefault: inside a form, Enter still submits it, with the language reported first.
    if (e.key === 'Enter') commitDraft();
  }

  return (
    <div className={cn('flex flex-col gap-1.5 text-[13px]', className)}>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium">{label}</span>
        <span className="relative flex max-w-[280px]">
          <select
            value={value === null ? DEFAULT_CHOICE : typing ? OTHER_CHOICE : value}
            onChange={(e) => choose(e.target.value)}
            className={cn(FIELD, 'w-full appearance-none pr-9 pl-3.5')}
          >
            {defaultLanguage !== undefined && (
              <option value={DEFAULT_CHOICE}>{`Default (${defaultLanguage})`}</option>
            )}
            {COMMON_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
            <option value={OTHER_CHOICE}>Other…</option>
          </select>
          <ChevronDownIcon
            size={14}
            className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted"
          />
        </span>
      </label>
      {typing && (
        <label className="mt-1 flex flex-col gap-1.5">
          <span className="font-medium">
            Language name<span className="sr-only">{` for ${label}`}</span>
          </span>
          <input
            ref={(input) => {
              if (input && focusDraft.current) {
                focusDraft.current = false;
                input.focus();
              }
            }}
            value={draft}
            maxLength={40}
            required
            placeholder="e.g. Javanese"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={onDraftKeyDown}
            className={cn(FIELD, 'max-w-[280px] px-3.5')}
          />
        </label>
      )}
    </div>
  );
}
