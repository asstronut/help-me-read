import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { MenuPreview } from './MenuPreview';

type SearchParams = Promise<{ words?: string }>;

async function Preview({ searchParams }: { searchParams: SearchParams }) {
  const { words } = await searchParams;
  return <MenuPreview words={Math.max(1, Number(words) || 1)} />;
}

/** Test-only page: the selection menu for a selection of `?words=` words. */
export default function TestMenuPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NEXT_PUBLIC_E2E !== '1') notFound();
  return (
    <Suspense>
      <Preview searchParams={searchParams} />
    </Suspense>
  );
}
