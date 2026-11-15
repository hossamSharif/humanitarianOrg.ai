// Offices (FR-002, US1-2) and units of measure (FR-003): unique codes, code locked once a PR
// uses the office, deactivation instead of deletion, tenant isolation.
import { createOfficeBody, createUnitBody } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import { OfficeService } from '../../src/services/office.service';
import { UnitService } from '../../src/services/unit.service';
import { OTHER_TENANT_ID, TENANT_ID } from './helpers/builders';
import { InMemoryOfficeStore, InMemoryUnitStore } from './helpers/in-memory-office-store';

const all = { pagination: { page: 1, pageSize: 50 } };

function offices() {
  const store = new InMemoryOfficeStore(TENANT_ID);
  return { store, service: new OfficeService(store) };
}

const madani = createOfficeBody.parse({ code: 'MAD', nameAr: 'مدني', nameEn: 'Madani' });

describe('OfficeService', () => {
  it('creates an active office with its code unlocked', async () => {
    const { service } = offices();
    expect(await service.create(madani)).toMatchObject({
      code: 'MAD',
      nameEn: 'Madani',
      isActive: true,
      codeLocked: false,
      address: null,
    });
  });

  it('rejects a duplicate code within the tenant, but not across tenants', async () => {
    const { store, service } = offices();
    await service.create(madani);
    await expect(service.create(madani)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'code', message: 'already_exists' }],
    });

    store.seed({
      id: 'other-office',
      tenantId: OTHER_TENANT_ID,
      code: 'KST',
    } as never);
    await expect(
      service.create({ ...madani, code: 'KST', nameEn: 'Kosti' })
    ).resolves.toMatchObject({ code: 'KST' });
  });

  it('blocks a code change once a PR references the office (409 OFFICE_CODE_IN_USE)', async () => {
    const { store, service } = offices();
    const office = await service.create(madani);
    store.inUse.add(office.id);

    await expect(service.update(office.id, { code: 'MDN' })).rejects.toMatchObject({
      code: 'OFFICE_CODE_IN_USE',
      status: 409,
    });
    // same code and other fields are fine; the code shows as locked
    await expect(
      service.update(office.id, { code: 'MAD', nameEn: 'Wad Madani' })
    ).resolves.toMatchObject({ nameEn: 'Wad Madani', codeLocked: true });
  });

  it('allows a code change while unused, unless another office has that code', async () => {
    const { service } = offices();
    const mad = await service.create(madani);
    await service.create({ ...madani, code: 'KST', nameEn: 'Kosti' });
    await expect(service.update(mad.id, { code: 'KST' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(service.update(mad.id, { code: 'MDN' })).resolves.toMatchObject({
      code: 'MDN',
    });
  });

  it('deactivates and filters by active', async () => {
    const { service } = offices();
    const mad = await service.create(madani);
    await service.create({ ...madani, code: 'KST', nameEn: 'Kosti' });
    await service.update(mad.id, { isActive: false });

    expect((await service.list({ ...all, active: true })).data.map((o) => o.code)).toEqual(['KST']);
    expect((await service.list(all)).total).toBe(2);
  });

  it('other tenants’ offices are NOT_FOUND', async () => {
    const { store, service } = offices();
    store.seed({ id: 'foreign', tenantId: OTHER_TENANT_ID, code: 'PZU' } as never);
    await expect(service.update('foreign', { nameEn: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('validates the code pattern ^[A-Z0-9]{2,10}$ in the shared schema', () => {
    for (const code of ['M', 'mad', 'MAD-1', 'ABCDEFGHIJK']) {
      expect(createOfficeBody.safeParse({ ...madani, code }).success, code).toBe(false);
    }
    for (const code of ['MA', 'MAD', 'PZU2', 'ABCDEFGHIJ']) {
      expect(createOfficeBody.safeParse({ ...madani, code }).success, code).toBe(true);
    }
  });
});

describe('UnitService', () => {
  const roll = createUnitBody.parse({ code: 'ROLL', nameAr: 'لفة', nameEn: 'Roll' });

  it('creates, edits and deactivates units; codes are unique', async () => {
    const service = new UnitService(new InMemoryUnitStore(TENANT_ID));
    const unit = await service.create(roll);
    expect(unit).toMatchObject({ code: 'ROLL', isActive: true });
    await expect(service.create(roll)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const edited = await service.update(unit.id, { nameEn: 'Roll (10 m)', isActive: false });
    expect(edited).toMatchObject({ nameEn: 'Roll (10 m)', isActive: false });
    expect((await service.list({ ...all, active: true })).data).toEqual([]);
  });

  it('rejects a code change to an existing code', async () => {
    const service = new UnitService(new InMemoryUnitStore(TENANT_ID));
    const a = await service.create(roll);
    await service.create({ ...roll, code: 'PCS', nameEn: 'PCs' });
    await expect(service.update(a.id, { code: 'PCS' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
