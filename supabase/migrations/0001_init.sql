-- help-me-read v1 schema. Every table carries owner_id and is protected by
-- row-level security: a row is visible and writable only by its owner.

create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  author text,
  format text not null check (format in ('pdf', 'epub')),
  storage_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  segment_count integer not null default 0 check (segment_count >= 0),
  extracted_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.segments (
  book_id uuid not null references public.books (id) on delete cascade,
  seq integer not null check (seq >= 0),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null,
  paragraphs text[] not null default '{}',
  primary key (book_id, seq)
);

create table public.reading_positions (
  book_id uuid primary key references public.books (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  location jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  kind text not null check (kind in ('note', 'thread')),
  color text not null check (color in ('yellow', 'green', 'blue', 'pink')),
  segment_seq integer not null check (segment_seq >= 0),
  anchor jsonb not null,
  quote text not null,
  prefix text not null default '',
  note text,
  created_at timestamptz not null default now()
);
create index highlights_book_id_idx on public.highlights (book_id);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  highlight_id uuid not null references public.highlights (id) on delete cascade,
  action text not null check (action in ('translate', 'define', 'explain', 'simplify', 'ask')),
  context_scope text not null check (context_scope in ('page', 'book')),
  created_at timestamptz not null default now()
);
create index threads_highlight_id_idx on public.threads (highlight_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id uuid not null references public.threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  model_id text,
  status text not null default 'complete' check (status in ('complete', 'failed')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index messages_thread_id_idx on public.messages (thread_id);
create index messages_owner_created_idx on public.messages (owner_id, created_at);

create table public.vocab_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid references public.books (id) on delete set null,
  term text not null,
  sentence text not null default '',
  meaning text not null default '',
  anchor jsonb,
  created_at timestamptz not null default now()
);
create index vocab_entries_book_id_idx on public.vocab_entries (book_id);

create table public.settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  explanation_language text not null default 'English',
  action_models jsonb not null default '{}'::jsonb,
  monthly_cap_usd numeric(10, 2) not null default 10 check (monthly_cap_usd >= 0),
  theme text not null default 'light' check (theme in ('light', 'dark', 'sepia'))
);

-- AI calls that are not thread messages (the +Vocab meaning fill).
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model_id text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index usage_events_owner_created_idx on public.usage_events (owner_id, created_at);

-- Row-level security: owner only, on every table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'books', 'segments', 'reading_positions', 'highlights', 'threads',
    'messages', 'vocab_entries', 'settings', 'usage_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end $$;

-- Private Storage bucket: each user may touch only objects under "<their uid>/".
insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 52428800)
on conflict (id) do nothing;

create policy books_objects_owner on storage.objects for all to authenticated
  using (bucket_id = 'books' and name like auth.uid()::text || '/%')
  with check (bucket_id = 'books' and name like auth.uid()::text || '/%');
