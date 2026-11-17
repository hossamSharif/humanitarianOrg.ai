// T009 — numbering for every registered document code (migration 0012, research D7, FR-094):
// configs and sequences accept registry codes only; numbers run per type, office and year in
// the {prefix}-{OFFICE}-{YYYY}-{seq:4} format; a rolled-back transaction leaves no gap and no
// duplicate.
import { DOC_TYPE_CODES } from '@ngo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NumberingRepository } from '../../src/repositories/numbering.repository';
import { NumberingService, numberingTxStore } from '../../src/services/numbering.service';
import type { RequestContext } from '../../src/types/context';
import { cleanupTestData, createTenant, type TestTenant } from './helpers/factories';
import {
  closeOwnerDb,
  ensureMigrated,
  integrationEnabled,
  ownerDb,
  truncateTenantTables,
} from './helpers/setup';

async function pgError(promise: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { message: string; code?: string };
  }
  throw new Error('expected the statement to fail');
}

describe.runIf(integrationEnabled)('numbering for every document type (002 D7)', () => {
  let tenant: TestTenant;
  let service: NumberingService;
  // mid-year in Khartoum, so no time-zone edge
  const at2026 = new Date('2026-06-15T09:00:00Z');
  const at2027 = new Date('2027-06-15T09:00:00Z');

  const assign = (docType: (typeof DOC_TYPE_CODES)[number], office: string, when = at2026) =>
    ownerDb().begin((sql) =>
      service.assignNumber(sql, docType, tenant.offices[office]!, when, 'Africa/Khartoum')
    ) as Promise<string>;

  beforeAll(async () => {
    ensureMigrated();
    await truncateTenantTables();
    tenant = await createTenant({ nameEn: 'Numbering 002 Org', officeCodes: ['MAD', 'KST'] });
    await ownerDb()`select app.run_tenant_seed_hooks(${tenant.id})`;
    service = new NumberingService(
      new NumberingRepository({ tenantId: tenant.id } as RequestContext),
      numberingTxStore(tenant.id)
    );
  });

  afterAll(async () => {
    await cleanupTestData();
    await closeOwnerDb();
  });

  it('numbering_config and document_sequence accept every registry code and reject others', async () => {
    const sql = ownerDb();
    const configured = await sql<{ doc_type: string }[]>`
      select doc_type from public.numbering_config where tenant_id = ${tenant.id}`;
    expect(new Set(configured.map((r) => r.doc_type))).toEqual(
      new Set(DOC_TYPE_CODES.filter((c) => c !== 'PR'))
    );
    await expect(sql`
      insert into public.numbering_config (tenant_id, doc_type, prefix)
      values (${tenant.id}, 'PR', 'PR')`).resolves.toBeDefined();

    expect(
      (
        await pgError(sql`
        insert into public.numbering_config (tenant_id, doc_type, prefix)
        values (${tenant.id}, 'XYZ', 'XYZ')`)
      ).code
    ).toBe('23503');
    expect(
      (
        await pgError(sql`
        insert into public.document_sequence (tenant_id, doc_type, office_id, year)
        values (${tenant.id}, 'XYZ', ${tenant.offices.MAD!}, 2026)`)
      ).code
    ).toBe('23503');
  });

  it('PO-MAD-2026-0001 then PO-MAD-2026-0002', async () => {
    expect(await assign('PO', 'MAD')).toBe('PO-MAD-2026-0001');
    expect(await assign('PO', 'MAD')).toBe('PO-MAD-2026-0002');
  });

  it('separate sequences per type, office and year', async () => {
    expect(await assign('GRN', 'MAD')).toBe('GRN-MAD-2026-0001');
    expect(await assign('PO', 'KST')).toBe('PO-KST-2026-0001');
    expect(await assign('PO', 'MAD', at2027)).toBe('PO-MAD-2027-0001');
    expect(await assign('BPV', 'MAD')).toBe('BPV-MAD-2026-0001');
    expect(await assign('PO', 'MAD')).toBe('PO-MAD-2026-0003');
  });

  it('a rolled-back transaction leaves no gap and no duplicate (FR-094)', async () => {
    const rolledBack = await ownerDb()
      .begin(async (sql) => {
        const number = await service.assignNumber(
          sql,
          'INV',
          tenant.offices.MAD!,
          at2026,
          'Africa/Khartoum'
        );
        throw Object.assign(new Error('rollback'), { number });
      })
      .catch((err: { number?: string }) => err.number);
    expect(rolledBack).toBe('INV-MAD-2026-0001');

    const [a, b] = [await assign('INV', 'MAD'), await assign('INV', 'MAD')];
    expect([a, b]).toEqual(['INV-MAD-2026-0001', 'INV-MAD-2026-0002']);
  });

  it('parallel assignments in one office and year get distinct consecutive numbers', async () => {
    const numbers = await Promise.all(Array.from({ length: 4 }, () => assign('CON', 'MAD')));
    expect(numbers.sort()).toEqual(
      [1, 2, 3, 4].map((n) => `CON-MAD-2026-${String(n).padStart(4, '0')}`)
    );
  });
});
