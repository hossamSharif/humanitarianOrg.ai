'use client';

// Create or edit a supplier (002 US2). New suppliers start as pending vetting. Duplicate
// identifiers are reported after saving as a warning on the supplier page, never as a block.
import {
  SUPPLIER_TYPES,
  createSupplierBody,
  updateSupplierBody,
  type Supplier,
  type SupplierType,
} from '@ngo/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ErrorText,
  Field,
  apiFieldErrors,
  useLocalizedName,
  zodFieldErrors,
  type FieldErrors,
} from '@/features/grants/shared';
import { useCategories } from '@/features/procurement-settings/api';
import { useApiError } from '@/lib/use-api-error';
import { useSaveSupplier } from './api';

const TEXT_FIELDS = [
  'tradeName',
  'registrationNo',
  'taxNo',
  'phone',
  'email',
  'contactPerson',
  'city',
  'address',
] as const;

const BANK_FIELDS = ['bankName', 'bankBranch', 'bankAccountName', 'bankAccountNo'] as const;

type TextField = (typeof TEXT_FIELDS)[number] | (typeof BANK_FIELDS)[number];

interface Draft extends Record<TextField, string> {
  legalNameAr: string;
  legalNameEn: string;
  type: SupplierType;
  notes: string;
  categoryIds: string[];
}

function draftFrom(s: Supplier | null): Draft {
  const text = (v: string | null | undefined) => v ?? '';
  return {
    legalNameAr: text(s?.legalNameAr),
    legalNameEn: text(s?.legalNameEn),
    type: s?.type ?? 'company',
    notes: text(s?.notes),
    categoryIds: s?.categoryIds ?? [],
    tradeName: text(s?.tradeName),
    registrationNo: text(s?.registrationNo),
    taxNo: text(s?.taxNo),
    phone: text(s?.phone),
    email: text(s?.email),
    contactPerson: text(s?.contactPerson),
    city: text(s?.city),
    address: text(s?.address),
    bankName: text(s?.bankName),
    bankBranch: text(s?.bankBranch),
    bankAccountName: text(s?.bankAccountName),
    bankAccountNo: text(s?.bankAccountNo),
  };
}

const LTR_FIELDS: readonly TextField[] = [
  'registrationNo',
  'taxNo',
  'phone',
  'email',
  'bankAccountNo',
];

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = new supplier */
  supplier: Supplier | null;
  onSaved?: (saved: Supplier) => void;
}) {
  const t = useTranslations('suppliers.form');
  const tSup = useTranslations('suppliers');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const save = useSaveSupplier();
  const categories = useCategories('supplier');
  const [draft, setDraft] = useState<Draft>(() => draftFrom(supplier));
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(supplier));
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier?.id, supplier?.version]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function toggleCategory(id: string, on: boolean) {
    set('categoryIds', on ? [...draft.categoryIds, id] : draft.categoryIds.filter((c) => c !== id));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = supplier
      ? updateSupplierBody.safeParse({ ...draft, expectedVersion: supplier.version })
      : createSupplierBody.safeParse(draft);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(
      { id: supplier?.id, input: parsed.data },
      {
        onSuccess: (saved) => {
          toast({ description: t('saved') });
          onOpenChange(false);
          onSaved?.(saved);
        },
        onError: (err) => setErrors(apiFieldErrors(err)),
      }
    );
  }

  const textField = (field: TextField) => (
    <Field key={field} id={`supplier-${field}`} label={t(field)} error={errors[field]}>
      <Input
        id={`supplier-${field}`}
        value={draft[field]}
        dir={LTR_FIELDS.includes(field) ? 'ltr' : undefined}
        onChange={(e) => set(field, e.target.value)}
      />
    </Field>
  );

  const activeCategories = (categories.data?.data ?? []).filter(
    (c) => c.isActive || draft.categoryIds.includes(c.id)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{supplier ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>
        <form id="supplier-form" onSubmit={submit} noValidate className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="supplier-legalNameAr" label={t('legalNameAr')} error={errors.legalNameAr}>
              <Input
                id="supplier-legalNameAr"
                dir="rtl"
                value={draft.legalNameAr}
                onChange={(e) => set('legalNameAr', e.target.value)}
              />
            </Field>
            <Field id="supplier-legalNameEn" label={t('legalNameEn')} error={errors.legalNameEn}>
              <Input
                id="supplier-legalNameEn"
                dir="ltr"
                value={draft.legalNameEn}
                onChange={(e) => set('legalNameEn', e.target.value)}
              />
            </Field>
            <Field id="supplier-type" label={t('type')} error={errors.type}>
              <Select value={draft.type} onValueChange={(v) => set('type', v as SupplierType)}>
                <SelectTrigger id="supplier-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPLIER_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {tSup(`types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {TEXT_FIELDS.map(textField)}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">{t('bankDetails')}</legend>
            <div className="grid gap-4 sm:grid-cols-2">{BANK_FIELDS.map(textField)}</div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">{t('categories')}</legend>
            <div className="flex flex-wrap gap-4">
              {activeCategories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.categoryIds.includes(c.id)}
                    onCheckedChange={(on) => toggleCategory(c.id, on === true)}
                  />
                  {localized(c)}
                </label>
              ))}
            </div>
          </fieldset>

          <Field id="supplier-notes" label={t('notes')} error={errors.notes}>
            <Textarea
              id="supplier-notes"
              value={draft.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
            />
          </Field>

          {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="supplier-form" disabled={save.isPending}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
