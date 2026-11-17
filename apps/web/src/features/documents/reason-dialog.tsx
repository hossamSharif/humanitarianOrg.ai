'use client';

// Reject / Return / cancel / reassign confirmation with a required reason, stored on the
// signature row (001 US5-5, 002 shared document actions). Used by PRs and every 002 document.
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  /** extra fields above the reason (e.g. the reassignment target) */
  children?: ReactNode;
  /** label of the reason field; defaults to documents.actions.reason */
  reasonLabel?: string;
  inputId?: string;
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy,
  error,
  onConfirm,
  children,
  reasonLabel,
  inputId = 'doc-action-reason',
}: ReasonDialogProps) {
  const t = useTranslations('documents.actions');
  const tc = useTranslations('common');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{reasonLabel ?? t('reason')}</Label>
          <Textarea
            id={inputId}
            dir="auto"
            rows={4}
            value={reason}
            required
            aria-required
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={busy || reason.trim() === ''}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
