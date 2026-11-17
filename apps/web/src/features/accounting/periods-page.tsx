'use client';

// Accounting periods (002 US12, research R33): open a month, close it — after a warning that
// lists the approved vouchers dated in it that are not posted yet — and reopen it with a reason.
import {
  PERMISSIONS_002,
  formatDate,
  formatAmount,
  type AccountingPeriodView,
  type UnpostedVoucherView,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReasonDialog } from '@/features/documents/reason-dialog';
import { ErrorText } from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useClosePeriod, useCreatePeriod, usePeriods, useReopenPeriod } from './api';

const label = (p: Pick<AccountingPeriodView, 'year' | 'month'>) =>
  `${String(p.month).padStart(2, '0')}/${p.year}`;

function CloseDialog({
  period,
  onOpenChange,
}: {
  period: AccountingPeriodView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('accounting.periods');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const close = useClosePeriod();
  const [unposted, setUnposted] = useState<UnpostedVoucherView[] | null>(null);

  const run = (confirm: boolean) => {
    if (!period) return;
    close.mutate(
      { id: period.id, expectedVersion: period.version, confirm },
      {
        onSuccess: (result) => {
          if (result.requiresConfirmation) setUnposted(result.unpostedApproved);
          else {
            setUnposted(null);
            onOpenChange(false);
          }
        },
      }
    );
  };

  return (
    <Dialog
      open={period !== null}
      onOpenChange={(open) => {
        if (!open) {
          setUnposted(null);
          close.reset();
        }
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('closeTitle', { period: period ? label(period) : '' })}</DialogTitle>
          <DialogDescription>
            {unposted ? t('unpostedWarning') : t('closeDescription')}
          </DialogDescription>
        </DialogHeader>
        {unposted ? (
          <ul className="space-y-1 text-sm" dir="ltr">
            {unposted.map((v) => (
              <li key={v.id}>
                {v.number ?? v.type} · {formatDate(v.voucherDate)} ·{' '}
                {formatAmount({ amount: v.amount, currency: v.currency })}
              </li>
            ))}
          </ul>
        ) : null}
        {close.error ? <ErrorText>{apiError(close.error)}</ErrorText> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" disabled={close.isPending} onClick={() => run(!!unposted)}>
            {unposted ? t('closeAnyway') : t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpenPeriodForm() {
  const t = useTranslations('accounting.periods');
  const apiError = useApiError();
  const create = useCreatePeriod();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('openTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="period-month">{t('month')}</Label>
          <Input
            id="period-month"
            dir="ltr"
            inputMode="numeric"
            className="w-24"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="period-year">{t('year')}</Label>
          <Input
            id="period-year"
            dir="ltr"
            inputMode="numeric"
            className="w-28"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <Button
          disabled={create.isPending}
          onClick={() => create.mutate({ year: Number(year), month: Number(month) })}
        >
          {t('open')}
        </Button>
        {create.error ? <ErrorText>{apiError(create.error)}</ErrorText> : null}
      </CardContent>
    </Card>
  );
}

export function PeriodsPage() {
  const t = useTranslations('accounting.periods');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const has = useHasPermission();
  const canManage = has(PERMISSIONS_002.PERIODS_MANAGE);
  const { data, error, isPending } = usePeriods();
  const reopen = useReopenPeriod();
  const [closing, setClosing] = useState<AccountingPeriodView | null>(null);
  const [reopening, setReopening] = useState<AccountingPeriodView | null>(null);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      {canManage ? <OpenPeriodForm /> : null}
      {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
      {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
      {data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">{t('period')}</TableHead>
                <TableHead className="w-28">{t('statusLabel')}</TableHead>
                <TableHead>{t('history')}</TableHead>
                {canManage ? <TableHead className="w-36" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell dir="ltr">{label(p)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`status.${p.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.closedAt
                      ? t('closedOn', { date: formatDate(p.closedAt.slice(0, 10)) })
                      : null}
                    {p.reopenedAt
                      ? ` ${t('reopenedOn', {
                          date: formatDate(p.reopenedAt.slice(0, 10)),
                          reason: p.reopenReason ?? '',
                        })}`
                      : null}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      {p.status === 'open' ? (
                        <Button size="sm" variant="outline" onClick={() => setClosing(p)}>
                          {t('close')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setReopening(p)}>
                          {t('reopen')}
                        </Button>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <CloseDialog period={closing} onOpenChange={(open) => !open && setClosing(null)} />
      <ReasonDialog
        open={reopening !== null}
        onOpenChange={(open) => !open && setReopening(null)}
        title={t('reopenTitle', { period: reopening ? label(reopening) : '' })}
        description={t('reopenDescription')}
        confirmLabel={t('reopen')}
        busy={reopen.isPending}
        error={reopen.error ? apiError(reopen.error) : null}
        onConfirm={(reason) =>
          reopening &&
          reopen.mutate(
            { id: reopening.id, expectedVersion: reopening.version, reason },
            { onSuccess: () => setReopening(null) }
          )
        }
      />
    </div>
  );
}
