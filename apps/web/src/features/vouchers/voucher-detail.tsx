'use client';

// Voucher page (002 US13): the BPV-style lines with currency, rate and base columns and their
// totals, the amount in words, submission, the check and approval steps, posting (received-by
// name, date and the signed copy for cash and cheques) and reversal with a reason and date.
import { formatDate, type VoucherDetail } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateInput,
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionsPanel } from '@/features/documents/actions-panel';
import { useSubmitDoc, useUploadDocAttachment } from '@/features/documents/api';
import { DocHistoryTimeline } from '@/features/documents/history-timeline';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { StepsView } from '@/features/documents/steps-view';
import { Amount, ErrorText, WarningBanner } from '@/features/grants/shared';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import {
  VOUCHER_SLUG,
  useCheckVoucher,
  usePostVoucher,
  useReverseVoucher,
  useVoucher,
} from './api';

function LinesCard({ v }: { v: VoucherDetail }) {
  const t = useTranslations('vouchers');
  const locale = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('lines')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-24">{t('account')}</TableHead>
              <TableHead>{t('accountName')}</TableHead>
              <TableHead className="w-16">{t('currency')}</TableHead>
              <TableHead className="w-28">{t('donor')}</TableHead>
              <TableHead className="w-24">{t('budgetLine')}</TableHead>
              <TableHead className="w-36 text-end">{t('debit')}</TableHead>
              <TableHead className="w-36 text-end">{t('credit')}</TableHead>
              <TableHead className="w-24 text-end">{t('rate')}</TableHead>
              <TableHead className="w-36 text-end">{t('baseDebit')}</TableHead>
              <TableHead className="w-36 text-end">{t('baseCredit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell dir="ltr">{l.lineNo}</TableCell>
                <TableCell dir="ltr">{l.accountCode}</TableCell>
                <TableCell>
                  {locale === 'ar' ? l.accountNameAr : l.accountNameEn}
                  {l.description ? (
                    <span className="block text-xs text-muted-foreground">{l.description}</span>
                  ) : null}
                  {l.categoryText ? (
                    <span className="block text-xs text-muted-foreground">{l.categoryText}</span>
                  ) : null}
                </TableCell>
                <TableCell dir="ltr">{l.currency}</TableCell>
                <TableCell>{l.donorName ?? ''}</TableCell>
                <TableCell dir="ltr">{l.budgetLineCode ?? ''}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {Number(l.debit) ? <Amount value={l.debit} currency={l.currency} /> : ''}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {Number(l.credit) ? <Amount value={l.credit} currency={l.currency} /> : ''}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {Number(l.rateToBase).toFixed(4)}
                </TableCell>
                <TableCell className="text-end">
                  {Number(l.baseDebit) ? (
                    <Amount value={l.baseDebit} currency={v.totals.baseCurrency} />
                  ) : (
                    ''
                  )}
                </TableCell>
                <TableCell className="text-end">
                  {Number(l.baseCredit) ? (
                    <Amount value={l.baseCredit} currency={v.totals.baseCurrency} />
                  ) : (
                    ''
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={9} className="font-medium">
                {t('totals')}
              </TableCell>
              <TableCell className="text-end">
                <Amount value={v.totals.baseDebit} currency={v.totals.baseCurrency} />
              </TableCell>
              <TableCell className="text-end">
                <Amount value={v.totals.baseCredit} currency={v.totals.baseCurrency} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {Number(v.totals.difference) !== 0 ? (
          <WarningBanner>{t('unbalanced', { difference: v.totals.difference })}</WarningBanner>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PostDialog({
  v,
  open,
  onOpenChange,
}: {
  v: VoucherDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('vouchers.post');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const post = usePostVoucher(v.id);
  const upload = useUploadDocAttachment(VOUCHER_SLUG, v.id);
  const [name, setName] = useState(v.receivedByName ?? '');
  const [on, setOn] = useState<string | null>(v.receivedOn);
  const [file, setFile] = useState<File | null>(null);
  const error = post.error ?? upload.error;

  async function confirm() {
    let copyId = v.receivedCopyAttachmentId ?? undefined;
    if (v.requiresReceivedBy && file) {
      const uploaded = await upload.mutateAsync({ file, purpose: 'received_by_copy' });
      copyId = uploaded.id;
    }
    post.mutate(
      {
        expectedVersion: v.version,
        ...(v.requiresReceivedBy
          ? {
              ...(name.trim() ? { receivedByName: name.trim() } : {}),
              ...(on ? { receivedOn: on } : {}),
              ...(copyId ? { receivedCopyAttachmentId: copyId } : {}),
            }
          : {}),
      },
      { onSuccess: () => onOpenChange(false) }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { date: formatDate(v.voucherDate) })}
          </DialogDescription>
        </DialogHeader>
        {v.requiresReceivedBy ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('receivedByHint')}</p>
            <div className="space-y-1">
              <Label htmlFor="post-name">{t('receivedByName')}</Label>
              <Input id="post-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="post-on">{t('receivedOn')}</Label>
              <DateInput id="post-on" value={on} onChange={setOn} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="post-copy">{t('signedCopy')}</Label>
              <Input
                id="post-copy"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        ) : null}
        {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button disabled={post.isPending || upload.isPending} onClick={() => void confirm()}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({
  v,
  open,
  onOpenChange,
}: {
  v: VoucherDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('vouchers.reverse');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const reverse = useReverseVoucher(v.id);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rev-date">{t('date')}</Label>
            <DateInput id="rev-date" value={date} onChange={setDate} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rev-reason">{t('reason')}</Label>
            <Textarea
              id="rev-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        {reverse.error ? <ErrorText>{apiError(reverse.error)}</ErrorText> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={reverse.isPending || !date || !reason.trim()}
            onClick={() =>
              reverse.mutate(
                { expectedVersion: v.version, reason: reason.trim(), reversalDate: date! },
                {
                  onSuccess: (created) => {
                    onOpenChange(false);
                    router.push(`/finance/vouchers/${created.id}`);
                  },
                }
              )
            }
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoucherActions({ v }: { v: VoucherDetail }) {
  const t = useTranslations('vouchers');
  const apiError = useApiError();
  const submit = useSubmitDoc(VOUCHER_SLUG, v.id);
  const check = useCheckVoucher(v.id);
  const [posting, setPosting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const step = v.steps.find((s) => s.status === 'pending');
  const can = (a: string) => v.availableActions.includes(a);
  return (
    <>
      {can('submit') ? (
        <Button disabled={submit.isPending} onClick={() => submit.mutate(v.version)}>
          {t('submit')}
        </Button>
      ) : null}
      {can('check') && step ? (
        <Button
          disabled={check.isPending}
          onClick={() => check.mutate({ expectedVersion: v.version, stepId: step.id })}
        >
          {t('check')}
        </Button>
      ) : null}
      {can('post') ? <Button onClick={() => setPosting(true)}>{t('postAction')}</Button> : null}
      {can('reverse') ? (
        <Button variant="outline" onClick={() => setReversing(true)}>
          {t('reverseAction')}
        </Button>
      ) : null}
      {submit.error ? <ErrorText>{apiError(submit.error)}</ErrorText> : null}
      {check.error ? <ErrorText>{apiError(check.error)}</ErrorText> : null}
      <PostDialog key={`post-${v.version}`} v={v} open={posting} onOpenChange={setPosting} />
      <ReverseDialog key={`rev-${v.version}`} v={v} open={reversing} onOpenChange={setReversing} />
    </>
  );
}

export function VoucherDetailView({ id }: { id: string }) {
  const t = useTranslations('vouchers');
  const tc = useTranslations('common');
  const locale = useLocale();
  const apiError = useApiError();
  const { data: v, error, isPending } = useVoucher(id);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !v) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  // the check is signed with its own button; the generic panel keeps return, reject, cancel
  const panelDoc = {
    ...v,
    availableActions: v.availableActions.filter(
      (a) => !(a === 'approve' && v.availableActions.includes('check'))
    ),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {v.number ?? `${v.type} · ${t('draftNumber')}`}
            </h1>
            <DocStatusBadge status={v.status} namespace="vouchers.status" />
            <span className="text-sm text-muted-foreground">{t(`type.${v.type}`)}</span>
          </div>
          <p className="text-muted-foreground">
            <span dir="ltr">{formatDate(v.voucherDate)}</span>
            {v.payeeName ? ` · ${v.payeeName}` : ''}
            {v.moneyAccountName ? ` · ${v.moneyAccountName}` : ''}
            {v.chequeNo ? ` · ${t('chequeNo', { no: v.chequeNo })}` : ''}
            {v.paymentRequestId ? (
              <>
                {' · '}
                <Link
                  href={`/finance/payment-requests/${v.paymentRequestId}`}
                  className="hover:underline"
                >
                  {t('paymentRequest')}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionsPanel slug={VOUCHER_SLUG} doc={panelDoc}>
            <VoucherActions v={v} />
          </ActionsPanel>
        </div>
      </div>

      {v.reversalOfId ? (
        <WarningBanner>
          {t('reversalOf')}{' '}
          <Link href={`/finance/vouchers/${v.reversalOfId}`} className="underline">
            {t('original')}
          </Link>
          {v.reason ? ` — ${v.reason}` : ''}
        </WarningBanner>
      ) : null}
      {v.reversedById ? (
        <WarningBanner>
          {t('reversedBy')}{' '}
          <Link href={`/finance/vouchers/${v.reversedById}`} className="underline">
            {t('reversal')}
          </Link>
        </WarningBanner>
      ) : null}

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">{t('amount')}</p>
            <Amount value={v.amount} currency={v.currency} />
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm text-muted-foreground">{t('inWords')}</p>
            <p>{locale === 'ar' ? v.amountInWordsAr : v.amountInWordsEn}</p>
          </div>
          {v.status === 'posted' && v.receivedByName ? (
            <div className="sm:col-span-3 text-sm text-muted-foreground">
              {t('receivedBy', {
                name: v.receivedByName,
                date: v.receivedOn ? formatDate(v.receivedOn) : '',
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <LinesCard v={v} />
      {v.steps.length > 0 ? (
        <StepsView
          cycle={Math.max(...v.steps.map((s) => s.cycle))}
          steps={v.steps}
          signatures={[]}
        />
      ) : null}
      <DocHistoryTimeline slug={VOUCHER_SLUG} id={v.id} />
    </div>
  );
}
