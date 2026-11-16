'use client';

// Finance check: move one PR line to another budget line of the same grant (FR-033). The list
// shows each line's Available; on BUDGET_EXCEEDED the shortfall is shown in the grant currency.
import { formatAmount, type BudgetShortfallLine, type PrDetail } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useChangeBudgetLine, useGrantBudgetLines } from './api';

export function ChangeBudgetLineDialog({
  open,
  onOpenChange,
  pr,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pr: PrDetail;
}) {
  const t = useTranslations('pr.actions.changeBudgetLine');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const budgetLines = useGrantBudgetLines(pr.grantId);
  const change = useChangeBudgetLine(pr.id);
  const [lineId, setLineId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [comment, setComment] = useState('');

  const line = pr.lines.find((l) => l.id === lineId);
  useEffect(() => {
    if (open) {
      setLineId(pr.lines[0]?.id ?? '');
      setComment('');
      change.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    setBudgetLineId(line?.budgetLineId ?? '');
  }, [line?.budgetLineId]);

  function errorText(): string | null {
    const err = change.error;
    if (!err) return null;
    if (err instanceof ApiRequestError && err.code === 'BUDGET_EXCEEDED') {
      const [l] = (err.details as { lines: BudgetShortfallLine[] }).lines;
      if (l) {
        return t('shortfall', {
          code: l.code,
          shortfall: formatAmount({ amount: l.shortfall, currency: l.currency }),
          available: formatAmount({ amount: l.available, currency: l.currency }),
        });
      }
    }
    return apiError(err);
  }

  async function submit() {
    const done = await change
      .mutateAsync({
        lineId,
        expectedVersion: pr.version,
        budgetLineId,
        comment: comment.trim() || null,
      })
      .catch(() => null);
    if (done) onOpenChange(false);
  }

  const error = errorText();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cbl-line">{t('line')}</Label>
          <Select value={lineId} onValueChange={setLineId}>
            <SelectTrigger id="cbl-line">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pr.lines.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  <span dir="auto">
                    {l.lineNo}. {l.description}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {line?.amountGrant && pr.grantCurrency ? (
            <p className="text-xs text-muted-foreground">
              {t('lineAmount', {
                amount: formatAmount({ amount: line.amountGrant, currency: pr.grantCurrency }),
              })}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cbl-target">{t('target')}</Label>
          <Select value={budgetLineId} onValueChange={setBudgetLineId}>
            <SelectTrigger id="cbl-target">
              <SelectValue placeholder={t('targetPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(budgetLines.data?.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  <span dir="auto">
                    {b.code} — {b.description}
                  </span>{' '}
                  <span dir="ltr" className="text-xs text-muted-foreground tabular-nums">
                    (
                    {t('available', {
                      amount: formatAmount({ amount: b.available, currency: b.currency }),
                    })}
                    )
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cbl-comment">{t('comment')}</Label>
          <Input
            id="cbl-comment"
            dir="auto"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
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
            disabled={
              change.isPending || !lineId || !budgetLineId || budgetLineId === line?.budgetLineId
            }
            onClick={() => void submit()}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
