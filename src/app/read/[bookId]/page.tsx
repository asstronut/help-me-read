import { Suspense } from 'react';
import { ReadView } from '@/components/reader/ReadView';

type PageProps = {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ thread?: string | string[] }>;
};

async function Reader({ params, searchParams }: PageProps) {
  const { bookId } = await params;
  const { thread } = await searchParams;
  // `?thread=<id>` reopens that thread beside the book.
  return <ReadView bookId={bookId} threadId={typeof thread === 'string' ? thread : null} />;
}

export default function ReadPage(props: PageProps) {
  return (
    <Suspense fallback={<p className="p-4 text-sm opacity-70">Loading…</p>}>
      <Reader {...props} />
    </Suspense>
  );
}
