'use client';

// Admin preview: an office and a DoA amount → the steps a PR would be routed through now, with
// how many users could sign each (POST /approval-rules/resolve).
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { formatAmount } from '@ngo/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useBilingual, useOffices } from '@/features/users/api';
import { useApiError } from '@/lib/use-api-error';
import { useResolveRoute } from './api';

export function RulePreview({ currency }: { currency: string }) {
  const t = useTranslations('approvalRules');
  const locale = useLocale();
  const apiError = useApiError();
  const name = useBilingual();
  const { data: offices } = useOffices();
  const resolve = useResolveRoute();
  const [officeId, setOfficeId] = useState('');
  const [amount, setAmount] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!officeId || !amount) return;
    resolve.mutate({ officeId, amount });
  }

  const route = resolve.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('previewTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('previewIntro')}</p>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>{t('office')}</Label>
            <Select value={officeId || undefined} onValueChange={setOfficeId}>
              <SelectTrigger className="w-56" aria-label={t('office')}>
                <SelectValue placeholder={t('chooseOffice')} />
              </SelectTrigger>
              <SelectContent>
                {offices?.data.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.code} — {name(o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="preview-amount">{t('amount')}</Label>
            <MoneyInput
              id="preview-amount"
              value={amount}
              onChange={setAmount}
              currency={currency}
              className="w-48"
            />
          </div>
          <Button type="submit" disabled={!officeId || !amount || resolve.isPending}>
            {t('preview')}
          </Button>
        </form>

        {resolve.error ? (
          <p role="alert" className="text-sm text-destructive">
            {apiError(resolve.error)}
          </p>
        ) : null}

        {route ? (
          <div className="space-y-2">
            <p className="text-sm">
              {t('resolvedRule', {
                rule: route.ruleName,
                amount: formatAmount({ amount: route.amount, currency: route.currency }),
              })}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('step')}</TableHead>
                  <TableHead>{t('kind')}</TableHead>
                  <TableHead>{t('requiredRole')}</TableHead>
                  <TableHead>{t('eligibleCount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {route.steps.map((s) => (
                  <TableRow key={s.stepOrder}>
                    <TableCell>{s.stepOrder}</TableCell>
                    <TableCell>{t(`kinds.${s.kind}`)}</TableCell>
                    <TableCell>{locale === 'ar' ? s.roleNameAr : s.roleNameEn}</TableCell>
                    <TableCell>
                      {s.eligibleCount === 0 ? (
                        <Badge variant="destructive">{t('noEligible')}</Badge>
                      ) : (
                        s.eligibleCount
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
