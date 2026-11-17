'use client';

// Supporting files of any 002 document (research R31): uploaded straight to Storage with a
// signed URL after the API accepted the type and size; at most 20 per document, 10 MB each;
// editable while draft or returned. `purpose` tags new files (offer scan, acknowledgement, …).
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_DOC,
  MAX_ATTACHMENT_BYTES,
  type DocAttachmentPurpose,
  type DocTypeSlug,
} from '@ngo/shared';
import { Button } from '@ngo/ui';
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ChangeEvent } from 'react';
import { useApiError } from '@/lib/use-api-error';
import {
  docAttachmentDownloadUrl,
  useDocAttachments,
  useRemoveDocAttachment,
  useUploadDocAttachment,
} from './api';

const ACCEPT = ATTACHMENT_MIME_TYPES.join(',');

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toString()} MB`;
}

export function AttachmentsPanel({
  slug,
  docId,
  editable,
  purpose,
}: {
  slug: DocTypeSlug;
  docId: string;
  editable: boolean;
  purpose?: DocAttachmentPurpose;
}) {
  const t = useTranslations('documents.attachments');
  const apiError = useApiError();
  const { data: attachments = [] } = useDocAttachments(slug, docId);
  const upload = useUploadDocAttachment(slug, docId);
  const remove = useRemoveDocAttachment(slug, docId);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    setProblem(null);
    let count = attachments.length;
    for (const file of files) {
      if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
        setProblem(t('wrongType', { name: file.name }));
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setProblem(t('tooLarge', { name: file.name }));
        continue;
      }
      if (count >= MAX_ATTACHMENTS_PER_DOC) {
        setProblem(t('tooMany', { max: MAX_ATTACHMENTS_PER_DOC }));
        break;
      }
      try {
        await upload.mutateAsync({ file, purpose });
        count++;
      } catch (err) {
        setProblem(apiError(err));
      }
    }
  }

  async function download(id: string) {
    try {
      window.open(await docAttachmentDownloadUrl(slug, docId, id), '_blank', 'noopener');
    } catch (err) {
      setProblem(apiError(err));
    }
  }

  return (
    <section
      aria-labelledby="doc-attachments-title"
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="doc-attachments-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        {editable ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              aria-label={t('add')}
              onChange={onFiles}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Paperclip className="me-2 h-4 w-4" aria-hidden />
              {upload.isPending ? t('uploading') : t('add')}
            </Button>
          </>
        ) : null}
      </div>
      {editable ? (
        <p className="text-xs text-muted-foreground">
          {t('limits', { max: MAX_ATTACHMENTS_PER_DOC, size: formatSize(MAX_ATTACHMENT_BYTES) })}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                {a.fileName}
              </span>
              <span dir="ltr" className="text-xs text-muted-foreground tabular-nums">
                {formatSize(a.sizeBytes)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void download(a.id)}
                aria-label={t('download', { name: a.fileName })}
              >
                <Download className="h-4 w-4" aria-hidden />
              </Button>
              {editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                  aria-label={t('remove', { name: a.fileName })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
