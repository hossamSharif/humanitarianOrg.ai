'use client';

import { GRANT_STATUSES, type Grant, type GrantStatus } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useChangeGrantStatus } from './api';
import { ErrorText, WarningBanner } from './shared';

/**
 * Status change (FR-022). When PRs are pending the API first answers with their count; the user
 * confirms that number and the change is sent again with `confirmPendingCount`.
 */
export function GrantStatusDialog({
  open,
  onOpenChange,
  grant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grant: Grant;
}) {
  const t = useTranslations('grants');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const change = useChangeGrantStatus(grant.id);
  const [status, setStatus] = useState<GrantStatus>(grant.status);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(grant.status);
      setPendingCount(null);
      change.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grant.status]);

  async function submit() {
    const result = await change
      .mutateAsync({
        status,
        expectedVersion: grant.version,
        ...(pendingCount !== null ? { confirmPendingCount: pendingCount } : {}),
      })
      .catch(() => null);
    if (!result) return;
    if (result.requiresConfirmation) {
      setPendingCount(result.pendingPrCount);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('changeStatus')}</DialogTitle>
          <DialogDescription>{t('changeStatusIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="grant-status">{t('statusLabel')}</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as GrantStatus);
              setPendingCount(null);
            }}
          >
            <SelectTrigger id="grant-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {pendingCount !== null ? (
          <WarningBanner>{t('pendingPrWarning', { count: pendingCount })}</WarningBanner>
        ) : null}
        {change.error ? <ErrorText>{apiError(change.error)}</ErrorText> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={change.isPending || status === grant.status}
          >
            {pendingCount !== null ? t('confirmStatusChange') : t('applyStatus')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
