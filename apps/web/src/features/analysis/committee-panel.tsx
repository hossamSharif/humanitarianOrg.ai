'use client';

// The committee (002 US5-4, US5-5): seat and replace members, each member's declaration and
// signature. The caller declares conflicts of interest here; prices stay hidden until they do.
import {
  COMMITTEE_FUNCTIONS,
  formatDateTime,
  type BidAnalysisDetail,
  type CommitteeFunction,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@ngo/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ErrorText, useLocalizedName } from '@/features/grants/shared';
import { useTenantTimeZone } from '@/features/setup/api';
import { useUsers } from '@/features/users/api';
import { useApiError } from '@/lib/use-api-error';
import { useDeclare, useSetCommittee } from './api';

interface Row {
  userId: string;
  function: CommitteeFunction;
  replacesUserId?: string;
}

function DeclarationDialog({
  analysis,
  open,
  onOpenChange,
}: {
  analysis: BidAnalysisDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('analysis.declaration');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const declare = useDeclare(analysis.id);
  const [hasConflict, setHasConflict] = useState(false);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [note, setNote] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="coi-has"
              checked={hasConflict}
              onCheckedChange={(v) => setHasConflict(v === true)}
            />
            <Label htmlFor="coi-has">{t('hasConflict')}</Label>
          </div>
          {hasConflict ? (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t('suppliers')}</legend>
              {analysis.offers.map((o) => (
                <div key={o.supplierId} className="flex items-center gap-2">
                  <Checkbox
                    id={`coi-${o.supplierId}`}
                    checked={suppliers.includes(o.supplierId)}
                    onCheckedChange={(v) =>
                      setSuppliers((cur) =>
                        v === true ? [...cur, o.supplierId] : cur.filter((x) => x !== o.supplierId)
                      )
                    }
                  />
                  <Label htmlFor={`coi-${o.supplierId}`}>
                    {localized({ nameAr: o.supplierNameAr, nameEn: o.supplierNameEn })}
                  </Label>
                </div>
              ))}
            </fieldset>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="coi-note">{t('note')}</Label>
            <Textarea
              id="coi-note"
              dir="auto"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('once')}</p>
        </div>
        {declare.error ? <ErrorText>{apiError(declare.error)}</ErrorText> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={declare.isPending || (hasConflict && suppliers.length === 0)}
            onClick={() =>
              declare.mutate(
                {
                  hasConflict,
                  conflictSupplierIds: hasConflict ? suppliers : [],
                  ...(note.trim() ? { note: note.trim() } : {}),
                },
                { onSuccess: () => onOpenChange(false) }
              )
            }
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CommitteePanel({ analysis }: { analysis: BidAnalysisDetail }) {
  const t = useTranslations('analysis.committee');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const timeZone = useTenantTimeZone();
  const users = useUsers({ page: 1, status: 'active' });
  const save = useSetCommittee(analysis.id);
  const editable = analysis.availableActions.includes('committee');
  const canDeclare = analysis.availableActions.includes('declare');
  const [declaring, setDeclaring] = useState(false);
  const active = analysis.committee.filter((m) => m.replacedById === null);
  const fromServer = (): Row[] => active.map((m) => ({ userId: m.userId, function: m.function }));
  const [rows, setRows] = useState<Row[]>(fromServer);

  useEffect(() => {
    setRows(fromServer());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.committee]);

  const members = users.data?.data ?? [];
  const nameOf = (userId: string) => {
    const seated = analysis.committee.find((m) => m.userId === userId);
    if (seated) return localized(seated);
    const u = members.find((m) => m.userId === userId);
    return u ? localized({ nameAr: u.fullNameAr, nameEn: u.fullNameEn }) : userId;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              analysis.eligibleMemberCount >= analysis.committeeMinSize
                ? 'secondary'
                : 'destructive'
            }
          >
            {t('eligible', {
              count: analysis.eligibleMemberCount,
              minimum: analysis.committeeMinSize,
            })}
          </Badge>
          {canDeclare ? <Button onClick={() => setDeclaring(true)}>{t('declare')}</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {analysis.committee.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              <span className="font-medium">{localized(m)}</span>
              <span className="text-muted-foreground">{t(`functions.${m.function}`)}</span>
              {m.replacedById ? <Badge variant="outline">{t('replaced')}</Badge> : null}
              {m.declaredAt === null ? (
                <Badge variant="outline">{t('notDeclared')}</Badge>
              ) : m.hasConflict ? (
                <Badge variant="destructive">{t('conflict')}</Badge>
              ) : (
                <Badge variant="secondary">{t('noConflict')}</Badge>
              )}
              {m.signedAt ? (
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {t('signedAt', { at: formatDateTime(m.signedAt, timeZone) })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {analysis.committee.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}

        {editable ? (
          <div className="space-y-2 rounded-md border p-3">
            <h3 className="font-semibold">{t('edit')}</h3>
            {rows.map((r, i) => {
              const seated = active.find((m) => m.userId === r.userId);
              return (
                <div
                  key={`${r.userId}-${i}`}
                  className="grid gap-2 sm:grid-cols-[1fr_12rem_1fr_auto]"
                >
                  <Select
                    value={r.userId}
                    disabled={!!seated}
                    onValueChange={(v) =>
                      setRows((cur) => cur.map((x, j) => (j === i ? { ...x, userId: v } : x)))
                    }
                  >
                    <SelectTrigger aria-label={t('member', { n: i + 1 })}>
                      <SelectValue placeholder={t('chooseUser')}>
                        {r.userId ? nameOf(r.userId) : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((u) => (
                        <SelectItem key={u.userId} value={u.userId}>
                          {localized({ nameAr: u.fullNameAr, nameEn: u.fullNameEn })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={r.function}
                    onValueChange={(v) =>
                      setRows((cur) =>
                        cur.map((x, j) =>
                          j === i ? { ...x, function: v as CommitteeFunction } : x
                        )
                      )
                    }
                  >
                    <SelectTrigger aria-label={t('function')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMITTEE_FUNCTIONS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {t(`functions.${f}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!seated ? (
                    <Select
                      value={r.replacesUserId ?? '__none'}
                      onValueChange={(v) =>
                        setRows((cur) =>
                          cur.map((x, j) =>
                            j === i ? { ...x, replacesUserId: v === '__none' ? undefined : v } : x
                          )
                        )
                      }
                    >
                      <SelectTrigger aria-label={t('replaces')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('replacesNobody')}</SelectItem>
                        {active
                          .filter((m) => m.declaredAt !== null)
                          .map((m) => (
                            <SelectItem key={m.userId} value={m.userId}>
                              {t('replacesWho', { name: localized(m) })}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('remove')}
                    onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              );
            })}
            {users.error ? (
              <p className="text-xs text-muted-foreground">{t('noUserList')}</p>
            ) : null}
            {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRows((cur) => [...cur, { userId: '', function: 'procurement' }])}
              >
                <Plus className="me-2 h-4 w-4" aria-hidden />
                {t('add')}
              </Button>
              <Button
                disabled={save.isPending || rows.length === 0 || rows.some((r) => !r.userId)}
                onClick={() =>
                  save.mutate({
                    expectedVersion: analysis.version,
                    members: rows.map((r) => ({
                      userId: r.userId,
                      function: r.function,
                      ...(r.replacesUserId ? { replacesUserId: r.replacesUserId } : {}),
                    })),
                  })
                }
              >
                {tc('save')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
      {declaring ? (
        <DeclarationDialog analysis={analysis} open={declaring} onOpenChange={setDeclaring} />
      ) : null}
    </Card>
  );
}
