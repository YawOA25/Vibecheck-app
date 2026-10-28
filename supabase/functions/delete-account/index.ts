/**
 * The delete-account Supabase Edge Function (task VC-B13): the only way an
 * account gets deleted from the app. It runs on Supabase's servers (Deno),
 * not on the phone.
 *
 * Why it's on the server: deleting needs the "service role", the database's
 * all-access key. That key must never be in the app (anyone can unpack an
 * app). Supabase gives every hosted function SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY as built-in secrets, so the key is never in the
 * repo or the app either.
 *
 * What it does: the decisions are in handler.ts (tested by Jest). This file
 * only connects them to Supabase:
 *   - verifyUser: asks Supabase Auth who the login token belongs to;
 *   - deleteAccount: calls the database function public.delete_account with
 *     THAT user id (see supabase/migrations/20261028120000_delete_account.sql).
 *
 * Deploy (dev project only, from apps/vibecheck):
 *   npx supabase functions deploy delete-account --project-ref <dev project id>
 *
 * This file uses Deno's style of imports ("npm:" and the ".ts" ending), so
 * the app's own type check and lint skip it (tsconfig.json, eslint.config.js).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CORS_HEADERS, handleDeleteAccount } from './handler.ts';

// The all-access client. It never keeps a login of its own.
const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(async (req: Request) => {
  const result = await handleDeleteAccount(
    { method: req.method, authorization: req.headers.get('Authorization') },
    {
      // Supabase Auth checks the token's signature and that the user exists.
      verifyUser: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        return error || !data.user ? null : data.user.id;
      },
      deleteAccount: async (userId) => {
        const { error } = await admin.rpc('delete_account', { p_user_id: userId });
        return { error: error ? { code: error.code } : null };
      },
      logError: (message) => console.error(message),
    },
  );
  return new Response(result.body === null ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
