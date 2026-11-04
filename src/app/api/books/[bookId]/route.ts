import { requireUser } from '@/lib/auth/require-user';
import { BOOK_COLUMNS, toBookItem } from '@/lib/books/book-item';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_SECONDS = 60 * 60;

type Ctx = { params: Promise<{ bookId: string }> };

const notFound = () => Response.json({ message: 'Book not found' }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { bookId } = await params;
    if (!UUID.test(bookId)) return notFound();

    const { data: row, error } = await supabase
      .from('books')
      .select(BOOK_COLUMNS)
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return notFound();

    const { data: signed, error: signError } = await supabase.storage
      .from('books')
      .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
    // The row exists but its file was never uploaded (or is gone).
    if (signError) return Response.json({ message: 'Book file not found' }, { status: 404 });
    return Response.json({
      ...toBookItem(row),
      segmentCount: row.segment_count,
      fileUrl: signed.signedUrl,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireUser();
    const { bookId } = await params;
    if (!UUID.test(bookId)) return notFound();

    const { data: row, error } = await supabase
      .from('books')
      .select('storage_path')
      .eq('id', bookId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return notFound();

    const { error: removeError } = await supabase.storage.from('books').remove([row.storage_path]);
    if (removeError) throw removeError;
    const { error: deleteError } = await supabase.from('books').delete().eq('id', bookId);
    if (deleteError) throw deleteError;
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
