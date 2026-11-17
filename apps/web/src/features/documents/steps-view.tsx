'use client';

// Approval route of the current submission cycle and its signatures for any document: name and
// position at signing, DD/MM/YYYY HH:mm in the organization's timezone (FR-031).
import { formatDateTime, type DocStepKind } from '@ngo/shared';
import { cn } from '@ngo/ui';
import { CheckCircle2, Circle, Clock, PenLine } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTenantProfile } from '@/features/setup/api';

export interface StepsViewStep {
  id: string;
  stepOrder: number;
  kind: DocStepKind;
  status: string;
  roleNameAr: string;
  roleNameEn: string;
}

export interface StepsViewSignature {
  action: string;
  cycle: number;
  stepOrder: number | null;
  userName: string;
  userPosition: string | null;
  comment: string | null;
  actedAt: string;
}

function Signature({ action, timeZone }: { action: StepsViewSignature; timeZone: string }) {
  return (
    <p className="text-sm">
      <span className="font-medium">{action.userName}</span>
      {action.userPosition ? (
        <span className="text-muted-foreground"> — {action.userPosition}</span>
      ) : null}
      <span dir="ltr" className="block text-xs text-muted-foreground tabular-nums">
        {formatDateTime(action.actedAt, timeZone)}
      </span>
      {action.comment ? <span className="block text-xs italic">{action.comment}</span> : null}
    </p>
  );
}

export function StepsView({
  cycle,
  steps,
  signatures,
  namespace = 'documents.steps',
  headingId = 'doc-steps-view',
}: {
  cycle: number;
  steps: readonly StepsViewStep[];
  signatures: readonly StepsViewSignature[];
  /** messages with title, requestedBy, kind.* and status.* */
  namespace?: string;
  headingId?: string;
}) {
  const t = useTranslations(namespace);
  const locale = useLocale();
  const tenant = useTenantProfile();
  const timeZone = tenant.data?.timezone ?? 'Africa/Khartoum';
  const submitted = signatures.filter((a) => a.action === 'submit' && a.cycle === cycle).at(-1);

  if (cycle === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border bg-card p-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {t('title')}
      </h2>
      <ol className="space-y-3">
        <li className="flex gap-3">
          <PenLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-medium">{t('requestedBy')}</p>
            {submitted ? <Signature action={submitted} timeZone={timeZone} /> : null}
          </div>
        </li>
        {steps.map((step) => {
          const signature = signatures.find(
            (a) => a.action === 'approve' && a.cycle === cycle && a.stepOrder === step.stepOrder
          );
          const Icon =
            step.status === 'approved' ? CheckCircle2 : step.status === 'pending' ? Clock : Circle;
          return (
            <li key={step.id} className="flex gap-3">
              <Icon
                className={cn(
                  'mt-0.5 h-5 w-5 shrink-0',
                  step.status === 'approved' && 'text-emerald-600',
                  step.status === 'pending' && 'text-amber-600',
                  step.status === 'waiting' && 'text-muted-foreground'
                )}
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium">
                  {t(`kind.${step.kind}`)}
                  <span className="text-muted-foreground">
                    {' · '}
                    {locale === 'ar' ? step.roleNameAr : step.roleNameEn}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{t(`status.${step.status}`)}</p>
                {signature ? <Signature action={signature} timeZone={timeZone} /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
