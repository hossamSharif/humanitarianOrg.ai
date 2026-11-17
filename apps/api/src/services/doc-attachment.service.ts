// Attachments of any 002 document (research R31): signed upload/download URLs on the private
// `doc-attachments` bucket, the 001 limits (10 MB, MIME allow-list, 20 per document), and the
// lock rule — files are added and removed only while the document is a draft (or returned to its
// creator), except purposes that *are* the act (signed PO acknowledgement, received-by copy,
// settlement receipt), which their action endpoints add later.
import { randomUUID } from 'node:crypto';
import {
  ACTION_ATTACHMENT_PURPOSES,
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_DOC,
  MAX_ATTACHMENT_BYTES,
  type DocAttachmentPurpose,
  type DocAttachmentUpload,
  type DocAttachmentUploadTarget,
  type DocAttachmentView,
  type DocTypeCode,
} from '@ngo/shared';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import {
  DocAttachmentRepository,
  SupabaseDocAttachmentStorage,
  type DocAttachmentRecord,
  type DocAttachmentStore,
} from '../repositories/doc-attachment.repository';
import {
  DocRegistryRepository,
  type DocRegistryStore,
} from '../repositories/doc-registry.repository';
import type { AttachmentStorage } from '../repositories/pr-attachment.repository';
import type { RequestContext } from '../types/context';

/** Statuses in which the creator may still change the document's files. */
export const ATTACHMENT_EDITABLE_STATUSES: readonly string[] = ['draft', 'returned'];

export interface DocAttachmentRepos {
  attachments: DocAttachmentStore;
  registry: DocRegistryStore;
}

export interface DocAttachmentDeps {
  tenantId: string;
  run<T>(fn: (repos: DocAttachmentRepos) => Promise<T>): Promise<T>;
  storage: AttachmentStorage;
  newId?: () => string;
}

/** `{tenant}/{doc_type}/{doc_id}/{id}`: the storage policy checks segments 1–3. */
export function docAttachmentPath(
  tenantId: string,
  docType: DocTypeCode,
  docId: string,
  id: string
): string {
  return `${tenantId}/${docType}/${docId}/${id}`;
}

/** Locked once the document left draft, except for action purposes (R31). */
export function attachmentsLocked(status: string, purpose: DocAttachmentPurpose): boolean {
  return (
    !ATTACHMENT_EDITABLE_STATUSES.includes(status) && !ACTION_ATTACHMENT_PURPOSES.includes(purpose)
  );
}

/** 400 VALIDATION_ERROR naming every broken limit. */
export function assertDocAttachmentAllowed(
  input: { mimeType: string; sizeBytes: number },
  existingCount: number
): void {
  const errors: { field: string; message: string }[] = [];
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    errors.push({ field: 'mimeType', message: 'unsupported_type' });
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    errors.push({ field: 'sizeBytes', message: 'too_large' });
  }
  if (input.sizeBytes < 1) errors.push({ field: 'sizeBytes', message: 'empty' });
  if (existingCount >= MAX_ATTACHMENTS_PER_DOC) {
    errors.push({ field: 'attachments', message: 'too_many' });
  }
  if (errors.length) {
    throw new AppError('VALIDATION_ERROR', 'The attachment is not allowed', errors);
  }
}

function toView(a: DocAttachmentRecord): DocAttachmentView {
  return {
    id: a.id,
    purpose: a.purpose,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
  };
}

export class DocAttachmentService {
  private readonly newId: () => string;

  constructor(private readonly deps: DocAttachmentDeps) {
    this.newId = deps.newId ?? randomUUID;
  }

  static forContext(ctx: RequestContext): DocAttachmentService {
    return new DocAttachmentService({
      tenantId: ctx.tenantId,
      run: (fn) =>
        withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
          fn({
            attachments: new DocAttachmentRepository(tx.sql, ctx.tenantId),
            registry: new DocRegistryRepository(tx.sql),
          })
        ),
      storage: new SupabaseDocAttachmentStorage(ctx),
    });
  }

  /** Uploaded files of the document. */
  list(docType: DocTypeCode, docId: string): Promise<DocAttachmentView[]> {
    return this.deps.run(async ({ attachments, registry }) => {
      await this.docStatus(registry, docType, docId);
      return (await attachments.list(docType, docId))
        .filter((a) => a.uploadedAt !== null)
        .map(toView);
    });
  }

  /** POST /X/:id/attachments/upload-url — the row first, then a signed upload URL for it. */
  createUploadUrl(
    docType: DocTypeCode,
    docId: string,
    body: DocAttachmentUpload
  ): Promise<DocAttachmentUploadTarget> {
    // the route validated the body (docAttachmentUpload); limits are re-checked here
    const input = { ...body, purpose: body.purpose ?? 'general' };
    return this.deps.run(async ({ attachments, registry }) => {
      const status = await this.docStatus(registry, docType, docId);
      this.assertUnlocked(status, input.purpose);
      assertDocAttachmentAllowed(input, (await attachments.list(docType, docId)).length);

      const id = this.newId();
      const path = docAttachmentPath(this.deps.tenantId, docType, docId, id);
      await attachments.insert({
        id,
        docType,
        docId,
        purpose: input.purpose,
        storagePath: path,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });
      const { signedUrl, token } = await this.deps.storage.uploadUrl(path);
      return { attachmentId: id, signedUrl, path, token };
    });
  }

  /** POST /X/:id/attachments/:attId/complete — the file was PUT to the signed URL. */
  completeUpload(docType: DocTypeCode, docId: string, id: string): Promise<DocAttachmentView> {
    return this.deps.run(async ({ attachments, registry }) => {
      await this.docStatus(registry, docType, docId);
      await this.get(attachments, docType, docId, id);
      await attachments.markUploaded(id);
      return toView((await attachments.find(docType, docId, id))!);
    });
  }

  /** DELETE /X/:id/attachments/:attId — soft delete while the document is editable. */
  remove(docType: DocTypeCode, docId: string, id: string): Promise<void> {
    return this.deps.run(async ({ attachments, registry }) => {
      const status = await this.docStatus(registry, docType, docId);
      const attachment = await this.get(attachments, docType, docId, id);
      if (!ATTACHMENT_EDITABLE_STATUSES.includes(status)) {
        throw new AppError('INVALID_STATE', 'Attachments cannot be removed after submission');
      }
      await attachments.softDelete(attachment.id);
    });
  }

  /** GET /X/:id/attachments/:attId/url — a short-lived download URL. */
  downloadUrl(docType: DocTypeCode, docId: string, id: string): Promise<{ url: string }> {
    return this.deps.run(async ({ attachments, registry }) => {
      await this.docStatus(registry, docType, docId);
      const attachment = await this.get(attachments, docType, docId, id);
      if (attachment.uploadedAt === null) throw new AppError('NOT_FOUND', 'attachment not found');
      return {
        url: await this.deps.storage.downloadUrl(attachment.storagePath, attachment.fileName),
      };
    });
  }

  // -------------------------------------------------------------------------------------------

  private async docStatus(registry: DocRegistryStore, docType: DocTypeCode, docId: string) {
    const header = await registry.header(docType, docId);
    if (!header) throw new AppError('NOT_FOUND', 'document not found');
    return header.status;
  }

  private assertUnlocked(status: string, purpose: DocAttachmentPurpose): void {
    if (attachmentsLocked(status, purpose)) {
      throw new AppError('INVALID_STATE', 'Attachments are locked once the document is submitted');
    }
  }

  private async get(store: DocAttachmentStore, docType: DocTypeCode, docId: string, id: string) {
    const attachment = await store.find(docType, docId, id);
    if (!attachment || attachment.deletedAt !== null) {
      throw new AppError('NOT_FOUND', 'attachment not found');
    }
    return attachment;
  }
}
