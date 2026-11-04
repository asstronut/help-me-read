import { requireUser } from '@/lib/auth/require-user';
import { BOOK_COLUMNS, toBookItem } from '@/lib/books/book-item';
import { MAX_UPLOAD_BYTES, type BookFormat } from '@/lib/types';

const FORMATS: readonly string[] = ['pdf', 'epub'];

type CreateBody = {
  title: string;
  author: string | null;
  format: BookFormat;
  sizeBytes: number;
};

function parseCreateBody(raw: unknown): CreateBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { title, author, format, sizeBytes } = raw as Record<string, unknown>;
  if (typeof title !== 'string' || title.trim() === '') return null;
  if (author !== null && author !== undefined && typeof author !== 'string') return null;
  if (typeof format !== 'string' || !FORMATS.includes(format)) return null;
  if (
    !Number.isInteger(sizeBytes) ||
    (sizeBytes as number) < 1 ||
    (sizeBytes as number) > MAX_UPLOAD_BYTES
  ) {
    return null;
  }
  return {
    title: title.trim(),
    author: author ?? null,
    format: format as BookFormat,
    sizeBytes: sizeBytes as number,
  };
}

export async function POST(req: Request) {
  try {
    const { supabase, userId } = await requireUser();
    const body = parseCreateBody(await req.json().catch(() => null));
    if (!body) return Response.json({ message: 'Invalid book' }, { status: 400 });

    const bookId = crypto.randomUUID();
    const storagePath = `${userId}/${bookId}.${body.format}`;
    const { error } = await supabase.from('books').insert({
      id: bookId,
      title: body.title,
      author: body.author,
      format: body.format,
      storage_path: storagePath,
      size_bytes: body.sizeBytes,
    });
    if (error) throw error;

    const { data, error: urlError } = await supabase.storage
      .from('books')
      .createSignedUploadUrl(storagePath);
    if (urlError) {
      await supabase.from('books').delete().eq('id', bookId);
      throw urlError;
    }
    return Response.json(
      { bookId, signedUploadUrl: data.signedUrl, token: data.token },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from('books')
      .select(BOOK_COLUMNS)
      .order('last_opened_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return Response.json({ books: data.map(toBookItem) });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
