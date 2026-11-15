import { fileURLToPath } from 'node:url';
import { defineWorkspace } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    // Runs against local Supabase (`supabase start`); files run one at a time because they share
    // one database and truncate tenant tables between files.
    resolve: { alias },
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.ts'],
      environment: 'node',
      fileParallelism: false,
      // per-project fileParallelism is not applied in a workspace; one fork makes files sequential
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      // generous: a remote dev database adds ~0.3 s per round trip
      testTimeout: 60_000,
      hookTimeout: 180_000,
    },
  },
]);
