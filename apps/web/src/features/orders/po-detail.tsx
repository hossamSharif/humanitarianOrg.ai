'use client';

// Purchase order page (002 US6): the inherited supplier and lines (read-only), the terms while
// draft, submission and the approval steps (shared document actions), the budget effect of the
// conversion, the supplier's acknowledgement, the receipts, manual close and the history.
import { formatDate, type PoPatchInput, type PurchaseOrderDetail } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DateInput,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionsPanel } from '@/features/documents/actions-panel';
import { useDocAttachments, useSubmitDoc } from '@/features/documents/api';
import { AttachmentsPanel } from '@/features/documents/attachments-panel';
import { DocHistoryTimeline } from '@/features/documents/history-timeline';
import { ReasonDialog } from '@/features/documents/reason-dialog';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { StepsView } from '@/features/documents/steps-view';
import { Amount, ErrorText, WarningBanner, useLocalizedName } from '@/features/grants/shared';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { poSlug, useAcknowledgePo, useClosePo, usePatchPo, usePurchaseOrder } from './api';

type TermsDraft = Required<Omit<PoPatchInput, 'expectedVersion' | 'scopeText' | 'startDate' | 'endDate'>>;

function termsOf(po: PurchaseOrderDetail): TermsDraft {
  return {
    poDate: po.poDate,
    deliveryAddress: po.deliveryAddress,
    deliverySchedule: po.deliverySchedule,
    deliveryTerms: po.deliveryTerms,
    paymentTermsText: po.paymentTermsText,
    specialConditions: po.specialConditions,
    advancePct: po.advancePct,
    retentionPct: po.retentionPct,
    retentionReleaseDate: po.retentionReleaseDate,
    isService: po.isService,
  };
}

const TEXT_FIELDS = [
  'deliveryAddress',
  'deliverySchedule',
  'deliveryTerms',
  'paymentTermsText',
  'specialConditions',
] as const;

function TermsCard({ po }: { po: PurchaseOrderDetail }) {
  const t = useTranslations('orders.terms');
  const apiError = useApiError();
  const editable = po.availableActions.includes('edit');
  const patch = usePatchPo(po.id);
  const [draft, setDraft] = useState<TermsDraft>(() => termsOf(po));
  const set = <K extends keyof TermsDraft>(key: K, value: TermsDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="po-date">{t('poDate')}</Label>
            {editable ? (
              <DateInput id="po-date" value={draft.poDate} onChange={(v) => set('poDate', v)} />
            ) : (
              <p dir="ltr">{po.poDate ? formatDate(po.poDate) : '—'}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="po-advance">{t('advancePct')}</Label>
            {editable ? (
              <Input
                id="po-advance"
                dir="ltr"
                inputMode="decimal"
                value={draft.advancePct}
                onChange={(e) => set('advancePct', e.target.value)}
              />
            ) : (
              <p dir="ltr">{po.advancePct}%</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="po-retention">{t('retentionPct')}</Label>
            {editable ? (
              <Input
                id="po-retention"
                dir="ltr"
                inputMode="decimal"
                value={draft.retentionPct}
                onChange={(e) => set('retentionPct', e.target.value)}
              />
            ) : (
              <p dir="ltr">{po.retentionPct}%</p>
            )}
          </div>
        </div>
        {TEXT_FIELDS.map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`po-${field}`}>{t(field)}</Label>
            {editable ? (
              <Textarea
                id={`po-${field}`}
                rows={2}
                value={draft[field] ?? ''}
                onChange={(e) => set(field, e.target.value || null)}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm">{po[field] ?? '—'}</p>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Checkbox
            id="po-service"
            checked={draft.isService}
            disabled={!editable}
            onCheckedChange={(v) => set('isService', v === true)}
          />
          <Label htmlFor="po-service">{t('isService')}</Label>
        </div>
        {editable ? (
          <Button
            disabled={patch.isPending}
            onClick={() => patch.mutate({ expectedVersion: po.version, ...draft })}
          >
            {t('save')}
          </Button>
        ) : null}
        {patch.error ? <ErrorText>{apiError(patch.error)}</ErrorText> : null}
      </CardContent>
    </Card>
  );
}

function LinesCard({ po }: { po: PurchaseOrderDetail }) {
  const t = useTranslations('orders.lines');
  const locale = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('inherited')}</p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead className="w-28 text-end">{t('quantity')}</TableHead>
                <TableHead className="w-24">{t('unit')}</TableHead>
                <TableHead className="w-36 text-end">{t('unitPrice')}</TableHead>
                <TableHead className="w-40 text-end">{t('lineTotal')}</TableHead>
                <TableHead className="w-28">{t('budgetLine')}</TableHead>
                <TableHead className="w-28 text-end">{t('accepted')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.lineNo}</TableCell>
                  <TableCell>
                    {l.description}
                    {l.prNumber ? (
                      <span dir="ltr" className="ms-2 text-xs text-muted-foreground">
                        {l.prNumber}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.quantity}
                  </TableCell>
                  <TableCell>{locale === 'ar' ? l.unitNameAr : l.unitNameEn}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={l.unitPrice} currency={po.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={l.lineTotal} currency={po.currency} />
                  </TableCell>
                  <TableCell dir="ltr">{l.budgetLineCode}</TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {l.acceptedQty}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-1 text-end">
          <p className="font-semibold">
            {t('total')}: <Amount value={po.totalWithAmendments} currency={po.currency} />
          </p>
          <p className="text-sm text-muted-foreground">
            {locale === 'ar' ? po.totalInWordsAr : po.totalInWordsEn}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetEffectCard({ po }: { po: PurchaseOrderDetail }) {
  const t = useTranslations('orders.budget');
  if (po.budgetEffect.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {po.commitRateToBase ? t('locked') : t('estimate')}
        </p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('budgetLine')}</TableHead>
                <TableHead className="text-end">{t('prCommitted')}</TableHead>
                <TableHead className="text-end">{t('poAmount')}</TableHead>
                <TableHead className="text-end">{t('difference')}</TableHead>
                <TableHead className="text-end">{t('available')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.budgetEffect.map((b) => (
                <TableRow key={b.budgetLineId}>
                  <TableCell dir="ltr">{b.code}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={b.prCommitted} currency={b.currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={b.poAmount} currency={b.currency} />
                  </TableCell>
                  <TableCell className="text-end" dir="ltr">
                    {b.difference}
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={b.available} currency={b.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function AcknowledgementCard({ po }: { po: PurchaseOrderDetail }) {
  const t = useTranslations('orders.acknowledgement');
  const apiError = useApiError();
  const slug = poSlug(po);
  const acknowledge = useAcknowledgePo(po.id);
  const { data: attachments = [] } = useDocAttachments(slug, po.id);
  const [date, setDate] = useState<string | null>(null);
  const [name, setName] = useState('');
  const can = po.availableActions.includes('acknowledge');
  if (!can && !po.acknowledgedAt) return null;
  const signed = attachments.filter((a) => a.purpose === 'po_acknowledgement' && a.uploadedAt);
  const latest = signed[signed.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {po.acknowledgedAt ? (
          <p>
            {t('done', { name: po.acknowledgedByName ?? '', date: formatDate(po.acknowledgedAt) })}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {po.requireAcknowledgement ? t('required') : t('optional')}
            </p>
            <AttachmentsPanel
              slug={slug}
              docId={po.id}
              editable={can}
              purpose="po_acknowledgement"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ack-date">{t('date')}</Label>
                <DateInput id="ack-date" value={date} onChange={setDate} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ack-name">{t('name')}</Label>
                <Input id="ack-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <Button
              disabled={!date || !name.trim() || !latest || acknowledge.isPending}
              onClick={() =>
                acknowledge.mutate({
                  expectedVersion: po.version,
                  acknowledgedAt: date!,
                  acknowledgedByName: name.trim(),
                  attachmentId: latest!.id,
                })
              }
            >
              {t('record')}
            </Button>
            {acknowledge.error ? <ErrorText>{apiError(acknowledge.error)}</ErrorText> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiptsCard({ po }: { po: PurchaseOrderDetail }) {
  const t = useTranslations('orders.receipts');
  const tr = useTranslations('orders');
  if (po.grns.length === 0 && !po.availableActions.includes('receive')) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        {po.availableActions.includes('receive') ? (
          <Button asChild size="sm">
            <Link href={`/procurement/receiving/new?po=${po.id}`}>{tr('actions.receive')}</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {po.grns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          po.grns.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-3">
              <Link href={`/procurement/receiving/${g.id}`} className="hover:underline" dir="ltr">
                {g.number}
              </Link>
              <DocStatusBadge status={g.status} />
              <span className="text-sm text-muted-foreground" dir="ltr">
                {formatDate(g.receivedDate)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PoActions({ po }: { po: PurchaseOrderDetail }) {
  const t = useTranslations('orders.actions');
  const apiError = useApiError();
  const slug = poSlug(po);
  const submit = useSubmitDoc(slug, po.id);
  const close = useClosePo(po.id);
  const [closing, setClosing] = useState(false);
  return (
    <>
      {po.availableActions.includes('submit') ? (
        <Button disabled={submit.isPending} onClick={() => submit.mutate(po.version)}>
          {t('submit')}
        </Button>
      ) : null}
      {po.availableActions.includes('close') ? (
        <Button variant="outline" onClick={() => setClosing(true)}>
          {t('close')}
        </Button>
      ) : null}
      {submit.error ? <ErrorText>{apiError(submit.error)}</ErrorText> : null}
      <ReasonDialog
        open={closing}
        onOpenChange={setClosing}
        title={t('closeTitle')}
        description={t('closeDescription')}
        confirmLabel={t('close')}
        destructive
        busy={close.isPending}
        error={close.error ? apiError(close.error) : null}
        onConfirm={(reason) =>
          close.mutate(
            { expectedVersion: po.version, reason },
            { onSuccess: () => setClosing(false) }
          )
        }
      />
    </>
  );
}

export function PoDetail({ id }: { id: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const { data: po, error, isPending } = usePurchaseOrder(id);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !po) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {po.number ?? t('draftNumber')}
            </h1>
            <DocStatusBadge status={po.status} namespace="orders.status" />
            <span className="text-sm text-muted-foreground">
              {t(`kind.${po.isService ? 'service' : po.kind}`)}
            </span>
          </div>
          <p className="text-muted-foreground">
            {localized({ nameAr: po.supplierNameAr, nameEn: po.supplierNameEn })}
            {po.bidAnalysisId ? (
              <>
                {' · '}
                <Link
                  href={`/procurement/analyses/${po.bidAnalysisId}`}
                  className="hover:underline"
                  dir="ltr"
                >
                  {po.analysisNumber}
                </Link>
              </>
            ) : null}
            {' · '}
            <span dir="ltr">{po.grantCode}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionsPanel
            slug={poSlug(po)}
            doc={{
              ...po,
              currentStepOrder: po.steps.find((s) => s.status === 'pending')?.stepOrder ?? null,
            }}
          >
            <PoActions po={po} />
          </ActionsPanel>
        </div>
      </div>

      {po.blacklistFlag ? <WarningBanner>{t('blacklisted')}</WarningBanner> : null}
      {po.closeReason ? (
        <p className="text-sm text-muted-foreground">
          {t('closedWith', { reason: po.closeReason })}
        </p>
      ) : null}

      <LinesCard po={po} />
      <TermsCard key={po.version} po={po} />
      <BudgetEffectCard po={po} />
      {po.steps.length > 0 ? (
        <StepsView
          cycle={Math.max(...po.steps.map((s) => s.cycle))}
          steps={po.steps}
          signatures={[]}
        />
      ) : null}
      <AcknowledgementCard po={po} />
      <ReceiptsCard po={po} />
      <DocHistoryTimeline slug={poSlug(po)} id={po.id} />
    </div>
  );
}
