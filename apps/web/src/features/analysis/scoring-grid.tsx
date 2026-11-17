'use client';

// The caller's scores (002 US5): 1–5 per offer and non-price criterion. Price points are
// computed by the system and shown read-only in the comparison; offers can be disqualified with
// a reason.
import type { BidAnalysisDetail } from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ReasonDialog } from '@/features/documents/reason-dialog';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useDisqualify, usePutScores } from './api';

const key = (offerId: string, criterionId: string) => `${offerId}:${criterionId}`;

export function ScoringGrid({ analysis }: { analysis: BidAnalysisDetail }) {
  const t = useTranslations('analysis.scoring');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const save = usePutScores(analysis.id);
  const disqualify = useDisqualify(analysis.id);
  const [disqualifying, setDisqualifying] = useState<string | null>(null);
  const criteria = analysis.criteria.filter((c) => c.kind === 'weighted' && !c.isPrice);
  const offers = analysis.offers.filter((o) => o.status !== 'disqualified');
  const fromServer = () =>
    Object.fromEntries(
      analysis.myScores.map((s) => [key(s.offerId, s.criterionId), String(s.score)])
    );
  const [scores, setScores] = useState<Record<string, string>>(fromServer);

  useEffect(() => {
    setScores(fromServer());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.myScores]);

  if (!analysis.availableActions.includes('score')) return null;

  const entries = Object.entries(scores).filter(([, v]) => v);
  const submit = () =>
    save.mutate(
      {
        scores: entries.map(([k, v]) => {
          const [offerId, criterionId] = k.split(':') as [string, string];
          return { offerId, criterionId, score: Number(v) };
        }),
      },
      { onSuccess: () => toast({ description: t('saved') }) }
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('supplier')}</TableHead>
                {criteria.map((c) => (
                  <TableHead key={c.id} className="w-36">
                    {localized(c)}
                  </TableHead>
                ))}
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {offers.map((o) => (
                <TableRow key={o.offerId}>
                  <TableCell className="font-medium">
                    {localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn })}
                  </TableCell>
                  {criteria.map((c) => (
                    <TableCell key={c.id}>
                      <Select
                        value={scores[key(o.offerId, c.id)] ?? ''}
                        onValueChange={(v) =>
                          setScores((cur) => ({ ...cur, [key(o.offerId, c.id)]: v }))
                        }
                      >
                        <SelectTrigger
                          aria-label={t('scoreFor', {
                            criterion: localized(c),
                            supplier: localized({
                              nameAr: o.supplierNameAr,
                              nameEn: o.supplierNameEn,
                            }),
                          })}
                        >
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  ))}
                  <TableCell className="text-end">
                    <Button variant="ghost" size="sm" onClick={() => setDisqualifying(o.offerId)}>
                      {t('disqualify')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
        <div className="flex justify-end">
          <Button disabled={save.isPending || entries.length === 0} onClick={submit}>
            {tc('save')}
          </Button>
        </div>
      </CardContent>
      <ReasonDialog
        open={disqualifying !== null}
        onOpenChange={(o) => (o ? null : setDisqualifying(null))}
        title={t('disqualifyTitle')}
        description={t('disqualifyIntro')}
        confirmLabel={t('disqualify')}
        destructive
        busy={disqualify.isPending}
        error={disqualify.error ? apiError(disqualify.error) : null}
        onConfirm={(reason) =>
          disqualify.mutate(
            { offerId: disqualifying!, reason },
            { onSuccess: () => setDisqualifying(null) }
          )
        }
      />
    </Card>
  );
}
