'use client';

// Payment categories (with "procurement only", US15-3) and supplier categories: inline add and
// edit, activate / deactivate. Categories are never deleted.
import {
  createPaymentCategoryBody,
  createSupplierCategoryBody,
  type SupplierCategory,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Checkbox,
  Input,
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
import { useSaveCategory, type CategoryKind } from './api';

type Category = SupplierCategory & { procurementOnly?: boolean };

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
  procurementOnly: boolean;
}

function EditRow({
  kind,
  category,
  onDone,
}: {
  kind: CategoryKind;
  /** null = new category */
  category: Category | null;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.categories');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveCategory(kind);
  const [draft, setDraft] = useState<Draft>({
    code: category?.code ?? '',
    nameAr: category?.nameAr ?? '',
    nameEn: category?.nameEn ?? '',
    procurementOnly: category?.procurementOnly ?? false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const formId = `${kind}-category-${category?.id ?? 'new'}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const { procurementOnly, ...base } = draft;
    const body = kind === 'payment' ? { ...base, procurementOnly } : base;
    const parsed = (kind === 'payment' ? createPaymentCategoryBody : createSupplierCategoryBody)
      .omit({ isActive: true })
      .safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(
      {
        id: category?.id,
        input: category
          ? { ...parsed.data, expectedVersion: category.version }
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

  const text = (field: 'code' | 'nameAr' | 'nameEn', dir: 'ltr' | 'rtl') => (
    <TableCell>
      <Input
        form={formId}
        value={draft[field]}
        dir={dir}
        aria-label={t(field)}
        className={field === 'code' ? 'font-mono' : undefined}
        onChange={(e) =>
          setDraft({
            ...draft,
            [field]: field === 'code' ? e.target.value.toLowerCase() : e.target.value,
          })
        }
      />
      <FieldMessage errors={errors} field={field} />
    </TableCell>
  );

  return (
    <TableRow>
      {text('code', 'ltr')}
      {text('nameAr', 'rtl')}
      {text('nameEn', 'ltr')}
      {kind === 'payment' ? (
        <TableCell>
          <Checkbox
            checked={draft.procurementOnly}
            onCheckedChange={(on) => setDraft({ ...draft, procurementOnly: on === true })}
            aria-label={t('procurementOnly')}
          />
        </TableCell>
      ) : null}
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

export function CategoriesTable({
  kind,
  categories,
  canEdit,
}: {
  kind: CategoryKind;
  categories: Category[];
  canEdit: boolean;
}) {
  const t = useTranslations('procurement.categories');
  const apiError = useApiError();
  const save = useSaveCategory(kind);
  const [editing, setEditing] = useState<string | null>(null);

  function toggleActive(c: Category) {
    save.mutate(
      { id: c.id, input: { isActive: !c.isActive, expectedVersion: c.version } },
      { onError: (err) => toast({ variant: 'destructive', description: apiError(err) }) }
    );
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
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
              <TableHead className="w-40">{t('code')}</TableHead>
              <TableHead>{t('nameAr')}</TableHead>
              <TableHead>{t('nameEn')}</TableHead>
              {kind === 'payment' ? (
                <TableHead className="w-36">{t('procurementOnly')}</TableHead>
              ) : null}
              <TableHead className="w-28">{t('status')}</TableHead>
              <TableHead className="w-44 text-end">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editing === 'new' ? (
              <EditRow kind={kind} category={null} onDone={() => setEditing(null)} />
            ) : null}
            {categories.map((c) =>
              editing === c.id ? (
                <EditRow key={c.id} kind={kind} category={c} onDone={() => setEditing(null)} />
              ) : (
                <TableRow key={c.id}>
                  <TableCell className="font-mono" dir="ltr">
                    {c.code}
                  </TableCell>
                  <TableCell dir="rtl" lang="ar">
                    {c.nameAr}
                  </TableCell>
                  <TableCell dir="ltr" lang="en">
                    {c.nameEn}
                  </TableCell>
                  {kind === 'payment' ? (
                    <TableCell>{c.procurementOnly ? t('yes') : t('no')}</TableCell>
                  ) : null}
                  <TableCell>
                    <Badge variant={c.isActive ? 'default' : 'secondary'}>
                      {c.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {canEdit ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(c.id)}
                          aria-label={t('edit')}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={save.isPending}
                          onClick={() => toggleActive(c)}
                        >
                          {c.isActive ? t('deactivate') : t('activate')}
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
      {categories.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
    </div>
  );
}
