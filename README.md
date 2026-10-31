# help-me-read

A single-user web reader for PDF and EPUB books with AI help in the margin. Select text and translate, define, explain or simplify it, or ask follow-up questions in a thread. Highlights, saved vocabulary, reading position and a monthly spend cap are kept per book and sync between phone and laptop. Built with Next.js 16 and Supabase.

## Local development

You need Node.js and Docker.

```bash
npm install
npx supabase start          # local Postgres, Auth and Storage (applies supabase/migrations)
cp .env.example .env.local  # fill in the values below
npm run dev                 # http://localhost:3000
```

Fill `.env.local` from the output of `npx supabase status`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (the last is used only by the tests, to arrange data). Set `ALLOWED_EMAIL` to the one email that may sign in. Add any of `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` to use real models, or set `AI_MOCK=1` to use a fake model (local and test use only; a production build ignores it).

## Tests

```bash
npm run typecheck   # tsc --noEmit
npm run test:api    # Vitest; starts its own mock-AI dev server on port 3100
npm run e2e         # Playwright, desktop and phone projects (also starts its own server)
```

The API and e2e tests need the local Supabase stack running and `.env.local` filled in. They start their own dev server with `AI_MOCK=1`, so no real AI calls are made.

To try the real models, set provider keys and run `npx tsx scripts/smoke-models.ts`. It makes paid calls.

## Deploying

See [docs/deploy.md](docs/deploy.md).
