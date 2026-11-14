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
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
]);
