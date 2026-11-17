// Generic document attachments (research R31): rows in doc_attachment, files in the private
// `doc-attachments` bucket at `{tenantId}/{docType}/{docId}/{attachmentId}`. Rows are
// soft-deleted; objects are kept for the audit trail. PR attachments stay in pr_attachment.
import {
  DOC_ATTACHMENT_BUCKET,
  type DocAttachmentPurpose,
  type DocAttachmentView,
  type DocTypeCode,
} from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { createUserClient, type UserClient } from '../db/supabase';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';
import { DOWNLOAD_URL_TTL_SECONDS, type AttachmentStorage } from './pr-attachment.repository';

export interface DocAttachmentRecord extends DocAttachmentView {
  docType: DocTypeCode;
  docId: string;
  storagePath: string;
  deletedAt: string | null;
}

export interface NewDocAttachment {
  id: string;
  docType: DocTypeCode;
  docId: string;
  purpose: DocAttachmentPurpose;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DocAttachmentStore {
  /** not soft-deleted, uploaded or not */
  list(docType: DocTypeCode, docId: string): Promise<DocAttachmentRecord[]>;
  find(docType: DocTypeCode, docId: string, id: string): Promise<DocAttachmentRecord | null>;
  insert(values: NewDocAttachment): Promise<DocAttachmentRecord>;
  markUploaded(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
}

interface Row {
  id: string;
  doc_type: DocTypeCode;
  doc_id: string;
  purpose: DocAttachmentPurpose;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string | null;
  deleted_at: string | null;
}

function toRecord(r: Row): DocAttachmentRecord {
  return {
    id: r.id,
    docType: r.doc_type,
    docId: r.doc_id,
    purpose: r.purpose,
    storagePath: r.storage_path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    deletedAt: r.deleted_at,
  };
}

const COLUMNS = `id, doc_type, doc_id, purpose, storage_path, file_name, mime_type, size_bytes,
  uploaded_by, to_json(uploaded_at)#>>'{}' as uploaded_at,
  to_json(deleted_at)#>>'{}' as deleted_at`;

export class DocAttachmentRepository implements DocAttachmentStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(docType: DocTypeCode, docId: string): Promise<DocAttachmentRecord[]> {
    const rows = await this.sql.unsafe<Row[]>(
      `select ${COLUMNS} from public.doc_attachment
       where tenant_id = $1 and doc_type = $2 and doc_id = $3 and deleted_at is null
       order by created_at, id`,
      [this.tenantId, docType, docId]
    );
    return rows.map(toRecord);
  }

  async find(docType: DocTypeCode, docId: string, id: string) {
    const [row] = await this.sql.unsafe<Row[]>(
      `select ${COLUMNS} from public.doc_attachment
       where tenant_id = $1 and doc_type = $2 and doc_id = $3 and id = $4`,
      [this.tenantId, docType, docId, id]
    );
    return row ? toRecord(row) : null;
  }

  async insert(v: NewDocAttachment): Promise<DocAttachmentRecord> {
    await this.sql`
      insert into public.doc_attachment
        (id, tenant_id, doc_type, doc_id, purpose, storage_path, file_name, mime_type, size_bytes)
      values (${v.id}, ${this.tenantId}, ${v.docType}, ${v.docId}, ${v.purpose},
              ${v.storagePath}, ${v.fileName}, ${v.mimeType}, ${v.sizeBytes})`;
    return (await this.find(v.docType, v.docId, v.id))!;
  }

  async markUploaded(id: string): Promise<void> {
    await this.sql`
      update public.doc_attachment set uploaded_at = coalesce(uploaded_at, now())
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }

  async softDelete(id: string): Promise<void> {
    await this.sql`
      update public.doc_attachment set deleted_at = now()
      where tenant_id = ${this.tenantId} and id = ${id}`;
  }
}

/** Signed URLs on the `doc-attachments` bucket; the caller's token applies the storage policies. */
export class SupabaseDocAttachmentStorage implements AttachmentStorage {
  private readonly db: UserClient;

  constructor(ctx: RequestContext) {
    this.db = createUserClient(ctx.accessToken);
  }

  async uploadUrl(path: string) {
    const { data, error } = await this.db.storage
      .from(DOC_ATTACHMENT_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw new AppError('FORBIDDEN', error?.message ?? 'Upload not allowed');
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async downloadUrl(path: string, fileName: string) {
    const { data, error } = await this.db.storage
      .from(DOC_ATTACHMENT_BUCKET)
      .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, { download: fileName });
    if (error || !data) throw new AppError('NOT_FOUND', error?.message ?? 'File not found');
    return data.signedUrl;
  }
}
