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
    <a href={href} title={title} target="_blank" rel="noopener noreferrer" className="text-accent underline">
      {children}
    </a>
  ),
};

/** One answer, in the reading font, labelled with the model that wrote it. */
export function MessageView({ content, modelLabel, failed, children }: Props) {
  return (
    <article className="flex flex-col gap-2">
      <div className="font-serif text-base leading-[1.65] break-words [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5">
        <Markdown components={COMPONENTS}>{content}</Markdown>
      </div>
      {failed && (
        <p role="alert" className="text-[13px] text-danger">
          This answer stopped before it finished.
        </p>
      )}
      {modelLabel && <p className="text-xs text-muted">{modelLabel}</p>}
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </article>
  );
}
