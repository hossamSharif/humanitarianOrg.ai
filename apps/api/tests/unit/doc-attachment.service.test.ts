// T011 — generic document attachments (research R31): 10 MB, MIME allow-list, ≤ 20 per
// document, path {tenant}/{doc_type}/{doc_id}/{id}, and the lock once the document left draft
// except for purposes that are the act itself.
import { randomUUID } from 'node:crypto';
import type { DocTypeCode } from '@ngo/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/error';
import type {
  DocAttachmentRecord,
  DocAttachmentStore,
  NewDocAttachment,
} from '../../src/repositories/doc-attachment.repository';
import type { DocHeader, DocRegistryStore } from '../../src/repositories/doc-registry.repository';
import {
  DocAttachmentService,
  attachmentsLocked,
  docAttachmentPath,
} from '../../src/services/doc-attachment.service';
import { TENANT_ID } from './helpers/builders';

class FakeAttachments implements DocAttachmentStore {
  rows: DocAttachmentRecord[] = [];

  async list(docType: DocTypeCode, docId: string) {
    return this.rows.filter((r) => r.docType === docType && r.docId === docId && !r.deletedAt);
  }
  async find(docType: DocTypeCode, docId: string, id: string) {
    return this.rows.find((r) => r.docType === docType && r.docId === docId && r.id === id) ?? null;
  }
  async insert(v: NewDocAttachment) {
    const row: DocAttachmentRecord = {
      ...v,
      uploadedBy: 'me',
      uploadedAt: null,
      deletedAt: null,
    };
    this.rows.push(row);
    return row;
  }
  async markUploaded(id: string) {
    this.rows.find((r) => r.id === id)!.uploadedAt = '2026-11-16T08:00:00Z';
  }
  async softDelete(id: string) {
    this.rows.find((r) => r.id === id)!.deletedAt = '2026-11-16T09:00:00Z';
  }
}

function world(status = 'draft') {
  const attachments = new FakeAttachments();
  const doc: DocHeader = { id: randomUUID(), status, number: null, officeId: null };
  const registry: DocRegistryStore = {
    header: async (_type, id) => (id === doc.id ? doc : null),
  };
  const uploads: string[] = [];
  const service = new DocAttachmentService({
    tenantId: TENANT_ID,
    run: (fn) => fn({ attachments, registry }),
    storage: {
      uploadUrl: async (path) => {
        uploads.push(path);
        return { signedUrl: `https://storage/${path}`, token: 't' };
      },
      downloadUrl: async (path) => `https://storage/${path}?download`,
    },
  });
  return { attachments, doc, service, uploads };
}

const pdf = { fileName: 'quote.pdf', mimeType: 'application/pdf' as const, sizeBytes: 1024 };

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('doc attachments', () => {
  it('stores the file at {tenant}/{doc_type}/{doc_id}/{id} and signs that path', async () => {
    const w = world();
    const target = await w.service.createUploadUrl('PO', w.doc.id, pdf);
    expect(target.path).toBe(`${TENANT_ID}/PO/${w.doc.id}/${target.attachmentId}`);
    expect(target.path).toBe(docAttachmentPath(TENANT_ID, 'PO', w.doc.id, target.attachmentId));
    expect(w.uploads).toEqual([target.path]);
    expect(w.attachments.rows[0]).toMatchObject({ purpose: 'general', storagePath: target.path });
  });

  it('rejects files over 10 MB and types outside the allow-list', async () => {
    const w = world();
    const big = await failure(
      w.service.createUploadUrl('PO', w.doc.id, { ...pdf, sizeBytes: 10 * 1024 * 1024 + 1 })
    );
    expect(big.details).toEqual([{ field: 'sizeBytes', message: 'too_large' }]);
    const exe = await failure(
      w.service.createUploadUrl('PO', w.doc.id, {
        ...pdf,
        mimeType: 'application/x-msdownload' as never,
      })
    );
    expect(exe.details).toEqual([{ field: 'mimeType', message: 'unsupported_type' }]);
    expect(w.attachments.rows).toEqual([]);
  });

  it('allows at most 20 attachments per document', async () => {
    const w = world();
    for (let i = 0; i < 20; i++) await w.service.createUploadUrl('PO', w.doc.id, pdf);
    const err = await failure(w.service.createUploadUrl('PO', w.doc.id, pdf));
    expect(err.details).toEqual([{ field: 'attachments', message: 'too_many' }]);
  });

  it('locks general attachments once the document left draft', async () => {
    const w = world('pending_approval');
    const err = await failure(w.service.createUploadUrl('PO', w.doc.id, pdf));
    expect(err.code).toBe('INVALID_STATE');
  });

  it('still accepts the purposes that are the act (acknowledgement, received-by copy, receipt)', async () => {
    const w = world('approved');
    for (const purpose of ['po_acknowledgement', 'received_by_copy', 'receipt'] as const) {
      await expect(
        w.service.createUploadUrl('PO', w.doc.id, { ...pdf, purpose })
      ).resolves.toMatchObject({ attachmentId: expect.any(String) });
    }
    expect(attachmentsLocked('approved', 'general')).toBe(true);
    expect(attachmentsLocked('returned', 'general')).toBe(false);
  });

  it('removal only while editable; downloads only once uploaded', async () => {
    const w = world();
    const target = await w.service.createUploadUrl('PO', w.doc.id, pdf);
    expect((await failure(w.service.downloadUrl('PO', w.doc.id, target.attachmentId))).code).toBe(
      'NOT_FOUND'
    );
    await w.service.completeUpload('PO', w.doc.id, target.attachmentId);
    await expect(w.service.downloadUrl('PO', w.doc.id, target.attachmentId)).resolves.toEqual({
      url: `https://storage/${target.path}?download`,
    });
    expect(await w.service.list('PO', w.doc.id)).toHaveLength(1);

    w.doc.status = 'pending_approval';
    const locked = await failure(w.service.remove('PO', w.doc.id, target.attachmentId));
    expect(locked.code).toBe('INVALID_STATE');

    w.doc.status = 'draft';
    await w.service.remove('PO', w.doc.id, target.attachmentId);
    expect(await w.service.list('PO', w.doc.id)).toEqual([]);
  });

  it('an unreadable or missing document is NOT_FOUND', async () => {
    const w = world();
    expect((await failure(w.service.createUploadUrl('PO', randomUUID(), pdf))).code).toBe(
      'NOT_FOUND'
    );
  });
});
