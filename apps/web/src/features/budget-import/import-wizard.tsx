'use client';

import type { ImportResult } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Amount, ErrorText } from '@/features/grants/shared';
import { ApiRequestError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useApiError } from '@/lib/use-api-error';
import { IMPORT_ACCEPT, IMPORT_MAX_BYTES, uploadBudgetLines } from './api';

type Step = 'upload' | 'preview' | 'done';

/**
 * Budget-line import (FR-010, US2-5): upload → preview valid and invalid rows with reasons →
 * commit. Only valid rows are created, in one transaction on the server.
 */
export function ImportWizard({
  open,
  onOpenChange,
  grantId,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grantId: string;
  currency: string;
}) {
  const t = useTranslations('import');
  const tl = useTranslations('budgetLines');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('upload');
      setFile(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  async function run(mode: 'preview' | 'commit') {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadBudgetLines(grantId, mode, file);
      setResult(res);
      setStep(mode === 'preview' ? 'preview' : 'done');
      if (mode === 'commit') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.grants.budgetLines(grantId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.grants.detail(grantId) });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const tooLarge = file !== null && file.size > IMPORT_MAX_BYTES;
  const fileProblem =
    error instanceof ApiRequestError && error.code === 'VALIDATION_ERROR'
      ? ((error.details as { field?: string; message?: string }[] | undefined)?.find(
          (d) => d.field === 'file'
        )?.message ?? null)
      : null;

  function describeFileProblem(message: string): string {
    if (message.startsWith('missing_columns:')) {
      return t('fileErrors.missing_columns', { columns: message.split(':')[1] ?? '' });
    }
    return t.has(`fileErrors.${message}`) ? t(`fileErrors.${message}`) : t('fileErrors.invalid');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>

        {step === 'upload' ? (
          <div className="space-y-3">
            <Label htmlFor="import-file">{t('chooseFile')}</Label>
            <Input
              id="import-file"
              type="file"
              accept={IMPORT_ACCEPT}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">{t('columnsHint')}</p>
            {tooLarge ? <ErrorText>{t('fileErrors.too_large')}</ErrorText> : null}
          </div>
        ) : null}

        {step === 'preview' && result ? (
          <div className="space-y-4">
            <p className="text-sm">
              {t('summary', {
                valid: result.validRows.length,
                invalid: result.invalidRows.length,
              })}
            </p>

            {result.invalidRows.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-destructive">{t('invalidRows')}</h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('row')}</TableHead>
                        <TableHead>{tl('code')}</TableHead>
                        <TableHead>{tl('description')}</TableHead>
                        <TableHead>{tl('category')}</TableHead>
                        <TableHead>{t('amount')}</TableHead>
                        <TableHead>{t('reasons')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.invalidRows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="tabular-nums">{r.row}</TableCell>
                          <TableCell dir="ltr" className="text-start">
                            {r.values.code}
                          </TableCell>
                          <TableCell>{r.values.description}</TableCell>
                          <TableCell>{r.values.category}</TableCell>
                          <TableCell dir="ltr" className="text-start">
                            {r.values.amount}
                          </TableCell>
                          <TableCell>
                            <ul className="list-inside list-disc text-xs text-destructive">
                              {r.errors.map((e) => (
                                <li key={`${e.column}-${e.code}`}>
                                  {t(`columns.${e.column}`)}
                                  {': '}
                                  {t(`rowErrors.${e.code}`)}
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ) : null}

            {result.validRows.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t('validRows')}</h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('row')}</TableHead>
                        <TableHead>{tl('code')}</TableHead>
                        <TableHead>{tl('description')}</TableHead>
                        <TableHead>{tl('category')}</TableHead>
                        <TableHead className="text-end">{t('amount')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.validRows.map((r) => (
                        <TableRow key={r.row}>
                          <TableCell className="tabular-nums">{r.row}</TableCell>
                          <TableCell dir="ltr" className="text-start">
                            {r.code}
                          </TableCell>
                          <TableCell>{r.description}</TableCell>
                          <TableCell>{tl(`categories.${r.category}`)}</TableCell>
                          <TableCell className="text-end">
                            <Amount value={r.amount} currency={currency} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {step === 'done' && result ? (
          <p role="status" className="text-sm">
            {t('created', { count: result.created ?? 0 })}
          </p>
        ) : null}

        {error ? (
          <ErrorText>{fileProblem ? describeFileProblem(fileProblem) : apiError(error)}</ErrorText>
        ) : null}

        <DialogFooter>
          {step === 'done' ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc('cancel')}
              </Button>
              {step === 'preview' ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setStep('upload')}>
                    {t('back')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || !result || result.validRows.length === 0}
                    onClick={() => run('commit')}
                  >
                    {t('commit', { count: result?.validRows.length ?? 0 })}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  disabled={busy || !file || tooLarge}
                  onClick={() => run('preview')}
                >
                  {t('preview')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
