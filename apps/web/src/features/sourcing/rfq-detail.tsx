'use client';

// RFQ page (002 US3): header and status, the method proposal, the draft editors (header and
// line wording, criteria, invitations), the read-only lines once issued, per-supplier print,
// issue / cancel / re-issue, and the history.
import { formatDate, formatDateTime, type SourcingEventDetail } from '@ngo/shared';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { HistoryTimeline } from '@/features/documents/history-timeline';
import { DocStatusBadge } from '@/features/documents/status-badge';
import { Amount, ErrorText } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { Link } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useRfq, useRfqHistory } from './api';
import { CriteriaEditor } from './criteria-editor';
import { InvitationsEditor } from './invitations-editor';
import { MethodPanel } from './method-panel';
import { OfferTermsPanel } from './offer-terms-panel';
import { RfqPrintButton } from './print/rfq-print-button';
import { ReceiptsPanel } from './receipts-panel';
import { RfqActions } from './rfq-actions';
import { RfqDraftForm } from './rfq-draft-form';

function LinesView({ event }: { event: SourcingEventDetail }) {
  const t = useTranslations('sourcing.lines');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>{t('description')}</TableHead>
              <TableHead className="w-28 text-end">{t('quantity')}</TableHead>
              <TableHead className="w-20">{t('unit')}</TableHead>
              <TableHead className="w-40">{t('pr')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {event.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                <TableCell>
                  <span className="font-medium">{l.description ?? '—'}</span>
                  {l.specifications ? (
                    <span className="block whitespace-pre-line text-xs text-muted-foreground">
                      {l.specifications}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell dir="ltr" className="text-end tabular-nums">
                  {l.quantity}
                </TableCell>
                <TableCell>{l.unitCode ?? '—'}</TableCell>
                <TableCell dir="ltr">
                  <Link href={`/prs/${l.prId}`} className="hover:underline">
                    {l.prNumber}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export function RfqDetail({ id }: { id: string }) {
  const t = useTranslations('sourcing');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const timeZone = useTenantTimeZone();
  const { data: event, error, isPending } = useRfq(id);
  const history = useRfqHistory(id);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !event) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const editable = event.availableActions.includes('edit');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold" dir="ltr">
              {event.number ?? t('draftNumber')}
            </h1>
            <DocStatusBadge status={event.status} namespace="sourcing.status" />
          </div>
          <p className="text-muted-foreground">{event.title}</p>
        </div>
        <RfqActions event={event} />
      </div>

      {event.reissuedFromId || event.reissuedToId || event.cancelReason ? (
        <div className="space-y-1 text-sm">
          {event.reissuedFromId ? (
            <p>
              <Link href={`/procurement/rfqs/${event.reissuedFromId}`} className="underline">
                {t('reissuedFrom')}
              </Link>
            </p>
          ) : null}
          {event.reissuedToId ? (
            <p>
              <Link href={`/procurement/rfqs/${event.reissuedToId}`} className="underline">
                {t('reissuedTo')}
              </Link>
            </p>
          ) : null}
          {event.cancelReason ? (
            <p className="text-muted-foreground">
              {t('cancelReason', { reason: event.cancelReason })}
            </p>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={t('grant')}>
              <span dir="ltr">{event.grantCode}</span>
            </Fact>
            <Fact label={t('issueDateLabel')}>
              <span dir="ltr">{event.issueDate ? formatDate(event.issueDate) : '—'}</span>
            </Fact>
            <Fact label={t('deadline')}>
              <span dir="ltr">
                {event.submissionDeadline
                  ? formatDateTime(event.submissionDeadline, timeZone)
                  : '—'}
              </span>
            </Fact>
            <Fact label={t('estimatedValue')}>
              <Amount value={event.estimatedValueDoa} currency={event.doaCurrency} />
            </Fact>
          </dl>
        </CardContent>
      </Card>

      <MethodPanel event={event} />

      {editable ? <RfqDraftForm event={event} /> : <LinesView event={event} />}
      <CriteriaEditor event={event} editable={editable} />
      <InvitationsEditor
        event={event}
        editable={editable}
        renderActions={(supplierId) => <RfqPrintButton rfqId={event.id} supplierId={supplierId} />}
      />

      <ReceiptsPanel event={event} />
      <OfferTermsPanel event={event} />

      <HistoryTimeline data={history.data} error={history.error} isPending={history.isPending} />
    </div>
  );
}
