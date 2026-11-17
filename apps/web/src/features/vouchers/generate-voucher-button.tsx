'use client';

// "Generate voucher" on an approved payment request (002 US13): the voucher date and, for a
// cheque, its number; the lines come from the generator.
import {
  Button,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ErrorText } from '@/features/grants/shared';
import { useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useGenerateVoucher } from './api';

export function GenerateVoucherButton({
  paymentRequestId,
  cheque,
}: {
  paymentRequestId: string;
  cheque: boolean;
}) {
  const t = useTranslations('vouchers.generate');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const router = useRouter();
  const generate = useGenerateVoucher(paymentRequestId);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [chequeNo, setChequeNo] = useState('');

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('action')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="gen-date">{t('date')}</Label>
              <DateInput id="gen-date" value={date} onChange={setDate} />
            </div>
            {cheque ? (
              <div className="space-y-1">
                <Label htmlFor="gen-cheque">{t('chequeNo')}</Label>
                <Input
                  id="gen-cheque"
                  dir="ltr"
                  value={chequeNo}
                  onChange={(e) => setChequeNo(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          {generate.error ? <ErrorText>{apiError(generate.error)}</ErrorText> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={generate.isPending || (cheque && !chequeNo.trim())}
              onClick={() =>
                generate.mutate(
                  {
                    ...(date ? { voucherDate: date } : {}),
                    ...(cheque ? { chequeNo: chequeNo.trim() } : {}),
                  },
                  { onSuccess: (v) => router.push(`/finance/vouchers/${v.id}`) }
                )
              }
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
