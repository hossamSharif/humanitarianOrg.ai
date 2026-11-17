'use client';

// Reject / Return / reassign confirmation with a required reason, stored on the approval_action
// row (US5-5) — the shared document dialog with the PR wording.
import { useTranslations } from 'next-intl';
import {
  ReasonDialog as DocReasonDialog,
  type ReasonDialogProps,
} from '@/features/documents/reason-dialog';

export function ReasonDialog(props: Omit<ReasonDialogProps, 'reasonLabel' | 'inputId'>) {
  const t = useTranslations('pr.actions');
  return <DocReasonDialog {...props} reasonLabel={t('reason')} inputId="pr-action-reason" />;
}
