'use client';

// Deduction types (withholding tax and similar, 002 data-model §2): rate, what they apply to,
// and the liability account they are payable to. Edited with accounts:manage. Until the chart
// of accounts screen (US12) exists, the payable account is chosen among the liability accounts
// deductions already use.
import {
  DEDUCTION_APPLIES_TO,
  createDeductionTypeBody,
  type DeductionAppliesTo,
  type DeductionType,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Input,
  MoneyInput,
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
import { Check, Pencil, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '@/features/setup/api';
import { FieldMessage } from '@/features/setup/field-message';
import { useApiError } from '@/lib/use-api-error';
import { useSaveDeductionType } from './api';

interface Draft {
  nameAr: string;
  nameEn: string;
  ratePct: string;
  appliesTo: DeductionAppliesTo;
  payableAccountId: string;
}

type Account = { id: string; code: string };

function EditRow({
  deduction,
  accounts,
  onDone,
}: {
  deduction: DeductionType | null;
  accounts: Account[];
  onDone: () => void;
}) {
  const t = useTranslations('procurement.deductions');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveDeductionType();
  const [draft, setDraft] = useState<Draft>({
    nameAr: deduction?.nameAr ?? '',
    nameEn: deduction?.nameEn ?? '',
    ratePct: deduction?.ratePct ?? '0',
    appliesTo: deduction?.appliesTo ?? 'both',
    payableAccountId: deduction?.payableAccountId ?? accounts[0]?.id ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const formId = `deduction-${deduction?.id ?? 'new'}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createDeductionTypeBody.omit({ isActive: true }).safeParse(draft);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(
      {
        id: deduction?.id,
        input: deduction
          ? { ...parsed.data, expectedVersion: deduction.version }
          : { ...parsed.data, isActive: true },
      },
      {
        onSuccess: () => {
          toast({ description: t('saved') });
          onDone();
        },
        onError: (err) => {
          setErrors(apiFieldErrors(err));
          toast({ variant: 'destructive', description: apiError(err) });
        },
      }
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Input
          form={formId}
          dir="rtl"
          value={draft.nameAr}
          aria-label={t('nameAr')}
          onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
        />
        <FieldMessage errors={errors} field="nameAr" />
      </TableCell>
      <TableCell>
        <Input
          form={formId}
          dir="ltr"
          value={draft.nameEn}
          aria-label={t('nameEn')}
          onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
        />
        <FieldMessage errors={errors} field="nameEn" />
      </TableCell>
      <TableCell>
        <MoneyInput
          form={formId}
          value={draft.ratePct}
          onChange={(v) => setDraft({ ...draft, ratePct: v })}
          aria-label={t('ratePct')}
        />
        <FieldMessage errors={errors} field="ratePct" />
      </TableCell>
      <TableCell>
        <Select
          value={draft.appliesTo}
          onValueChange={(v) => setDraft({ ...draft, appliesTo: v as DeductionAppliesTo })}
        >
          <SelectTrigger aria-label={t('appliesTo')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEDUCTION_APPLIES_TO.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`appliesToValues.${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={draft.payableAccountId || undefined}
          onValueChange={(v) => setDraft({ ...draft, payableAccountId: v })}
        >
          <SelectTrigger aria-label={t('payableAccount')}>
            <SelectValue placeholder={t('chooseAccount')} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span dir="ltr">{a.code}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldMessage errors={errors} field="payableAccountId" />
      </TableCell>
      <TableCell />
      <TableCell className="text-end">
        <form id={formId} onSubmit={submit} className="flex justify-end gap-2">
          <Button type="submit" size="sm" disabled={save.isPending} aria-label={tCommon('save')}>
            <Check className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDone}
            aria-label={tCommon('cancel')}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      </TableCell>
    </TableRow>
  );
}

export function DeductionsTable({
  deductions,
  canEdit,
}: {
  deductions: DeductionType[];
  canEdit: boolean;
}) {
  const t = useTranslations('procurement.deductions');
  const apiError = useApiError();
  const save = useSaveDeductionType();
  const [editing, setEditing] = useState<string | null>(null);
  const accounts = [
    ...new Map(
      deductions.map((d) => [
        d.payableAccountId,
        { id: d.payableAccountId, code: d.payableAccountCode },
      ])
    ).values(),
  ];

  function toggleActive(d: DeductionType) {
    save.mutate(
      { id: d.id, input: { isActive: !d.isActive, expectedVersion: d.version } },
      { onError: (err) => toast({ variant: 'destructive', description: apiError(err) }) }
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {canEdit && accounts.length > 0 ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')} disabled={editing === 'new'}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('nameAr')}</TableHead>
              <TableHead>{t('nameEn')}</TableHead>
              <TableHead className="w-28">{t('ratePct')}</TableHead>
              <TableHead className="w-36">{t('appliesTo')}</TableHead>
              <TableHead className="w-36">{t('payableAccount')}</TableHead>
              <TableHead className="w-28">{t('status')}</TableHead>
              <TableHead className="w-44 text-end">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editing === 'new' ? (
              <EditRow deduction={null} accounts={accounts} onDone={() => setEditing(null)} />
            ) : null}
            {deductions.map((d) =>
              editing === d.id ? (
                <EditRow
                  key={d.id}
                  deduction={d}
                  accounts={accounts}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <TableRow key={d.id}>
                  <TableCell dir="rtl" lang="ar">
                    {d.nameAr}
                  </TableCell>
                  <TableCell dir="ltr" lang="en">
                    {d.nameEn}
                  </TableCell>
                  <TableCell className="tabular-nums" dir="ltr">
                    {d.ratePct}%
                  </TableCell>
                  <TableCell>{t(`appliesToValues.${d.appliesTo}`)}</TableCell>
                  <TableCell className="font-mono" dir="ltr">
                    {d.payableAccountCode}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.isActive ? 'default' : 'secondary'}>
                      {d.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {canEdit ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(d.id)}
                          aria-label={t('edit')}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={save.isPending}
                          onClick={() => toggleActive(d)}
                        >
                          {d.isActive ? t('deactivate') : t('activate')}
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
      {deductions.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
    </div>
  );
}
