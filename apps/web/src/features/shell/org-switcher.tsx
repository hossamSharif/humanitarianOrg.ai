'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@ngo/ui';
import { Building2, ChevronsUpDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useMe, useSwitchTenant } from '@/lib/use-me';

/** Active organization picker; hidden behind a plain label when the user has only one. */
export function OrgSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const { data: me } = useMe();
  const switchTenant = useSwitchTenant();
  const apiError = useApiError();
  const [busy, setBusy] = useState(false);

  const active = me?.memberships.filter((m) => m.status === 'active') ?? [];
  const current = active.find((m) => m.tenantId === me?.tenantId);
  const nameOf = (m: (typeof active)[number]) =>
    locale === 'ar' ? m.tenantNameAr : m.tenantNameEn;

  if (!current) return null;
  if (active.length < 2) {
    return (
      <span className="flex items-center gap-2 text-sm font-medium">
        <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        {nameOf(current)}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy} aria-label={t('switchOrganization')}>
          <Building2 className="me-2 h-4 w-4" aria-hidden />
          {nameOf(current)}
          <ChevronsUpDown className="ms-2 h-4 w-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('organization')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current.tenantId}
          onValueChange={async (tenantId) => {
            if (tenantId === current.tenantId) return;
            setBusy(true);
            try {
              await switchTenant(tenantId);
            } catch (err) {
              toast({ variant: 'destructive', description: apiError(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          {active.map((m) => (
            <DropdownMenuRadioItem key={m.tenantId} value={m.tenantId}>
              {nameOf(m)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
