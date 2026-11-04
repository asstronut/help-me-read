'use client';

import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';

type Props = {
  /** The answer's markdown; raw HTML in it is shown as text, never rendered. */
  content: string;
  modelLabel: string | null;
  failed: boolean;
  /** Buttons under the answer (Re-ask, Retry). */
  children?: ReactNode;
};

// Links open in a new tab so following one never navigates away from the book.
const COMPONENTS: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  ),
};

/** One answer, labelled with the model that wrote it. */
export function MessageView({ content, modelLabel, failed, children }: Props) {
  return (
    <article className="flex flex-col gap-1 rounded-lg border border-foreground/10 p-3">
      {modelLabel && <p className="text-xs opacity-60">{modelLabel}</p>}
      <div className="text-sm leading-relaxed break-words [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5">
        <Markdown components={COMPONENTS}>{content}</Markdown>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-red-600">
          This answer stopped before it finished.
        </p>
      )}
      {children && <div className="flex gap-2">{children}</div>}
    </article>
  );
}
