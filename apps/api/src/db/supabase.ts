// supabase-js clients. The user client carries the caller's access token, so RLS applies to every
// CRUD read and write. The admin client (service role) is used ONLY for Auth admin calls —
// invitations and app_metadata.tenant_id — never for business data (Principle IV).
import type { Database } from '@ngo/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env';

export type UserClient = SupabaseClient<Database>;

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export function createUserClient(accessToken: string): UserClient {
  const env = getEnv();
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

let admin: SupabaseClient | undefined;

/** Auth admin API only (`adminAuth().inviteUserByEmail`, `updateUserById`). */
export function adminAuth(): SupabaseClient['auth']['admin'] {
  if (!admin) {
    const env = getEnv();
    admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: noSession });
  }
  return admin.auth.admin;
}
