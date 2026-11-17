'use client';

// Supplier status change (reason required to suspend or blacklist, US2-5), new document, and
// new vetting record (insert-only, FR-010).
import {
  SUPPLIER_DOC_KINDS,
  SUPPLIER_REASON_STATUSES,
  SUPPLIER_STATUS_TRANSITIONS,
  VETTING_RESULTS,
  supplierDocumentBody,
  supplierVettingBody,
  type Supplier,
  type SupplierDocKind,
  type SupplierStatus,
  type VettingResult,
} from '@ngo/shared';
import {
  Button,
  Checkbox,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useEffect, useState } from 'react';
import {
  ErrorText,
  Field,
  apiFieldErrors,
  zodFieldErrors,
  type FieldErrors,
} from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useAddSupplierDocument, useAddVetting, useChangeSupplierStatus } from './api';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier;
}

/** The statuses the caller may move the supplier to (approve: vet; others: manage). */
export function SupplierStatusDialog({
  open,
  onOpenChange,
  supplier,
  allowed,
}: DialogProps & { allowed: (status: SupplierStatus) => boolean }) {
  const t = useTranslations('suppliers.statusDialog');
  const tStatus = useTranslations('suppliers.status');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const change = useChangeSupplierStatus(supplier.id);
  const options = SUPPLIER_STATUS_TRANSITIONS[supplier.status].filter(allowed);
  const [status, setStatus] = useState<SupplierStatus | ''>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setStatus(options[0] ?? '');
      setReason('');
      change.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier.status]);

  const needsReason = status !== '' && SUPPLIER_REASON_STATUSES.includes(status);

  function submit() {
    if (!status) return;
    change.mutate(
      { status, reason: reason.trim() || undefined, expectedVersion: supplier.version },
      {
        onSuccess: () => {
          toast({ description: t('saved') });
          onOpenChange(false);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('current', { status: tStatus(supplier.status) })}
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noOptions')}</p>
        ) : (
          <div className="space-y-4">
            <Field id="supplier-new-status" label={t('newStatus')}>
              <Select value={status} onValueChange={(v) => setStatus(v as SupplierStatus)}>
                <SelectTrigger id="supplier-new-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tStatus(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {status === 'approved' ? (
              <p className="text-xs text-muted-foreground">{t('approveHint')}</p>
            ) : null}
            <Field
              id="supplier-status-reason"
              label={needsReason ? t('reasonRequired') : t('reason')}
            >
              <Textarea
                id="supplier-status-reason"
                value={reason}
                rows={3}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        )}
        {change.error ? <ErrorText>{apiError(change.error)}</ErrorText> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!status || (needsReason && !reason.trim()) || change.isPending}
            variant={status === 'blacklisted' ? 'destructive' : 'default'}
          >
            {t('apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierDocumentDialog({ open, onOpenChange, supplier }: DialogProps) {
  const t = useTranslations('suppliers.documents');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const add = useAddSupplierDocument(supplier.id);
  const [docKind, setDocKind] = useState<SupplierDocKind>('registration');
  const [isRequired, setIsRequired] = useState(true);
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setDocKind('registration');
      setIsRequired(true);
      setNumber('');
      setIssueDate(null);
      setExpiryDate(null);
      setErrors({});
      add.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    const parsed = supplierDocumentBody.safeParse({
      docKind,
      isRequired,
      number,
      issueDate,
      expiryDate,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    add.mutate(parsed.data, {
      onSuccess: () => {
        toast({ description: t('saved') });
        onOpenChange(false);
      },
      onError: (err) => setErrors(apiFieldErrors(err)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="doc-kind" label={t('kind')}>
            <Select value={docKind} onValueChange={(v) => setDocKind(v as SupplierDocKind)}>
              <SelectTrigger id="doc-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPLIER_DOC_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="doc-number" label={t('number')} error={errors.number}>
            <Input
              id="doc-number"
              dir="ltr"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field id="doc-issue" label={t('issueDate')} error={errors.issueDate}>
            <DateInput id="doc-issue" value={issueDate} onChange={setIssueDate} />
          </Field>
          <Field id="doc-expiry" label={t('expiryDate')} error={errors.expiryDate}>
            <DateInput id="doc-expiry" value={expiryDate} onChange={setExpiryDate} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={isRequired} onCheckedChange={(on) => setIsRequired(on === true)} />
            {t('required')}
          </label>
        </div>
        {add.error ? <ErrorText>{apiError(add.error)}</ErrorText> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={add.isPending}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lists commonly checked; the officer can add others. */
const COMMON_LISTS = ['UN', 'OFAC', 'EU', 'UK'] as const;

export function SupplierVettingDialog({ open, onOpenChange, supplier }: DialogProps) {
  const t = useTranslations('suppliers.vetting');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const add = useAddVetting(supplier.id);
  const [checkedOn, setCheckedOn] = useState<string | null>(null);
  const [lists, setLists] = useState<string[]>([...COMMON_LISTS]);
  const [otherLists, setOtherLists] = useState('');
  const [result, setResult] = useState<VettingResult>('clear');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setCheckedOn(new Date().toISOString().slice(0, 10));
      setLists([...COMMON_LISTS]);
      setOtherLists('');
      setResult('clear');
      setNotes('');
      setErrors({});
      add.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    const extra = otherLists
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed = supplierVettingBody.safeParse({
      checkedOn,
      listsChecked: [...lists, ...extra],
      result,
      notes,
    });
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    add.mutate(parsed.data, {
      onSuccess: () => {
        toast({ description: t('saved') });
        onOpenChange(false);
      },
      onError: (err) => setErrors(apiFieldErrors(err)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field id="vetting-date" label={t('checkedOn')} error={errors.checkedOn}>
            <DateInput id="vetting-date" value={checkedOn} onChange={setCheckedOn} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('listsChecked')}</legend>
            <div className="flex flex-wrap gap-4">
              {COMMON_LISTS.map((list) => (
                <label key={list} className="flex items-center gap-2 text-sm" dir="ltr">
                  <Checkbox
                    checked={lists.includes(list)}
                    onCheckedChange={(on) =>
                      setLists(on === true ? [...lists, list] : lists.filter((l) => l !== list))
                    }
                  />
                  {list}
                </label>
              ))}
            </div>
            <Input
              placeholder={t('otherLists')}
              aria-label={t('otherLists')}
              value={otherLists}
              onChange={(e) => setOtherLists(e.target.value)}
            />
            {errors.listsChecked ? <ErrorText>{t('listsRequired')}</ErrorText> : null}
          </fieldset>
          <Field id="vetting-result" label={t('result')}>
            <Select value={result} onValueChange={(v) => setResult(v as VettingResult)}>
              <SelectTrigger id="vetting-result">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VETTING_RESULTS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`results.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="vetting-notes" label={t('notes')}>
            <Textarea
              id="vetting-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        {add.error ? <ErrorText>{apiError(add.error)}</ErrorText> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={add.isPending}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
