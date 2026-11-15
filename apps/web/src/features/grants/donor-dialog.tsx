'use client';

import { donorCreate, type Donor } from '@ngo/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useSaveDonor } from './api';
import { ErrorText, Field, apiFieldErrors, zodFieldErrors, type FieldErrors } from './shared';

interface DonorForm {
  name: string;
  shortName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: DonorForm = {
  name: '',
  shortName: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  notes: '',
  isActive: true,
};

function fromDonor(d: Donor): DonorForm {
  return {
    name: d.name,
    shortName: d.shortName ?? '',
    contactName: d.contactName ?? '',
    contactEmail: d.contactEmail ?? '',
    contactPhone: d.contactPhone ?? '',
    notes: d.notes ?? '',
    isActive: d.isActive,
  };
}

export function DonorDialog({
  open,
  onOpenChange,
  donor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** edit this donor; create when omitted */
  donor?: Donor;
}) {
  const t = useTranslations('donors');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveDonor();
  const [form, setForm] = useState<DonorForm>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setForm(donor ? fromDonor(donor) : EMPTY);
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, donor]);

  const set = <K extends keyof DonorForm>(key: K, value: DonorForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const { isActive, ...fields } = form;
    const parsed = donorCreate.safeParse(fields);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({
        id: donor?.id,
        body: donor ? { ...parsed.data, isActive } : parsed.data,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors(apiFieldErrors(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{donor ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <Field id="donor-name" label={t('name')} error={errors.name}>
            <Input
              id="donor-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="donor-short" label={t('shortName')} error={errors.shortName}>
              <Input
                id="donor-short"
                value={form.shortName}
                onChange={(e) => set('shortName', e.target.value)}
              />
            </Field>
            <Field id="donor-contact" label={t('contactName')} error={errors.contactName}>
              <Input
                id="donor-contact"
                value={form.contactName}
                onChange={(e) => set('contactName', e.target.value)}
              />
            </Field>
            <Field id="donor-email" label={t('contactEmail')} error={errors.contactEmail}>
              <Input
                id="donor-email"
                type="email"
                dir="ltr"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
              />
            </Field>
            <Field id="donor-phone" label={t('contactPhone')} error={errors.contactPhone}>
              <Input
                id="donor-phone"
                dir="ltr"
                value={form.contactPhone}
                onChange={(e) => set('contactPhone', e.target.value)}
              />
            </Field>
          </div>
          <Field id="donor-notes" label={t('notes')} error={errors.notes}>
            <Textarea
              id="donor-notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
          {donor ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="donor-active"
                checked={form.isActive}
                onCheckedChange={(v) => set('isActive', v === true)}
              />
              <Label htmlFor="donor-active">{t('active')}</Label>
            </div>
          ) : null}

          {save.error && Object.keys(errors).length === 0 ? (
            <ErrorText>{apiError(save.error)}</ErrorText>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
