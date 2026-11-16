'use client';

// Edit screen of a draft or returned PR: the form with autosave, attachments, submit and (for a
// never-submitted draft) delete. A returned PR shows the return reason and keeps its number; its
// resubmission starts a new approval cycle (FR-038), or the requester cancels it (US6).
import { zodResolver } from '@hookform/resolvers/zod';
import type { PrDetail } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ngo/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useDeletePr } from './api';
import { AttachmentsPanel } from './attachments-panel';
import { CancelPrButton } from './cancel-pr-button';
import { fromDetail, prSubmitFormSchema, type PrFormValues } from './form-model';
import { PrForm } from './pr-form';
import { PrStatusBadge } from './pr-status-badge';
import { ReturnedBanner } from './returned-banner';
import { SubmitButton } from './submit-button';
import { useAutosave, type AutosaveStatus } from './use-autosave';

function SaveState({ status }: { status: AutosaveStatus }) {
  const t = useTranslations('pr.form.autosave');
  if (status === 'idle') return null;
  return (
    <span
      role="status"
      className={
        status === 'error' || status === 'conflict'
          ? 'text-sm text-destructive'
          : 'text-sm text-muted-foreground'
      }
    >
      {t(status)}
    </span>
  );
}

export function PrEditor({
  pr,
  userId,
  baseCurrency,
}: {
  pr: PrDetail;
  userId: string;
  baseCurrency: string;
}) {
  const t = useTranslations('pr.form');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const serverValues = useMemo(() => fromDetail(pr), [pr]);
  const form = useForm<PrFormValues>({
    defaultValues: serverValues,
    resolver: zodResolver(prSubmitFormSchema) as unknown as Resolver<PrFormValues>,
  });
  const autosave = useAutosave({
    prId: pr.id,
    userId,
    form,
    serverValues,
    serverVersion: pr.version,
    enabled: true,
  });
  const [shortfalls, setShortfalls] = useState<Map<string, string>>(new Map());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeletePr(pr.id);

  async function deleteDraft() {
    autosave.discard();
    await remove.mutateAsync();
    router.replace('/prs');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold" dir="auto">
            {pr.number ?? t('newTitle')}
          </h1>
          <PrStatusBadge status={pr.status} />
          <SaveState status={autosave.status} />
        </div>
        {pr.availableActions.includes('delete') ? (
          <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="me-2 h-4 w-4" aria-hidden />
            {t('delete')}
          </Button>
        ) : null}
      </div>

      {pr.status === 'returned' && pr.returnReason ? (
        <ReturnedBanner reason={pr.returnReason} resubmit />
      ) : null}

      {autosave.status === 'conflict' ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive p-3"
        >
          <p className="text-sm">{t('conflict')}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              autosave.discard();
              window.location.reload();
            }}
          >
            {t('reload')}
          </Button>
        </div>
      ) : null}
      {autosave.restored ? (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          {t('restored')}
        </p>
      ) : null}

      <PrForm form={form} baseCurrency={baseCurrency} shortfalls={shortfalls} />
      <AttachmentsPanel prId={pr.id} attachments={pr.attachments} editable />

      <div className="flex flex-wrap justify-end gap-2">
        <CancelPrButton
          pr={pr}
          prepare={() => autosave.flush()}
          onCancelled={() => {
            autosave.discard();
            router.replace(`/prs/${pr.id}`);
          }}
        />
        <SubmitButton
          prId={pr.id}
          form={form}
          autosave={autosave}
          onShortfalls={setShortfalls}
          onSubmitted={() => router.replace(`/prs/${pr.id}`)}
        />
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteBody')}</DialogDescription>
          </DialogHeader>
          {remove.error ? (
            <p className="text-sm text-destructive">{apiError(remove.error)}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => void deleteDraft()}
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
