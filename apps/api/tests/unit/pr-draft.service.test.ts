// T097 — drafts: only the creator edits or deletes; edits only while draft/returned; delete only
// a never-numbered draft (Business Rule 8); the autosave diff (FR-024); line defaults; budget
// lines from the PR's grant only (Business Rule 2); attachment rules (research R11).
import { MAX_ATTACHMENT_BYTES, type PrDraftLine } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import { KST_OFFICE_ID, MAD_OFFICE_ID } from './helpers/builders';
import { buildPrWorld, type PrWorld } from './helpers/pr-fakes';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

function header(w: PrWorld) {
  return {
    prDate: '2026-11-10',
    requestingOfficeId: MAD_OFFICE_ID,
    grantId: w.grantId,
    deliverToOfficeId: MAD_OFFICE_ID,
    prType: 'goods' as const,
  };
}

function line(w: PrWorld, overrides: Partial<PrDraftLine> = {}): PrDraftLine {
  return {
    description: 'Jerrycan 20 L',
    quantity: '10',
    unitId: w.unitId,
    unitCost: '87071.00',
    budgetLineId: w.budgetLineId,
    ...overrides,
  };
}

describe('PR drafts', () => {
  describe('createDraft', () => {
    it('creates an empty draft', async () => {
      const w = buildPrWorld();
      const created = await w.prService().createDraft({});
      expect(created).toEqual({ id: expect.any(String), version: 1, status: 'draft' });
    });

    it('defaults line currency to the base currency and location to the deliver-to office', async () => {
      const w = buildPrWorld();
      const created = await w.prService().createDraft({
        header: { ...header(w), deliverToOfficeId: KST_OFFICE_ID },
        lines: [line(w), line(w, { currency: 'USD', locationOfficeId: MAD_OFFICE_ID })],
      });
      const lines = await w.db.lines(created.id);
      expect(lines.map((l) => [l.lineNo, l.currency, l.locationOfficeId])).toEqual([
        [1, 'SDG', KST_OFFICE_ID],
        [2, 'USD', MAD_OFFICE_ID],
      ]);
    });

    it('refuses a requesting office the user has no access to → FORBIDDEN', async () => {
      const w = buildPrWorld();
      const err = await failure(
        w.prService().createDraft({ header: { requestingOfficeId: KST_OFFICE_ID } })
      );
      expect(err.code).toBe('FORBIDDEN');
    });

    it('refuses a budget line of another grant → PR_LINE_GRANT_MISMATCH (Business Rule 2)', async () => {
      const w = buildPrWorld();
      const foreign = '00000000-0000-4000-8000-0000000000c1';
      w.db.budgetLines.set(foreign, 'another-grant');
      const err = await failure(
        w
          .prService()
          .createDraft({ header: header(w), lines: [line(w, { budgetLineId: foreign })] })
      );
      expect(err.code).toBe('PR_LINE_GRANT_MISMATCH');
    });

    it('refuses a budget line on a PR without a grant', async () => {
      const w = buildPrWorld();
      const err = await failure(w.prService().createDraft({ lines: [line(w)] }));
      expect(err.code).toBe('PR_LINE_GRANT_MISMATCH');
    });
  });

  describe('updateDraft (autosave)', () => {
    it('only the creator may update → FORBIDDEN', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const err = await failure(
        w
          .prService({ userId: w.financeUserId })
          .updateDraft(pr.id, { expectedVersion: 1, header: header(w), lines: [] })
      );
      expect(err.code).toBe('FORBIDDEN');
    });

    it.each([
      'pending_finance_check',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ] as const)('a %s PR cannot be edited → INVALID_STATE', async (status) => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ status, number: 'PR-MAD-2026-0001' });
      const err = await failure(
        w.prService().updateDraft(pr.id, { expectedVersion: 1, header: header(w), lines: [] })
      );
      expect(err.code).toBe('INVALID_STATE');
    });

    it('a returned PR can be edited', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ status: 'returned', number: 'PR-MAD-2026-0001' });
      const saved = await w
        .prService()
        .updateDraft(pr.id, {
          expectedVersion: 1,
          header: { ...header(w), purpose: 'Fix' },
          lines: [],
        });
      expect(saved).toMatchObject({ status: 'returned', version: 2, changed: true });
    });

    it('a stale version → VERSION_CONFLICT', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ version: 5 });
      const err = await failure(
        w.prService().updateDraft(pr.id, { expectedVersion: 4, header: header(w), lines: [] })
      );
      expect(err.code).toBe('VERSION_CONFLICT');
    });

    it('writes nothing and keeps the version when the document is unchanged', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ requiredByDate: null });
      const [stored] = await w.db.lines(pr.id);
      w.db.writes = 0;
      const saved = await w.prService().updateDraft(pr.id, {
        expectedVersion: 1,
        header: header(w),
        // same values, quantity written differently
        lines: [
          {
            ...line(w, { quantity: '10.000', unitId: stored!.unitId }),
            id: stored!.id,
            currency: 'SDG',
            locationOfficeId: MAD_OFFICE_ID,
          },
        ],
      });
      expect(saved).toEqual({
        id: pr.id,
        version: 1,
        status: 'draft',
        lineIds: [stored!.id],
        changed: false,
      });
      expect(w.db.writes).toBe(0);
    });

    it('updates changed lines by id, inserts new ones, deletes removed ones and renumbers', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({}, [
        { description: 'A' },
        { description: 'B' },
        { description: 'C' },
      ]);
      const [a, b, c] = await w.db.lines(pr.id);
      const saved = await w.prService().updateDraft(pr.id, {
        expectedVersion: 1,
        header: { ...header(w), requiredByDate: '2026-11-30' },
        lines: [
          {
            id: c!.id,
            description: 'C',
            quantity: '10',
            unitId: w.unitId,
            unitCost: '87071.00',
            budgetLineId: w.budgetLineId,
          },
          line(w, { description: 'D' }),
          {
            id: a!.id,
            description: 'A changed',
            quantity: '10',
            unitId: w.unitId,
            unitCost: '87071.00',
            budgetLineId: w.budgetLineId,
          },
        ],
      });

      const lines = await w.db.lines(pr.id);
      expect(lines.map((l) => [l.lineNo, l.description])).toEqual([
        [1, 'C'],
        [2, 'D'],
        [3, 'A changed'],
      ]);
      expect(lines.map((l) => l.id)).not.toContain(b!.id);
      expect(lines[0]!.id).toBe(c!.id);
      expect(lines[2]!.id).toBe(a!.id);
      expect(saved.lineIds).toEqual(lines.map((l) => l.id));
      expect(saved.version).toBe(2);
    });

    it('a lines-only change still bumps the version once', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ requiredByDate: null });
      const saved = await w.prService().updateDraft(pr.id, {
        expectedVersion: 1,
        header: header(w),
        lines: [],
      });
      expect(saved).toMatchObject({ version: 2, lineIds: [], changed: true });
      expect(await w.db.lines(pr.id)).toEqual([]);
    });

    it('a new line defaults its location to the deliver-to office', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({}, []);
      await w.prService().updateDraft(pr.id, {
        expectedVersion: 1,
        header: { ...header(w), deliverToOfficeId: KST_OFFICE_ID },
        lines: [line(w)],
      });
      expect((await w.db.lines(pr.id))[0]!.locationOfficeId).toBe(KST_OFFICE_ID);
    });

    it('a budget line must belong to the PR grant → PR_LINE_GRANT_MISMATCH', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const err = await failure(
        w.prService().updateDraft(pr.id, {
          expectedVersion: 1,
          header: { ...header(w), grantId: '00000000-0000-4000-8000-0000000000d1' },
          lines: [line(w)],
        })
      );
      expect(err.code).toBe('PR_LINE_GRANT_MISMATCH');
    });

    it('changing the grant clears budget lines of the old grant before saving', async () => {
      const w = buildPrWorld();
      const newGrant = '00000000-0000-4000-8000-0000000000d2';
      const pr = w.seedDraft();
      const [stored] = await w.db.lines(pr.id);
      await w.prService().updateDraft(pr.id, {
        expectedVersion: 1,
        header: { ...header(w), grantId: newGrant },
        lines: [{ ...line(w, { budgetLineId: null }), id: stored!.id }],
      });
      expect((await w.db.find(pr.id))!.grantId).toBe(newGrant);
      expect((await w.db.lines(pr.id))[0]!.budgetLineId).toBeNull();
    });
  });

  describe('deleteDraft', () => {
    it('deletes a never-submitted draft', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      await w.prService().deleteDraft(pr.id);
      expect(await w.db.find(pr.id)).toBeNull();
    });

    it('only the creator may delete → FORBIDDEN', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      expect(
        (await failure(w.prService({ userId: w.financeUserId }).deleteDraft(pr.id))).code
      ).toBe('FORBIDDEN');
    });

    it.each([
      ['returned', 'PR-MAD-2026-0001'],
      ['pending_finance_check', 'PR-MAD-2026-0001'],
      ['cancelled', 'PR-MAD-2026-0001'],
    ] as const)(
      'a %s PR cannot be deleted → INVALID_STATE (Business Rule 8)',
      async (status, number) => {
        const w = buildPrWorld();
        const pr = w.seedDraft({ status, number });
        expect((await failure(w.prService().deleteDraft(pr.id))).code).toBe('INVALID_STATE');
      }
    );
  });

  describe('getDetail', () => {
    it('offers update, submit and delete to the creator of a draft', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const detail = await w.prService().getDetail(pr.id);
      expect(detail.availableActions).toEqual(['update', 'submit', 'delete']);
      expect(detail.totals).toEqual([{ amount: '870710.00', currency: 'SDG' }]);
      expect(detail.grantCurrency).toBe('USD');
    });

    it('offers nothing to another user, and no delete once numbered', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft({ status: 'returned', number: 'PR-MAD-2026-0001' });
      expect(
        (await w.prService({ userId: w.financeUserId }).getDetail(pr.id)).availableActions
      ).toEqual([]);
      expect((await w.prService().getDetail(pr.id)).availableActions).toEqual([
        'update',
        'submit',
        'cancel',
      ]);
    });

    it('flags the pending step the caller is eligible for', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      await w.workflow().submit(pr.id, { expectedVersion: 1 });

      const finance = await w.prService({ userId: w.financeUserId }).getDetail(pr.id);
      expect(finance.steps.map((s) => [s.stepOrder, s.canApprove, s.canChangeBudgetLine])).toEqual([
        [1, true, true],
        [2, false, false],
      ]);
      const requester = await w.prService().getDetail(pr.id);
      expect(requester.steps.every((s) => !s.canApprove)).toBe(true);
      // only cancelling their own pending PR (US6)
      expect(requester.availableActions).toEqual(['cancel']);
      expect(requester.reservations).toEqual([
        {
          budgetLineId: w.budgetLineId,
          cycle: 1,
          amount: '1451.18',
          currency: 'USD',
          status: 'reserved',
        },
      ]);
    });
  });

  describe('attachments', () => {
    const pdf = { fileName: 'quote.pdf', mimeType: 'application/pdf' as const, sizeBytes: 1000 };

    it('issues a signed upload URL at {tenant}/{pr}/{attachment}', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const target = await w.prService().createUploadUrl(pr.id, pdf);
      expect(target.path).toBe(`${w.actor.tenantId}/${pr.id}/${target.attachmentId}`);
      expect(target.signedUrl).toContain(target.path);
    });

    it.each([
      ['application/pdf'],
      ['image/jpeg'],
      ['image/png'],
      ['image/webp'],
      ['image/heic'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['text/csv'],
      ['text/plain'],
    ])('accepts %s', async (mimeType) => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      await expect(
        w.prService().createUploadUrl(pr.id, { ...pdf, mimeType: mimeType as typeof pdf.mimeType })
      ).resolves.toBeTruthy();
    });

    it('rejects other types and files over 10 MB', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const exe = await failure(
        w
          .prService()
          .createUploadUrl(pr.id, { ...pdf, mimeType: 'application/x-msdownload' as never })
      );
      expect(exe.details).toEqual([{ field: 'mimeType', message: 'unsupported_type' }]);
      const big = await failure(
        w.prService().createUploadUrl(pr.id, { ...pdf, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })
      );
      expect(big.details).toEqual([{ field: 'sizeBytes', message: 'too_large' }]);
      await expect(
        w.prService().createUploadUrl(pr.id, { ...pdf, sizeBytes: MAX_ATTACHMENT_BYTES })
      ).resolves.toBeTruthy();
    });

    it('allows at most 20 attachments per PR; removed ones do not count', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const service = w.prService();
      const first = await service.createUploadUrl(pr.id, pdf);
      for (let i = 1; i < 20; i++) await service.createUploadUrl(pr.id, pdf);
      const err = await failure(service.createUploadUrl(pr.id, pdf));
      expect(err.details).toEqual([{ field: 'attachments', message: 'too_many' }]);

      await service.removeAttachment(pr.id, first.attachmentId);
      await expect(service.createUploadUrl(pr.id, pdf)).resolves.toBeTruthy();
    });

    it('only while draft or returned, and only by the creator', async () => {
      const w = buildPrWorld();
      const pending = w.seedDraft({ status: 'pending_finance_check', number: 'PR-MAD-2026-0001' });
      expect((await failure(w.prService().createUploadUrl(pending.id, pdf))).code).toBe(
        'INVALID_STATE'
      );
      const draft = w.seedDraft();
      expect(
        (await failure(w.prService({ userId: w.financeUserId }).createUploadUrl(draft.id, pdf)))
          .code
      ).toBe('FORBIDDEN');
      const target = await w.prService().createUploadUrl(draft.id, pdf);
      w.db.prs.get(draft.id)!.status = 'pending_finance_check';
      expect(
        (await failure(w.prService().removeAttachment(draft.id, target.attachmentId))).code
      ).toBe('INVALID_STATE');
    });

    it('lists an attachment once its upload is confirmed and serves a download URL', async () => {
      const w = buildPrWorld();
      const pr = w.seedDraft();
      const service = w.prService();
      const target = await service.createUploadUrl(pr.id, pdf);
      expect((await service.getDetail(pr.id)).attachments).toEqual([]);
      await expect(service.downloadUrl(pr.id, target.attachmentId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      await service.completeUpload(pr.id, target.attachmentId);
      expect((await service.getDetail(pr.id)).attachments).toEqual([
        expect.objectContaining({ id: target.attachmentId, fileName: 'quote.pdf' }),
      ]);
      expect((await service.downloadUrl(pr.id, target.attachmentId)).url).toContain(target.path);

      await service.removeAttachment(pr.id, target.attachmentId);
      expect((await service.getDetail(pr.id)).attachments).toEqual([]);
    });
  });
});
