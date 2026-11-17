'use client';

// Build a payment request from an order (002 US11): pick the kind (against an invoice, an advance
// or the retention release), the invoice and the GRNs it is matched against, the payment method
// and a bank or cash account in the payment currency. Every amount is computed by the API and
// shown on the request page that follows; nothing here is an amount field.
import { PAYMENT_METHODS, type PaymentMethod } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { usePurchaseOrder } from '@/features/orders/api';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useCreatePaymentRequest, useInvoices, useMoneyAccounts } from './api';

type Kind = 'invoice' | 'advance' | 'retention';

export function PaymentRequestCreate({ poId, invoiceId }: { poId: string; invoiceId?: string }) {
  const t = useTranslations('payments.create');
  const tp = useTranslations('payments');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const router = useRouter();
  const { data: po, error, isPending } = usePurchaseOrder(poId);
  const invoices = useInvoices({ page: 1, poId, status: 'registered' });
  const create = useCreatePaymentRequest(poId);
  const [kind, setKind] = useState<Kind>('invoice');
  const [invoice, setInvoice] = useState<string | undefined>(invoiceId);
  const [grnIds, setGrnIds] = useState<string[] | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [currency, setCurrency] = useState<string | undefined>();
  const [account, setAccount] = useState<string | undefined>();
  const accounts = useMoneyAccounts(currency ?? po?.currency);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !po) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const payCurrency = currency ?? po.currency;
  const completed = po.grns.filter((g) => g.status === 'completed');
  const chosenGrns = grnIds ?? completed.map((g) => g.id);
  const toggleGrn = (id: string, on: boolean) =>
    setGrnIds(on ? [...new Set([...chosenGrns, id])] : chosenGrns.filter((g) => g !== id));
  const service = po.kind === 'contract' || po.isService;
  const ready = !!account && (kind !== 'invoice' || !!invoice);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">
          <span dir="ltr">{po.number}</span> ·{' '}
          {localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })}
        </p>
        <p className="text-sm text-muted-foreground">{t('computed')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('what')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pay-kind">{tp('kindLabel')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger id="pay-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">{tp('kind.order')}</SelectItem>
                {Number(po.advancePct) > 0 ? (
                  <SelectItem value="advance">{tp('kind.advance')}</SelectItem>
                ) : null}
                {Number(po.retentionPct) > 0 ? (
                  <SelectItem value="retention">{tp('kind.retention')}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          {kind === 'invoice' ? (
            <div className="space-y-1">
              <Label htmlFor="pay-invoice">{t('invoice')}</Label>
              <Select value={invoice} onValueChange={setInvoice}>
                <SelectTrigger id="pay-invoice">
                  <SelectValue placeholder={t('chooseInvoice')} />
                </SelectTrigger>
                <SelectContent>
                  {(invoices.data?.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.number} · {i.supplierInvoiceNo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {kind === 'invoice' && !service ? (
            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">{t('grns')}</p>
              {completed.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noGrns')}</p>
              ) : (
                completed.map((g) => (
                  <div key={g.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`grn-${g.id}`}
                      checked={chosenGrns.includes(g.id)}
                      onCheckedChange={(v) => toggleGrn(g.id, v === true)}
                    />
                    <Label htmlFor={`grn-${g.id}`} dir="ltr">
                      {g.number}
                    </Label>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('how')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="pay-method">{tp('paymentMethod')}</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="pay-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tp(`method.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-currency">{tp('currency')}</Label>
            <Select
              value={payCurrency}
              onValueChange={(v) => {
                setCurrency(v);
                setAccount(undefined);
              }}
            >
              <SelectTrigger id="pay-currency" dir="ltr">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([po.currency, po.grantCurrency])].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-account">{tp('moneyAccount')}</Label>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger id="pay-account">
                <SelectValue placeholder={t('chooseAccount')} />
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accounts.data && accounts.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('noAccount', { currency: payCurrency })}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {create.error ? <ErrorText>{apiError(create.error)}</ErrorText> : null}
      <div className="flex gap-2">
        <Button
          disabled={!ready || create.isPending}
          onClick={() =>
            create.mutate(
              {
                kind: kind === 'retention' ? 'retention' : 'order',
                isAdvance: kind === 'advance',
                ...(kind === 'invoice' ? { invoiceId: invoice } : {}),
                ...(kind === 'invoice' && !service && grnIds ? { grnIds } : {}),
                paymentMethod: method,
                moneyAccountId: account!,
                currency: payCurrency,
              },
              { onSuccess: (r) => router.push(`/finance/payment-requests/${r.id}`) }
            )
          }
        >
          {t('submit')}
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}
