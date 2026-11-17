'use client';

// GRN page (002 US7): the inherited PO and supplier, the lines with rejected quantities and
// returns, the two signatures (Received By, Inspected By — two different people), cancelling a
// draft, and the supplier rating once the PO is fully received.
import { formatDate, type GrnDetail } from '@ngo/shared';
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
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { HistoryTimeline } from '@/features/documents/history-timeline';
import { ReasonDialog } from '@/features/documents/reason-dialog';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { usePurchaseOrder } from '@/features/orders/api';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useQuery } from '@tanstack/react-query';
import type { DocHistoryEntry } from '@ngo/shared';
import { useCancelGrn, useGrn, useRatePo, useReturnGrnLine, useSignGrn } from './api';

const SCORES = [1, 2, 3, 4, 5] as const;

function RatingDialog({ poId }: { poId: string }) {
  const t = useTranslations('receiving.rating');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const { data: po } = usePurchaseOrder(poId);
  const rate = useRatePo(poId);
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState({ onTime: 0, quality: 0, documentation: 0 });
  const [comment, setComment] = useState('');
  if (!po?.availableActions.includes('rate')) return null;
  const complete = scores.onTime > 0 && scores.quality > 0 && scores.documentation > 0;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(['onTime', 'quality', 'documentation'] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label>{t(key)}</Label>
                <div className="flex gap-2">
                  {SCORES.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={scores[key] === s ? 'default' : 'outline'}
                      aria-pressed={scores[key] === s}
                      onClick={() => setScores((cur) => ({ ...cur, [key]: s }))}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="rating-comment">{t('comment')}</Label>
              <Textarea
                id="rating-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
            {rate.error ? <ErrorText>{apiError(rate.error)}</ErrorText> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={!complete || rate.isPending}
              onClick={() =>
                rate.mutate(
                  { ...scores, ...(comment.trim() ? { comment: comment.trim() } : {}) },
                  { onSuccess: () => setOpen(false) }
                )
              }
            >
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LinesCard({ grn }: { grn: GrnDetail }) {
  const t = useTranslations('receiving.lines');
  const apiError = useApiError();
  const ret = useReturnGrnLine(grn.id);
  const [dates, setDates] = useState<Record<string, string | null>>({});
  const canReturn = grn.availableActions.includes('return');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead className="w-24 text-end">{t('ordered')}</TableHead>
                <TableHead className="w-24 text-end">{t('delivered')}</TableHead>
                <TableHead className="w-24 text-end">{t('accepted')}</TableHead>
                <TableHead className="w-24 text-end">{t('rejected')}</TableHead>
                <TableHead>{t('rejectReason')}</TableHead>
                <TableHead className="w-16">{t('asset')}</TableHead>
                <TableHead className="w-56">{t('returned')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.lineNo}</TableCell>
                  <TableCell>
                    {l.description}
                    {l.conditionRemarks ? (
                      <p className="text-xs text-muted-foreground">{l.conditionRemarks}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.orderedQty}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.deliveredQty}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.acceptedQty}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.rejectedQty}
                  </TableCell>
                  <TableCell>{l.rejectReason ?? '—'}</TableCell>
                  <TableCell>{l.isAsset ? t('yes') : '—'}</TableCell>
                  <TableCell>
                    {l.returnedOn ? (
                      <span dir="ltr">{formatDate(l.returnedOn)}</span>
                    ) : canReturn && Number(l.rejectedQty) > 0 ? (
                      <div className="flex items-center gap-2">
                        <DateInput
                          aria-label={t('returnedOn')}
                          value={dates[l.id] ?? null}
                          onChange={(d) => setDates((cur) => ({ ...cur, [l.id]: d }))}
                        />
                        <Button
                          size="sm"
                          disabled={!dates[l.id] || ret.isPending}
                          onClick={() => ret.mutate({ lineId: l.id, returnedOn: dates[l.id]! })}
                        >
                          {t('recordReturn')}
                        </Button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {ret.error ? <ErrorText>{apiError(ret.error)}</ErrorText> : null}
      </CardContent>
    </Card>
  );
}

function SignaturesCard({ grn }: { grn: GrnDetail }) {
  const t = useTranslations('receiving.signatures');
  const apiError = useApiError();
  const sign = useSignGrn(grn.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('twoPeople')}</p>
        {(['received', 'inspected'] as const).map((role) => {
          const s = grn.signatures.find((x) => x.role === role);
          return (
            <div key={role} className="flex flex-wrap items-center gap-3">
              <span className="w-40 font-medium">{t(role)}</span>
              {s ? (
                <span>
                  {s.userName} ·{' '}
                  <span dir="ltr">{formatDate(s.actedAt.slice(0, 10))}</span>
                </span>
              ) : grn.availableActions.includes(`sign_${role}`) ? (
                <Button
                  size="sm"
                  disabled={sign.isPending}
                  onClick={() => sign.mutate({ expectedVersion: grn.version, role })}
                >
                  {t(`sign_${role}`)}
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">{t('pending')}</span>
              )}
            </div>
          );
        })}
        {sign.error ? <ErrorText>{apiError(sign.error)}</ErrorText> : null}
      </CardContent>
    </Card>
  );
}

function GrnHistory({ id }: { id: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['docs', 'grns', 'detail', id, 'history'],
    queryFn: async () => (await api.get<{ data: DocHistoryEntry[] }>(`/grns/${id}/history`)).data,
  });
  return (
    <HistoryTimeline
      data={data}
      error={error}
      isPending={isPending}
      renderState={(status) => <DocStatusBadge status={status} namespace="receiving.status" />}
    />
  );
}

export function GrnDetailView({ id }: { id: string }) {
  const t = useTranslations('receiving');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const { data: grn, error, isPending } = useGrn(id);
  const cancel = useCancelGrn(id);
  const [cancelling, setCancelling] = useState(false);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !grn) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {grn.number}
            </h1>
            <DocStatusBadge status={grn.status} namespace="receiving.status" />
          </div>
          <p className="text-muted-foreground">
            <Link href={`/procurement/pos/${grn.poId}`} className="hover:underline" dir="ltr">
              {grn.poNumber}
            </Link>{' '}
            · {localized({ nameAr: grn.supplierNameAr, nameEn: grn.supplierNameEn })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('receivedDate')}: <span dir="ltr">{formatDate(grn.receivedDate)}</span> ·{' '}
            {t('create.deliveryNoteNo')}: <span dir="ltr">{grn.deliveryNoteNo}</span> ·{' '}
            {t(`create.shipment.${grn.shipmentType}`)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {grn.status === 'completed' ? <RatingDialog poId={grn.poId} /> : null}
          {grn.availableActions.includes('cancel') ? (
            <Button variant="outline" onClick={() => setCancelling(true)}>
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      </div>
      {grn.cancelReason ? (
        <p className="text-sm text-muted-foreground">
          {t('cancelledWith', { reason: grn.cancelReason })}
        </p>
      ) : null}

      <LinesCard grn={grn} />
      <SignaturesCard grn={grn} />
      <GrnHistory id={grn.id} />

      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        confirmLabel={t('cancel')}
        destructive
        busy={cancel.isPending}
        error={cancel.error ? apiError(cancel.error) : null}
        onConfirm={(reason) =>
          cancel.mutate(
            { expectedVersion: grn.version, reason },
            { onSuccess: () => setCancelling(false) }
          )
        }
      />
    </div>
  );
}
