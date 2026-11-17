'use client';

// Payment request page (002 US11): the payee and bank details copied from the supplier, the
// computed amounts and the amount in words (read-only), the three-way match per line with the
// override dialog, the deductions, the charge-to table, the payment method and account while
// draft, submission and the approval steps, and the history.
import { PAYMENT_METHODS, type PaymentMethod, type PaymentRequestDetail } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
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
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ActionsPanel } from '@/features/documents/actions-panel';
import { useSubmitDoc } from '@/features/documents/api';
import { DocHistoryTimeline } from '@/features/documents/history-timeline';
import { ReasonDialog } from '@/features/documents/reason-dialog';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { GenerateVoucherButton } from '@/features/vouchers/generate-voucher-button';
import { StepsView } from '@/features/documents/steps-view';
import { Amount, ErrorText, WarningBanner, useLocalizedName } from '@/features/grants/shared';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import {
  PAYMENT_SLUG,
  useMoneyAccounts,
  useOverrideMatch,
  usePatchPaymentRequest,
  usePaymentRequest,
} from './api';

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}

function AmountsCard({ r }: { r: PaymentRequestDetail }) {
  const t = useTranslations('payments');
  const locale = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('amounts')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-5">
          <Figure label={t('gross')}>
            <Amount value={r.gross} currency={r.currency} />
          </Figure>
          <Figure label={t('advanceDeduction')}>
            <Amount value={r.advanceDeduction} currency={r.currency} />
          </Figure>
          <Figure label={t('retention')}>
            <Amount value={r.retentionAmount} currency={r.currency} />
          </Figure>
          <Figure label={t('deductions')}>
            <Amount value={r.deductionsTotal} currency={r.currency} />
          </Figure>
          <Figure label={t('net')}>
            <Amount value={r.net} currency={r.currency} />
          </Figure>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">{t('inWords')}: </span>
          {locale === 'ar' ? r.amountInWordsAr : r.amountInWordsEn}
        </p>
        {r.poCurrency && r.poCurrency !== r.currency ? (
          <p className="text-xs text-muted-foreground" dir="ltr">
            {t('converted', { from: r.poCurrency, to: r.currency, date: r.rateDate ?? '' })}
          </p>
        ) : null}
        {r.deductions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('deduction')}</TableHead>
                <TableHead className="w-40 text-end">{t('base')}</TableHead>
                <TableHead className="w-24 text-end">{t('rate')}</TableHead>
                <TableHead className="w-40 text-end">{t('amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.deductions.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{locale === 'ar' ? d.nameAr : d.nameEn}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={d.base} currency={r.currency} />
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {d.ratePct}%
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={d.amount} currency={r.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MatchCard({ r }: { r: PaymentRequestDetail }) {
  const t = useTranslations('payments');
  const apiError = useApiError();
  const override = useOverrideMatch(r.id);
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('lines')}</CardTitle>
        <div className="flex items-center gap-2">
          <DocStatusBadge status={r.matchStatus} namespace="payments.match" />
          {r.availableActions.includes('override_match') ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              {t('overrideMatch')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 overflow-x-auto">
        {r.matchStatus === 'mismatch' ? <WarningBanner>{t('mismatchBanner')}</WarningBanner> : null}
        {r.override ? (
          <p className="text-sm text-muted-foreground">
            {t('overriddenBy', { name: r.override.userName, reason: r.override.reason })}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>{t('description')}</TableHead>
              <TableHead className="w-24">{t('budgetLine')}</TableHead>
              <TableHead className="w-24 text-end">{t('invoicedQty')}</TableHead>
              <TableHead className="w-24 text-end">{t('acceptedQty')}</TableHead>
              <TableHead className="w-32 text-end">{t('invoicedPrice')}</TableHead>
              <TableHead className="w-32 text-end">{t('poPrice')}</TableHead>
              <TableHead className="w-36 text-end">{t('gross')}</TableHead>
              <TableHead className="w-32">{t('matchLabel')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell dir="ltr">{l.lineNo}</TableCell>
                <TableCell>{l.description}</TableCell>
                <TableCell dir="ltr">{l.budgetLineCode}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {l.invoicedQty ?? '—'}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {l.acceptedQty ?? '—'}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {l.unitPrice ?? '—'}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {l.poPrice ?? '—'}
                </TableCell>
                <TableCell className="text-end">
                  <Amount value={l.gross} currency={r.currency} />
                </TableCell>
                <TableCell>
                  {l.matchResult ? (
                    <DocStatusBadge status={l.matchResult} namespace="payments.lineMatch" />
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={t('overrideTitle')}
        description={t('overrideDescription')}
        confirmLabel={t('overrideMatch')}
        busy={override.isPending}
        error={override.error ? apiError(override.error) : null}
        onConfirm={(reason) =>
          override.mutate(
            { expectedVersion: r.version, reason },
            { onSuccess: () => setOpen(false) }
          )
        }
      />
    </Card>
  );
}

function ChargeToCard({ r }: { r: PaymentRequestDetail }) {
  const t = useTranslations('payments');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('chargeTo')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('budgetLine')}</TableHead>
              <TableHead className="w-44 text-end">{t('gross')}</TableHead>
              <TableHead className="w-44 text-end">{t('inGrantCurrency')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.chargeTo.map((c) => (
              <TableRow key={`${c.budgetLineId}-${c.locationOfficeId}-${c.activityId}`}>
                <TableCell dir="ltr">{c.budgetLineCode}</TableCell>
                <TableCell className="text-end">
                  <Amount value={c.gross} currency={r.currency} />
                </TableCell>
                <TableCell className="text-end">
                  {c.amountGrant ? (
                    <Amount value={c.amountGrant} currency={r.grantCurrency} />
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PaymentCard({ r }: { r: PaymentRequestDetail }) {
  const t = useTranslations('payments');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const editable = r.availableActions.includes('edit');
  const accounts = useMoneyAccounts(r.currency);
  const patch = usePatchPaymentRequest(r.id);
  const [method, setMethod] = useState<PaymentMethod>(r.paymentMethod);
  const [account, setAccount] = useState(r.moneyAccountId);
  const changed = method !== r.paymentMethod || account !== r.moneyAccountId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('payment')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure label={t('payee')}>
            {localized({ nameAr: r.payeeNameAr, nameEn: r.payeeNameEn })}
          </Figure>
          <Figure label={t('bank')}>
            <span dir="ltr">
              {[r.payeeBankName, r.payeeBankBranch, r.payeeAccountName, r.payeeAccountNo]
                .filter(Boolean)
                .join(' · ') || '—'}
            </span>
          </Figure>
          <Figure label={t('grant')}>
            <span dir="ltr">{r.grantCode}</span>
          </Figure>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pr-method">{t('paymentMethod')}</Label>
            {editable ? (
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="pr-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`method.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p>{t(`method.${r.paymentMethod}`)}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="pr-account">{t('moneyAccount')}</Label>
            {editable ? (
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger id="pr-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p>
                {r.moneyAccountName} · <span dir="ltr">{r.currency}</span>
              </p>
            )}
          </div>
        </div>
        {editable && changed ? (
          <Button
            size="sm"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate({
                expectedVersion: r.version,
                paymentMethod: method,
                moneyAccountId: account,
              })
            }
          >
            {tc('save')}
          </Button>
        ) : null}
        {patch.error ? <ErrorText>{apiError(patch.error)}</ErrorText> : null}
      </CardContent>
    </Card>
  );
}

export function PaymentRequestDetailView({ id }: { id: string }) {
  const t = useTranslations('payments');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const { data: r, error, isPending } = usePaymentRequest(id);
  const submit = useSubmitDoc(PAYMENT_SLUG, id);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !r) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {r.number ?? t('draftNumber')}
            </h1>
            <DocStatusBadge status={r.status} namespace="payments.status" />
            <span className="text-sm text-muted-foreground">
              {t(`kind.${r.isAdvance ? 'advance' : r.kind}`)}
            </span>
          </div>
          <p className="text-muted-foreground">
            {localized({ nameAr: r.payeeNameAr, nameEn: r.payeeNameEn })}
            {r.poId ? (
              <>
                {' · '}
                <Link href={`/procurement/pos/${r.poId}`} className="hover:underline" dir="ltr">
                  {r.poNumber}
                </Link>
              </>
            ) : null}
            {r.invoiceId ? (
              <>
                {' · '}
                <Link
                  href={`/finance/invoices/${r.invoiceId}`}
                  className="hover:underline"
                  dir="ltr"
                >
                  {r.invoiceNumber}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionsPanel slug={PAYMENT_SLUG} doc={r}>
            {r.availableActions.includes('submit') ? (
              <Button disabled={submit.isPending} onClick={() => submit.mutate(r.version)}>
                {t('submit')}
              </Button>
            ) : null}
            {r.availableActions.includes('generate_voucher') && !r.voucher ? (
              <GenerateVoucherButton
                paymentRequestId={r.id}
                cheque={r.paymentMethod === 'cheque'}
              />
            ) : null}
            {r.voucher ? (
              <Button asChild variant="outline">
                <Link href={`/finance/vouchers/${r.voucher.id}`}>
                  {r.voucher.number ?? t('voucher')}
                </Link>
              </Button>
            ) : null}
          </ActionsPanel>
        </div>
      </div>
      {submit.error ? <ErrorText>{apiError(submit.error)}</ErrorText> : null}
      {r.returnReason ? (
        <WarningBanner>{t('returnedWith', { reason: r.returnReason })}</WarningBanner>
      ) : null}

      <AmountsCard r={r} />
      <MatchCard r={r} />
      <ChargeToCard r={r} />
      <PaymentCard key={r.version} r={r} />
      {r.steps.length > 0 ? (
        <StepsView
          cycle={Math.max(...r.steps.map((s) => s.cycle))}
          steps={r.steps}
          signatures={[]}
        />
      ) : null}
      <DocHistoryTimeline slug={PAYMENT_SLUG} id={r.id} />
    </div>
  );
}
