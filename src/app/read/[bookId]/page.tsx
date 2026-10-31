import { Suspense } from 'react';
import { ReadView } from '@/components/reader/ReadView';

async function Reader({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  return <ReadView bookId={bookId} />;
}

export default function ReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-sm opacity-70">Loading…</p>}>
      <Reader params={params} />
    </Suspense>
  );
}
