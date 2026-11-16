// GET /prs/:id/print (US7, FR-045): assembles PrPrintData for the PDF templates
// (contracts/print-layout.md). Labels — organization, offices, grant, donor, activity, units,
// budget-line codes and locations — come from the print snapshot frozen at submission for every
// non-draft PR and from live data for drafts, so configuration edits never change a submitted
// PR's printout (Principle VI). Amount in words comes only from amountInWords (Business Rule 12).
import {
  amountInWords,
  sumByCurrency,
  watermarkFor,
  type CurrencyNames,
  type PrActionView,
  type PrPrintData,
  type PrPrintSignature,
  type PrintLocale,
} from '@ngo/shared';
import { createUserClient } from '../db/supabase';
import { withTenantTx } from '../db/tx';
import { AppError } from '../middleware/error';
import type { PrStepRecord } from '../repositories/pr-approval-step.repository';
import type { PrLineRecord, PrRecord, PrintSnapshot } from '../repositories/pr.repository';
import { ORG_ASSETS_BUCKET } from '../repositories/tenant.repository';
import type { RequestContext } from '../types/context';
import { getPr, prRepos, type PrRepos } from './pr.service';

const LOGO_URL_TTL_SECONDS = 300;

/** Signed URLs of organization assets (the logo path frozen in the snapshot). */
export interface PrintAssets {
  logoUrl(path: string): Promise<string | null>;
}

export interface PrPrintDeps {
  run<T>(fn: (repos: Pick<PrRepos, 'prs' | 'steps' | 'actions'>) => Promise<T>): Promise<T>;
  assets: PrintAssets;
  now?: () => Date;
}

class SupabasePrintAssets implements PrintAssets {
  constructor(private readonly accessToken: string) {}

  async logoUrl(path: string): Promise<string | null> {
    const { data } = await createUserClient(this.accessToken)
      .storage.from(ORG_ASSETS_BUCKET)
      .createSignedUrl(path, LOGO_URL_TTL_SECONDS);
    return data?.signedUrl ?? null;
  }
}

type Named = { code: string; nameAr: string; nameEn: string } | null;

function localized(label: Named, locale: PrintLocale) {
  return label ? { code: label.code, name: locale === 'ar' ? label.nameAr : label.nameEn } : null;
}

export class PrPrintService {
  private readonly now: () => Date;

  constructor(private readonly deps: PrPrintDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  static forContext(ctx: RequestContext): PrPrintService {
    return new PrPrintService({
      run: (fn) =>
        withTenantTx({ claims: ctx.claims, requestId: ctx.requestId }, (tx) =>
          fn(prRepos(tx, ctx.tenantId))
        ),
      assets: new SupabasePrintAssets(ctx.accessToken),
    });
  }

  async printData(id: string, locale: PrintLocale): Promise<PrPrintData> {
    const loaded = await this.deps.run(async ({ prs, steps, actions }) => {
      const pr = await getPr(prs, id);
      const [lines, settings, snapshot, grant, stepRows, actionRows] = await Promise.all([
        prs.lines(id),
        prs.settings(),
        pr.status === 'draft' ? prs.printSnapshot(id) : prs.storedPrintSnapshot(id),
        pr.grantId ? prs.grant(pr.grantId) : Promise.resolve(null),
        pr.submissionCycle > 0 ? steps.list(id, pr.submissionCycle) : Promise.resolve([]),
        actions.list(id),
      ]);
      // a non-draft PR always has a snapshot; fall back to live labels rather than print blanks
      const labels = snapshot ?? (await prs.printSnapshot(id));
      const currencies = await prs.currencyNames(lines.map((l) => l.currency));
      return { pr, lines, settings, labels, grant, stepRows, actionRows, currencies };
    });
    const { pr, lines, settings, labels, grant, stepRows, actionRows, currencies } = loaded;

    const { logoPath, ...organization } = labels.organization;
    const logoUrl = logoPath ? await this.deps.assets.logoUrl(logoPath) : null;

    return {
      organization: { ...organization, logoUrl },
      document: {
        number: pr.number,
        status: pr.status,
        watermark: watermarkFor(pr.status),
        printedAt: this.now().toISOString(),
        timeZone: settings.timeZone,
        locale,
      },
      header: {
        prDate: pr.prDate,
        requiredByDate: pr.requiredByDate,
        requestingOffice: localized(labels.requestingOffice, locale),
        grant: labels.grant,
        donor: labels.donor,
        deliverTo: labels.deliverTo
          ? { name: localized(labels.deliverTo, locale)!.name }
          : null,
        deliveryAddress: pr.deliveryAddress,
        contactName: pr.contactName,
        contactPhone: pr.contactPhone,
        activity: labels.activity,
        prType: pr.prType,
        purpose: pr.purpose,
      },
      lines: lines.map((l) => {
        const line = labels.lines[l.id];
        return {
          lineNo: l.lineNo,
          description: l.description,
          specifications: l.specifications,
          quantity: l.quantity,
          unit: localized(line?.unit ?? null, locale),
          unitCost: l.unitCost,
          lineTotal: l.lineTotal,
          currency: l.currency,
          donorShortName: line?.donorShortName ?? labels.donor?.shortName ?? null,
          budgetLocation: localized(line?.budgetLocation ?? null, locale),
          budgetLineCode: line?.budgetLineCode ?? null,
        };
      }),
      totals: totals(lines, currencies),
      grantTotal: grantTotal(pr, lines, grant?.currency ?? null, settings.baseCurrency),
      signatures: signatures(pr, labels, stepRows, actionRows, locale),
    };
  }
}

function totals(lines: readonly PrLineRecord[], currencies: Map<string, CurrencyNames>) {
  return sumByCurrency(
    lines.flatMap((l) => (l.lineTotal !== null ? [{ amount: l.lineTotal, currency: l.currency }] : []))
  ).map((t) => {
    const names = currencies.get(t.currency);
    if (!names) throw new AppError('INTERNAL_ERROR', `Unknown currency ${t.currency}`);
    return {
      currency: t.currency,
      amount: t.amount,
      amountInWordsAr: amountInWords(t.amount, names, 'ar'),
      amountInWordsEn: amountInWords(t.amount, names, 'en'),
    };
  });
}

/** The locked grant-currency total and the rates behind it, when currencies differ (FR-028). */
function grantTotal(
  pr: PrRecord,
  lines: readonly PrLineRecord[],
  grantCurrency: string | null,
  baseCurrency: string
): PrPrintData['grantTotal'] {
  if (!grantCurrency || pr.totalGrantCurrency === null) return null;
  if (lines.every((l) => l.currency === grantCurrency)) return null;
  const rates: NonNullable<PrPrintData['grantTotal']>['rates'] = [];
  const seen = new Set<string>([baseCurrency]);
  for (const l of lines) {
    if (seen.has(l.currency) || !l.rateToBase || !l.rateDate || !l.rateSource) continue;
    seen.add(l.currency);
    rates.push({
      currency: l.currency,
      rateToBase: l.rateToBase,
      rateDate: l.rateDate,
      source: l.rateSource,
    });
  }
  if (!seen.has(grantCurrency) && pr.grantRateToBase && pr.grantRateDate && pr.grantRateSource) {
    rates.push({
      currency: grantCurrency,
      rateToBase: pr.grantRateToBase,
      rateDate: pr.grantRateDate,
      source: pr.grantRateSource,
    });
  }
  return { currency: grantCurrency, amount: pr.totalGrantCurrency, rates };
}

/**
 * Requested By = the requester snapshot at the last submission; Finance Check and Final Approval =
 * the approve signatures of the current cycle, with the position held when signing (FR-031).
 * Final Approval is the last non-finance step signed (the final_approval step on the default
 * route). Unsigned boxes are null and print blank lines for a wet signature.
 */
function signatures(
  pr: PrRecord,
  labels: PrintSnapshot,
  steps: readonly PrStepRecord[],
  actions: readonly PrActionView[],
  locale: PrintLocale
): PrPrintData['signatures'] {
  let requestedBy: PrPrintSignature = null;
  if (pr.status !== 'draft' && pr.submittedAt) {
    const requester = labels.requester;
    requestedBy = {
      name: requester ? (locale === 'ar' ? requester.nameAr : requester.nameEn) : pr.requesterName ?? '',
      position: requester?.position ?? pr.requesterPosition,
      signedAt: pr.submittedAt,
    };
  }

  const kindOf = new Map(steps.map((s) => [s.stepOrder, s.kind]));
  const signed = actions
    .filter((a) => a.action === 'approve' && a.cycle === pr.submissionCycle && a.stepOrder !== null)
    .map((a) => ({ ...a, kind: kindOf.get(a.stepOrder!) }))
    .sort((a, b) => a.stepOrder! - b.stepOrder!);
  const toSignature = (a: PrActionView | undefined): PrPrintSignature =>
    a ? { name: a.userName, position: a.userPosition, signedAt: a.actedAt } : null;

  return {
    requestedBy,
    financeCheck: toSignature(signed.find((a) => a.kind === 'finance_check')),
    finalApproval: toSignature(signed.filter((a) => a.kind && a.kind !== 'finance_check').at(-1)),
  };
}
