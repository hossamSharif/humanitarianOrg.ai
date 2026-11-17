'use client';

// Document timeline (FR-044, 002 R30): who did what and when, the state change, the reason,
// and the fields an edit changed (consecutive edits within 10 minutes arrive merged from the
// API). Shared by PRs (features/pr/history-timeline.tsx) and every 002 document.
import {
  formatDate,
  formatDateTime,
  type DocHistoryEntry,
  type DocTypeSlug,
  type PrHistoryChange,
} from '@ngo/shared';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@ngo/ui';
import { ArrowRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTenantTimeZone } from '@/features/setup/api';
import { useApiError } from '@/lib/use-api-error';
import { useDocHistory } from './api';
import { DocStatusBadge } from './status-badge';

/** What the timeline shows of an entry (PrHistoryEntry and DocHistoryEntry both fit). */
export type TimelineEntry = Omit<DocHistoryEntry, 'tableName'> & { tableName?: string | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function ChangeValue({ value }: { value: string | null }) {
  const t = useTranslations('history');
  if (value === null || value === '') {
    return <span className="text-muted-foreground">{t('empty')}</span>;
  }
  // dates as DD/MM/YYYY; numbers, codes and ids stay left-to-right
  const shown = ISO_DATE.test(value) ? formatDate(value) : value;
  return (
    <bdi dir="auto" className="font-medium">
      {shown}
    </bdi>
  );
}

function ChangeLine({ change }: { change: PrHistoryChange }) {
  const t = useTranslations('history');
  const tFields = useTranslations('history.fields');
  const fieldKey = change.field.replace(/^line\./, '');
  const fieldName = tFields.has(fieldKey) ? tFields(fieldKey) : fieldKey;

  let label: string;
  if (change.field === 'line') {
    label =
      change.from === null
        ? t('lineAdded', { lineNo: change.lineNo ?? 0 })
        : t('lineRemoved', { lineNo: change.lineNo ?? 0 });
  } else if (change.field === 'attachment') {
    label = change.from === null ? t('attachmentAdded') : t('attachmentRemoved');
  } else if (change.field.startsWith('line.')) {
    label = t('lineField', { lineNo: change.lineNo ?? 0, field: fieldName });
  } else {
    label = fieldName;
  }

  if (change.field === 'line' || change.field === 'attachment') {
    return (
      <li>
        {label}: <ChangeValue value={change.from ?? change.to} />
      </li>
    );
  }
  return (
    <li>
      {label}: <ChangeValue value={change.from} />{' '}
      <ArrowRight className="inline h-3 w-3 rtl:rotate-180" aria-label={t('to')} />{' '}
      <ChangeValue value={change.to} />
    </li>
  );
}

function Entry({
  entry,
  timeZone,
  kindNamespace,
  renderState,
}: {
  entry: TimelineEntry;
  timeZone: string;
  kindNamespace: string;
  renderState: (status: string) => ReactNode;
}) {
  const t = useTranslations('history');
  const tKind = useTranslations(kindNamespace);
  const locale = useLocale();
  const name = (locale === 'ar' ? entry.actor.nameAr : entry.actor.nameEn) || t('system');
  const stateChanged = entry.fromState !== entry.toState && entry.toState !== null;

  return (
    <li className="relative ps-6">
      <span className="absolute start-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">
          {t(`actions.${entry.action}`)}
          {entry.stepKind ? ` · ${tKind(entry.stepKind)}` : ''}
        </span>
        <span className="text-sm text-muted-foreground">
          {name}
          {entry.actor.position ? ` — ${entry.actor.position}` : ''}
        </span>
        <time
          dir="ltr"
          dateTime={entry.at}
          className="ms-auto text-xs text-muted-foreground tabular-nums"
        >
          {formatDateTime(entry.at, timeZone)}
        </time>
      </div>
      {stateChanged ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          {entry.fromState ? renderState(entry.fromState) : null}
          {entry.fromState ? (
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          ) : null}
          {renderState(entry.toState!)}
        </div>
      ) : null}
      {entry.comment ? (
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm" dir="auto">
          {entry.comment}
        </p>
      ) : null}
      {entry.changes.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
          {entry.changes.map((c, i) => (
            <ChangeLine key={`${c.field}-${c.lineNo ?? ''}-${i}`} change={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function HistoryTimeline({
  data,
  error,
  isPending,
  kindNamespace = 'documents.steps.kind',
  renderState = (status) => <DocStatusBadge status={status} />,
}: {
  data: readonly TimelineEntry[] | undefined;
  error: unknown;
  isPending: boolean;
  /** step kind labels (PRs: pr.steps.kind) */
  kindNamespace?: string;
  renderState?: (status: string) => ReactNode;
}) {
  const t = useTranslations('history');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const timeZone = useTenantTimeZone();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {apiError(error)}
          </p>
        ) : isPending || !data ? (
          <p className="text-sm text-muted-foreground">{tc('loading')}</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ol className="space-y-4 border-s ps-3">
            {[...data].reverse().map((entry, i) => (
              <Entry
                key={`${entry.at}-${entry.action}-${i}`}
                entry={entry}
                timeZone={timeZone}
                kindNamespace={kindNamespace}
                renderState={renderState}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** The timeline of a 002 document (GET /:slug/:id/history). */
export function DocHistoryTimeline({ slug, id }: { slug: DocTypeSlug; id: string }) {
  const { data, error, isPending } = useDocHistory(slug, id);
  return <HistoryTimeline data={data} error={error} isPending={isPending} />;
}
