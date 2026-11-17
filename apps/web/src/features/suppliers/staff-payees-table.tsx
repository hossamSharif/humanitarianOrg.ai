'use client';

// Staff payees (002 US2): staff paid by direct payment or advance, with bank details.
// Duplicate bank accounts or phones (with suppliers or other payees) are shown after saving
// as a warning, never as a block (FR-012).
import {
  createStaffPayeeBody,
  updateStaffPayeeBody,
  type DuplicateWarning,
  type StaffPayee,
} from '@ngo/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@ngo/ui';
import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  ErrorText,
  Field,
  WarningBanner,
  apiFieldErrors,
  useLocalizedName,
  zodFieldErrors,
  type FieldErrors,
} from '@/features/grants/shared';
import { useApiError } from '@/lib/use-api-error';
import { useSaveStaffPayee, useStaffPayees } from './api';

const FIELDS = [
  'fullNameAr',
  'fullNameEn',
  'phone',
  'bankName',
  'bankBranch',
  'bankAccountName',
  'bankAccountNo',
] as const;

type Draft = Record<(typeof FIELDS)[number], string>;

const LTR: readonly string[] = ['fullNameEn', 'phone', 'bankAccountNo'];

function draftFrom(p: StaffPayee | null): Draft {
  return {
    fullNameAr: p?.fullNameAr ?? '',
    fullNameEn: p?.fullNameEn ?? '',
    phone: p?.phone ?? '',
    bankName: p?.bankName ?? '',
    bankBranch: p?.bankBranch ?? '',
    bankAccountName: p?.bankAccountName ?? '',
    bankAccountNo: p?.bankAccountNo ?? '',
  };
}

function PayeeDialog({
  open,
  onOpenChange,
  payee,
  onWarnings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payee: StaffPayee | null;
  onWarnings: (warnings: DuplicateWarning[]) => void;
}) {
  const t = useTranslations('suppliers.staffPayees');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveStaffPayee();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(payee));
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (open) {
      setDraft(draftFrom(payee));
      setErrors({});
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payee?.id]);

  function submit() {
    const parsed = payee
      ? updateStaffPayeeBody.safeParse({ ...draft, expectedVersion: payee.version })
      : createStaffPayeeBody.safeParse(draft);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(
      { id: payee?.id, input: parsed.data },
      {
        onSuccess: (saved) => {
          toast({ description: t('saved') });
          onWarnings(saved.duplicateWarnings ?? []);
          onOpenChange(false);
        },
        onError: (err) => setErrors(apiFieldErrors(err)),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{payee ? t('editTitle') : t('newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <Field key={field} id={`payee-${field}`} label={t(field)} error={errors[field]}>
              <Input
                id={`payee-${field}`}
                dir={field === 'fullNameAr' ? 'rtl' : LTR.includes(field) ? 'ltr' : undefined}
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        {save.error ? <ErrorText>{apiError(save.error)}</ErrorText> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={save.isPending}>
            {tc('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StaffPayeesTable() {
  const t = useTranslations('suppliers.staffPayees');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const localized = useLocalizedName();
  const save = useSaveStaffPayee();
  const [q, setQ] = useState('');
  const { data, error, isPending } = useStaffPayees({ q });
  const [editing, setEditing] = useState<StaffPayee | null | undefined>(undefined);
  const [warnings, setWarnings] = useState<DuplicateWarning[]>([]);

  function toggleActive(p: StaffPayee) {
    save.mutate(
      { id: p.id, input: { isActive: !p.isActive, expectedVersion: p.version } },
      { onError: (err) => toast({ variant: 'destructive', description: apiError(err) }) }
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus className="me-2 h-4 w-4" aria-hidden />
          {t('add')}
        </Button>
      </div>

      {warnings.length > 0 ? (
        <WarningBanner>
          <p className="font-medium">{t('duplicatesTitle')}</p>
          <ul className="mt-1 list-disc ps-5">
            {warnings.map((d) => (
              <li key={`${d.partyId}:${d.field}`}>
                {localized({ nameAr: d.nameAr, nameEn: d.nameEn })}
              </li>
            ))}
          </ul>
        </WarningBanner>
      ) : null}

      <Input
        className="w-full sm:w-64"
        placeholder={t('search')}
        aria-label={t('search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
      {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}
      {data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('phone')}</TableHead>
                <TableHead>{t('bankName')}</TableHead>
                <TableHead>{t('bankAccountNo')}</TableHead>
                <TableHead className="w-28">{t('status')}</TableHead>
                <TableHead className="w-44 text-end">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{localized({ nameAr: p.fullNameAr, nameEn: p.fullNameEn })}</TableCell>
                  <TableCell dir="ltr">{p.phone ?? '—'}</TableCell>
                  <TableCell>{p.bankName ?? '—'}</TableCell>
                  <TableCell dir="ltr">{p.bankAccountNo ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? 'default' : 'secondary'}>
                      {p.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(p)}
                        aria-label={t('edit')}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={save.isPending}
                        onClick={() => toggleActive(p)}
                      >
                        {p.isActive ? t('deactivate') : t('activate')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {data && data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}

      <PayeeDialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        payee={editing ?? null}
        onWarnings={setWarnings}
      />
    </div>
  );
}
