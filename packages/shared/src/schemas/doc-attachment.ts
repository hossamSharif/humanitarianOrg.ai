// Generic document attachments (research R31): bucket `doc-attachments`, path
// {tenant}/{doc_type}/{doc_id}/{id}, the 001 limits (10 MB, MIME allow-list, 20 per document).
import { z } from 'zod';
import { DOC_ATTACHMENT_PURPOSES, type DocAttachmentPurpose } from '../doc-types';
import { uuid } from './common';
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES } from './pr';

export const MAX_ATTACHMENTS_PER_DOC = 20;
export const DOC_ATTACHMENT_BUCKET = 'doc-attachments';

/** POST /X/:id/attachments/upload-url */
export const docAttachmentUpload = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(ATTACHMENT_MIME_TYPES),
    sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
    purpose: z.enum(DOC_ATTACHMENT_PURPOSES).default('general'),
  })
  .strict();
export type DocAttachmentUpload = z.input<typeof docAttachmentUpload>;

/** POST /X/:id/attachments/:attId/complete */
export const docAttachmentComplete = z.object({}).strict();

export const docAttachmentParams = z.object({ id: uuid, attId: uuid });

export interface DocAttachmentView {
  id: string;
  purpose: DocAttachmentPurpose;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string | null;
}

export interface DocAttachmentUploadTarget {
  attachmentId: string;
  /** Supabase Storage signed upload URL (PUT the file body) */
  signedUrl: string;
  path: string;
  token: string;
}
