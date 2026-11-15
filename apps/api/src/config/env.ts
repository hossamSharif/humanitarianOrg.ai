// Zod-validated environment (apps/api/.env.example). Parsed once, on first use, so a missing value
// fails fast at startup with every problem listed.
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: csv,

  SUPABASE_URL: z.string().url(),
  // anon (legacy JWT) or publishable (sb_publishable_…) key
  SUPABASE_ANON_KEY: z.string().min(1),
  // service-role (legacy JWT) or secret (sb_secret_…) key — Auth admin calls only
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Legacy HS256 secret. When empty, access tokens are verified against the project's JWKS
  // (asymmetric signing keys): `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
  SUPABASE_JWT_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),

  // Postgres for transactional commands; session pooler (5432) in cloud, prepare:false.
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment:\n${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}
