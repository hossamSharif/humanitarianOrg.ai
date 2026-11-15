'use client';

import { createUnitBody, updateUnitBody, type UnitOfMeasure } from '@ngo/shared';
import {
  Badge,
  Button,
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
import { useApiError } from '@/lib/use-api-error';
import { apiFieldErrors, useSaveUnit, zodFieldErrors, type FieldErrors } from './api';
import { FieldMessage } from './field-message';

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
}

const EMPTY: Draft = { code: '', nameAr: '', nameEn: '' };

/** One editable row (add or edit), saved with Enter or the check button. */
function EditRow({
  unit,
  onDone,
}: {
  /** null = new unit */
  unit: UnitOfMeasure | null;
  onDone: () => void;
}) {
  const t = useTranslations('setup.units');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveUnit();
  const [draft, setDraft] = useState<Draft>(unit ? { ...unit } : EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formId = `unit-form-${unit?.id ?? 'new'}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = (unit ? updateUnitBody : createUnitBody).safeParse(draft);
    if (!result.success) {
      setErrors(zodFieldErrors(result.error));
      return;
    }
    setErrors({});
    save.mutate(
      { id: unit?.id, input: result.data },
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

  const cell = (field: keyof Draft, props: { dir: 'ltr' | 'rtl'; label: string }) => (
    <TableCell>
      <Input
        form={formId}
        value={draft[field]}
        dir={props.dir}
        aria-label={props.label}
        className={field === 'code' ? 'font-mono uppercase' : undefined}
        onChange={(e) =>
          setDraft({
            ...draft,
            [field]: field === 'code' ? e.target.value.toUpperCase() : e.target.value,
          })
        }
      />
      <FieldMessage
        errors={errors}
        field={field}
        hint={field === 'code' ? 'unitCode' : undefined}
      />
    </TableCell>
  );

  return (
    <TableRow>
      {cell('code', { dir: 'ltr', label: t('code') })}
      {cell('nameAr', { dir: 'rtl', label: t('nameAr') })}
      {cell('nameEn', { dir: 'ltr', label: t('nameEn') })}
      <TableCell>
        {unit ? (
          <Badge variant={unit.isActive ? 'default' : 'secondary'}>
            {unit.isActive ? t('active') : t('inactive')}
          </Badge>
        ) : null}
      </TableCell>
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

/** Units of measure with inline add / edit / activate-deactivate. Units are never deleted. */
export function UnitsTable({ units }: { units: UnitOfMeasure[] }) {
  const t = useTranslations('setup.units');
  const apiError = useApiError();
  const save = useSaveUnit();
  // 'new' = adding a row, id = editing that row
  const [editing, setEditing] = useState<string | null>(null);

  function toggleActive(unit: UnitOfMeasure) {
    save.mutate(
      { id: unit.id, input: { isActive: !unit.isActive } },
      { onError: (err) => toast({ variant: 'destructive', description: apiError(err) }) }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')} disabled={editing === 'new'}>
          <Plus className="me-2 h-4 w-4" aria-hidden />
          {t('add')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">{t('code')}</TableHead>
              <TableHead>{t('nameAr')}</TableHead>
              <TableHead>{t('nameEn')}</TableHead>
              <TableHead className="w-28">{t('status')}</TableHead>
              <TableHead className="w-48 text-end">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {editing === 'new' ? <EditRow unit={null} onDone={() => setEditing(null)} /> : null}
            {units.map((unit) =>
              editing === unit.id ? (
                <EditRow key={unit.id} unit={unit} onDone={() => setEditing(null)} />
              ) : (
                <TableRow key={unit.id}>
                  <TableCell className="font-mono" dir="ltr">
                    {unit.code}
                  </TableCell>
                  <TableCell dir="rtl" lang="ar">
                    {unit.nameAr}
                  </TableCell>
                  <TableCell dir="ltr" lang="en">
                    {unit.nameEn}
                  </TableCell>
                  <TableCell>
                    <Badge variant={unit.isActive ? 'default' : 'secondary'}>
                      {unit.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(unit.id)}
                        aria-label={t('edit')}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={save.isPending}
                        onClick={() => toggleActive(unit)}
                      >
                        {unit.isActive ? t('deactivate') : t('activate')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
      {units.length === 0 && editing !== 'new' ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
    </div>
  );
}
