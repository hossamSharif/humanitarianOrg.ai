// PR attachments (research R11): rows in pr_attachment, files in the private `pr-attachments`
// bucket at `{tenantId}/{prId}/{attachmentId}`. Rows are soft-deleted; objects are kept.
import type { PrAttachmentView } from '@ngo/shared';
import type { TxSql } from '../db/tx';
import { createUserClient, type UserClient } from '../db/supabase';
import { AppError } from '../middleware/error';
import type { RequestContext } from '../types/context';

export const ATTACHMENT_BUCKET = 'pr-attachments';
export const DOWNLOAD_URL_TTL_SECONDS = 300;

export interface AttachmentRecord extends PrAttachmentView {
  prId: string;
  storagePath: string;
  deletedAt: string | null;
}

export interface NewAttachment {
  id: string;
  prId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PrAttachmentStore {
  /** not soft-deleted, uploaded or not */
  list(prId: string): Promise<AttachmentRecord[]>;
  find(prId: string, id: string): Promise<AttachmentRecord | null>;
  insert(values: NewAttachment): Promise<AttachmentRecord>;
  markUploaded(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
}

/** Signed URLs from Supabase Storage; the caller's token applies the storage policies. */
export interface AttachmentStorage {
  uploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  downloadUrl(path: string, fileName: string): Promise<string>;
}

interface AttachmentDbRow {
  id: string;
  pr_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string | null;
  deleted_at: string | null;
}

function toAttachment(r: AttachmentDbRow): AttachmentRecord {
  return {
    id: r.id,
    prId: r.pr_id,
    storagePath: r.storage_path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    deletedAt: r.deleted_at,
  };
}

const COLUMNS = `id, pr_id, storage_path, file_name, mime_type, size_bytes, uploaded_by,
  to_json(uploaded_at)#>>'{}' as uploaded_at, to_json(deleted_at)#>>'{}' as deleted_at`;

export class PrAttachmentRepository implements PrAttachmentStore {
  constructor(
    private readonly sql: TxSql,
    private readonly tenantId: string
  ) {}

  async list(prId: string): Promise<AttachmentRecord[]> {
    const rows = await this.sql.unsafe<AttachmentDbRow[]>(
      `select ${COLUMNS} from public.pr_attachment
       where pr_id = $1 and deleted_at is null order by created_at, id`,
      [prId]
    );
    return rows.map(toAttachment);
  }

  async find(prId: string, id: string): Promise<AttachmentRecord | null> {
    const [row] = await this.sql.unsafe<AttachmentDbRow[]>(
      `select ${COLUMNS} from public.pr_attachment where pr_id = $1 and id = $2`,
      [prId, id]
    );
    return row ? toAttachment(row) : null;
  }

  async insert(v: NewAttachment): Promise<AttachmentRecord> {
    await this.sql`
      insert into public.pr_attachment
        (id, tenant_id, pr_id, storage_path, file_name, mime_type, size_bytes)
      values (${v.id}, ${this.tenantId}, ${v.prId}, ${v.storagePath}, ${v.fileName},
              ${v.mimeType}, ${v.sizeBytes})`;
    return (await this.find(v.prId, v.id))!;
  }

  async markUploaded(id: string): Promise<void> {
    await this.sql`
      update public.pr_attachment set uploaded_at = coalesce(uploaded_at, now()) where id = ${id}`;
  }

  async softDelete(id: string): Promise<void> {
    await this.sql`update public.pr_attachment set deleted_at = now() where id = ${id}`;
  }
}

export class SupabaseAttachmentStorage implements AttachmentStorage {
  private readonly db: UserClient;

  constructor(ctx: RequestContext) {
    this.db = createUserClient(ctx.accessToken);
  }

  async uploadUrl(path: string) {
    const { data, error } = await this.db.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw new AppError('FORBIDDEN', error?.message ?? 'Upload not allowed');
    return { signedUrl: data.signedUrl, token: data.token };
  }

  async downloadUrl(path: string, fileName: string) {
    const { data, error } = await this.db.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, { download: fileName });
    if (error || !data) throw new AppError('NOT_FOUND', error?.message ?? 'File not found');
    return data.signedUrl;
  }
}
