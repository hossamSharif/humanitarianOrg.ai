'use client';

import { PERMISSIONS, type BudgetLineWithBalance } from '@ngo/shared';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ImportWizard } from '@/features/budget-import/import-wizard';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useBudgetLines } from './api';
import { BudgetLineDialog } from './budget-line-dialog';
import { Amount, ErrorText, WarningBanner } from './shared';

/**
 * Budget, Reserved, Committed, Actual, Available and % used per line — all derived by the API
 * (FR-012) — with the grant-total difference shown as a warning (FR-013).
 */
export function BudgetLinesTable({ grantId }: { grantId: string }) {
  const t = useTranslations('budgetLines');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const can = useHasPermission();
  const canManage = can(PERMISSIONS.GRANTS_MANAGE);
  const { data, error, isPending } = useBudgetLines(grantId);
  const [editing, setEditing] = useState<BudgetLineWithBalance | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  if (error) return <ErrorText>{apiError(error)}</ErrorText>;
  if (isPending || !data) return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;

  const { summary } = data;
  const currency = summary.currency;
  const openDialog = (line?: BudgetLineWithBalance) => {
    setEditing(line);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="me-2 h-4 w-4" aria-hidden />
            {t('import')}
          </Button>
          <Button onClick={() => openDialog()}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
          </Button>
        </div>
      ) : null}

      {summary.hasDifference ? (
        <WarningBanner>
          {t('differenceWarning')} <Amount value={summary.budgetLinesTotal} currency={currency} />
          {' / '}
          <Amount value={summary.totalAmount} currency={currency} />
          {' · '}
          {t('difference')} <Amount value={summary.difference} currency={currency} />
        </WarningBanner>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('code')}</TableHead>
              <TableHead>{t('description')}</TableHead>
              <TableHead>{t('category')}</TableHead>
              <TableHead className="text-end">{t('budget')}</TableHead>
              <TableHead className="text-end">{t('reserved')}</TableHead>
              <TableHead className="text-end">{t('committed')}</TableHead>
              <TableHead className="text-end">{t('actual')}</TableHead>
              <TableHead className="text-end">{t('available')}</TableHead>
              <TableHead className="text-end">{t('pctUsed')}</TableHead>
              {canManage ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              data.data.map((line) => (
                <TableRow key={line.id} className={line.isActive ? undefined : 'opacity-60'}>
                  <TableCell dir="ltr" className="text-start font-medium">
                    {line.code}
                  </TableCell>
                  <TableCell>
                    {line.description}
                    {line.isActive ? null : (
                      <Badge variant="outline" className="ms-2">
                        {t('inactive')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{t(`categories.${line.category}`)}</TableCell>
                  <TableCell className="text-end">
                    <Amount value={line.budget} currency={currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={line.reserved} currency={currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={line.committed} currency={currency} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Amount value={line.actual} currency={currency} />
                  </TableCell>
                  <TableCell className="text-end font-medium">
                    <Amount value={line.available} currency={currency} />
                  </TableCell>
                  <TableCell dir="ltr" className="text-end tabular-nums">
                    {line.pctUsed === null ? '—' : `${line.pctUsed}%`}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openDialog(line)}>
                        {t('edit')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
          {data.data.length > 0 ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  {t('totals')}
                </TableCell>
                <TableCell className="text-end">
                  <Amount value={summary.totals.budget} currency={currency} />
                </TableCell>
                <TableCell className="text-end">
                  <Amount value={summary.totals.reserved} currency={currency} />
                </TableCell>
                <TableCell className="text-end">
                  <Amount value={summary.totals.committed} currency={currency} />
                </TableCell>
                <TableCell className="text-end">
                  <Amount value={summary.totals.actual} currency={currency} />
                </TableCell>
                <TableCell className="text-end font-medium">
                  <Amount value={summary.totals.available} currency={currency} />
                </TableCell>
                <TableCell dir="ltr" className="text-end tabular-nums">
                  {summary.totals.pctUsed === null ? '—' : `${summary.totals.pctUsed}%`}
                </TableCell>
                {canManage ? <TableCell /> : null}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>

      <BudgetLineDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        grantId={grantId}
        currency={currency}
        line={editing}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        grantId={grantId}
        currency={currency}
      />
    </div>
  );
}
