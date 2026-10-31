# Deploying help-me-read

One Supabase project (database, auth, file storage) and one Vercel project. The app is single-user: sign-ups are off and only `ALLOWED_EMAIL` can sign in. Both services have free plans that are enough.

## 1. Create the Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a project. Note the database password and the project ref (the `abcd1234` in `https://abcd1234.supabase.co`).
2. From **Project Settings > API**, copy the project URL and the `anon` public key. The app does not use the `service_role` key; do not put it in Vercel.

## 2. Push the schema

From the repo root:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`db push` applies `supabase/migrations/0001_init.sql`: the tables, row-level security, and the private `books` Storage bucket with its policy (each user can only touch files under their own user id).

Storage limits on the free plan: 50 MB per file and 1 GB in total. The app refuses uploads over 50 MB.

## 3. Turn off sign-ups and create the user

1. **Authentication > Sign In / Providers** (older dashboards: **Authentication > Providers**): turn **Allow new users to sign up** off. Keep the **Email** provider enabled. Turning the Email provider itself off would disable email logins, not just sign-ups. This matches the local `supabase/config.toml`, where `[auth] enable_signup = false` and `[auth.email] enable_signup = true`.
2. **Authentication > Users > Add user > Create new user**: enter the email you will put in `ALLOWED_EMAIL` and a password, and tick **Auto Confirm User**. The login page accepts this email and password, or a magic link emailed to it.

## 4. Create the Vercel project

1. In Vercel, **Add New > Project** and import the GitHub repository. The framework preset is Next.js; leave the build settings at their defaults.
2. Before the first deploy, add these **Environment Variables** (Production), using the names in `.env.example`:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` key |
   | `ALLOWED_EMAIL` | the email of the one user |
   | `GOOGLE_GENERATIVE_AI_API_KEY` | optional: Gemini models |
   | `ANTHROPIC_API_KEY` | optional: Claude models |
   | `OPENAI_API_KEY` | optional: GPT models |
   | `OPENROUTER_API_KEY` | optional: Llama, Mistral and DeepSeek models |

   Set at least one provider key; a model is offered only if its provider's key is set. Only the Supabase URL and anon key are public; every other value is a server secret. `SUPABASE_SERVICE_ROLE_KEY` in `.env.example` is for the local tests only.

3. **Do not set `AI_MOCK` or `NEXT_PUBLIC_E2E` in production.** A production build ignores both, but they belong to local tests only:
   - `AI_MOCK=1` swaps the real models for a fake one, honours the `x-test-now` and `x-test-fail-after` test headers (which bypass the spend cap's clock), and turns on `GET /api/test/last-prompt`, which returns the last prompt.
   - `NEXT_PUBLIC_E2E=1` turns on a test-only page under `/__test` and exposes a debug global in the reader.
4. Deploy. Note the production domain, for example `https://help-me-read.vercel.app`.

## 5. Point Supabase Auth at the Vercel domain

**Authentication > URL Configuration**:

- **Site URL**: `https://<your-domain>`
- **Redirect URLs**: add `https://<your-domain>/auth/callback` (the magic-link route, `src/app/auth/callback/route.ts`). Remove any `localhost` entries you do not want in production.

If you later add a custom domain, update both settings and keep the old redirect URL until the switch is done.

## 6. Check the deployment

- Opening the production URL while signed out redirects to `/login`.
- Signing in with the user from step 3 opens the library.
- `GET https://<your-domain>/api/test/last-prompt` returns 404. A production build always answers 404 here; anything else means the deployment is not a production build.

## 7. Try the real models

With provider keys in `.env.local` (not production), run the smoke script. It runs Define on "bank" in "She sat on the bank of the river." and Explain on a three-sentence passage for every model whose key is set, and prints the latency, cost and answer of each call, then the total cost. It makes paid calls, a fraction of a cent per model.

```bash
npx tsx scripts/smoke-models.ts
```

A model's `tested` flag in `src/lib/ai/models.ts` should be `true` only if its Define answer follows `**term** (pos) /IPA/` and gives the in-context meaning (the river bank, not the bank you deposit money in).

## 8. Manual check on phone and laptop

Upload a real PDF and EPUB. Try Define, Explain, a follow-up question, and Re-ask with another provider; save a word with +Vocab; reopen a thread on the other device; confirm the reading position resumes there and that the spend shown in Settings went up.
