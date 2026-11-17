'use client';

// Supplier picker for invitations, awards and payments (002 US2). Blacklisted suppliers are
// never listed; suppliers that are not approved, overdue for vetting, or have an expired
// required document are listed with warning badges (the API decides what each step allows).
import type { SupplierSummary } from '@ngo/shared';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@ngo/ui';
import { ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useLocalizedName } from '@/features/grants/shared';
import { useSuppliers } from './api';
import { ComplianceBadges, SupplierStatusBadge } from './supplier-badges';

export function SupplierPicker({
  value,
  onChange,
  id,
  disabled,
}: {
  value: SupplierSummary | null;
  onChange: (supplier: SupplierSummary) => void;
  id?: string;
  disabled?: boolean;
}) {
  const t = useTranslations('suppliers.picker');
  const localized = useLocalizedName();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data, isPending } = useSuppliers({ q, pageSize: 20 });
  const options = (data?.data ?? []).filter((s) => s.status !== 'blacklisted');
  const name = (s: SupplierSummary) => localized({ nameAr: s.legalNameAr, nameEn: s.legalNameEn });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value ? name(value) : t('placeholder')}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,90vw)] p-2" align="start">
        <Input
          autoFocus
          placeholder={t('search')}
          aria-label={t('search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul role="listbox" className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {isPending ? (
            <li className="p-2 text-sm text-muted-foreground">{t('loading')}</li>
          ) : options.length === 0 ? (
            <li className="p-2 text-sm text-muted-foreground">{t('empty')}</li>
          ) : (
            options.map((s) => (
              <li key={s.id} role="option" aria-selected={value?.id === s.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 rounded-md p-2 text-start text-sm hover:bg-accent"
                  onClick={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{name(s)}</span>
                  {s.status !== 'approved' ? <SupplierStatusBadge status={s.status} /> : null}
                  <ComplianceBadges compliance={s.compliance} />
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
