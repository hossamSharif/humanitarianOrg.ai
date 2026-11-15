// withTenantTx through the pooler (plan Risks): settings are transaction-local, so interleaved
// transactions for different users and tenants never see each other's request.jwt.claims or
// app.audit_comment, and a pooled connection carries nothing into the next request.
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenantTx } from '../../src/db/tx';
import {
  createTenant,
  createUser,
  cleanupTestData,
  type TestTenant,
  type TestUser,
} from './helpers/factories';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  truncateTenantTables,
} from './helpers/setup';

describe.runIf(integrationEnabled)('withTenantTx context isolation', () => {
  // Two connections, so concurrent transactions share and reuse them like a busy pooler.
  let sql: postgres.Sql;
  let tenants: TestTenant[];
  let users: TestUser[];

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, onnotice: () => {} });
    tenants = [await createTenant({ nameEn: 'Tx A' }), await createTenant({ nameEn: 'Tx B' })];
    users = [
      await createUser(tenants[0]!, { roles: ['requester'] }),
      await createUser(tenants[1]!, { roles: ['requester'] }),
    ];
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await cleanupTestData();
    await closeOwnerDb();
  });

  const claimsFor = (user: TestUser) => ({
    sub: user.id,
    role: 'authenticated',
    app_metadata: { tenant_id: user.tenantId },
  });

  it('interleaved transactions each see only their own identity and comment', async () => {
    const runs = Array.from({ length: 40 }, (_, i) => {
      const user = users[i % 2]!;
      const comment = `comment-${i}`;
      return withTenantTx(
        { claims: claimsFor(user), requestId: `req-${i}` },
        async (tx) => {
          await tx.setAuditComment(comment);
          // yield so other transactions run on the other connection in between
          await tx.sql`select pg_sleep(0.01)`;
          const [row] = await tx.sql<
            {
              uid: string;
              tenant: string | null;
              comment: string;
              request_id: string;
              role: string;
            }[]
          >`
            select auth.uid()::text as uid,
                   app.current_tenant_id()::text as tenant,
                   current_setting('app.audit_comment', true) as comment,
                   current_setting('app.request_id', true) as request_id,
                   current_user as role`;
          return { i, user, comment, row: row! };
        },
        sql
      );
    });

    for (const { i, user, comment, row } of await Promise.all(runs)) {
      expect(row.uid).toBe(user.id);
      expect(row.tenant).toBe(user.tenantId);
      expect(row.comment).toBe(comment);
      expect(row.request_id).toBe(`req-${i}`);
      expect(row.role).toBe('authenticated');
    }
  });

  it('nothing leaks onto the pooled connection after commit or rollback', async () => {
    await withTenantTx(
      { claims: claimsFor(users[0]!), requestId: 'ok' },
      async (tx) => {
        await tx.setAuditComment('committed');
      },
      sql
    );
    await expect(
      withTenantTx(
        { claims: claimsFor(users[1]!), requestId: 'fail' },
        async (tx) => {
          await tx.setAuditComment('rolled back');
          throw new Error('boom');
        },
        sql
      )
    ).rejects.toThrow('boom');

    const rows = await Promise.all(
      Array.from(
        { length: 4 },
        () => sql<{ claims: string | null; comment: string | null; role: string }[]>`
        select nullif(current_setting('request.jwt.claims', true), '') as claims,
               nullif(current_setting('app.audit_comment', true), '') as comment,
               current_user as role`
      )
    );
    for (const [row] of rows) {
      expect(row!.claims).toBeNull();
      expect(row!.comment).toBeNull();
      expect(row!.role).not.toBe('authenticated');
    }
  });
});
