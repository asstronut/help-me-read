import { requireUser } from '@/lib/auth/require-user';
import { toAnki, toCsv } from '@/lib/vocab/export';
import { listVocab } from '@/lib/vocab/service.server';

const download = (body: string, type: string, filename: string) =>
  new Response(body, {
    headers: {
      'content-type': `${type}; charset=utf-8`,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });

export async function GET(req: Request) {
  try {
    const { supabase } = await requireUser();
    const format = new URL(req.url).searchParams.get('format');
    if (format !== 'csv' && format !== 'anki') {
      return Response.json({ message: 'Choose format=csv or format=anki' }, { status: 400 });
    }
    const entries = await listVocab(supabase, '');
    return format === 'csv'
      ? download(toCsv(entries), 'text/csv', 'vocab.csv')
      : download(toAnki(entries), 'text/plain', 'vocab-anki.txt');
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
