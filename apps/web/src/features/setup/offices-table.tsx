'use client';

import type { Office } from '@ngo/shared';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@ngo/ui';
import { Lock, Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useSaveOffice } from './api';
import { OfficeDialog } from './office-dialog';

/** Offices with add / edit / activate-deactivate. Offices are never deleted. */
export function OfficesTable({ offices }: { offices: Office[] }) {
  const t = useTranslations('setup.offices');
  const locale = useLocale();
  const apiError = useApiError();
  const save = useSaveOffice();
  // undefined = closed, null = adding, Office = editing
  const [editing, setEditing] = useState<Office | null | undefined>(undefined);

  function toggleActive(office: Office) {
    save.mutate(
      { id: office.id, input: { isActive: !office.isActive } },
      { onError: (err) => toast({ variant: 'destructive', description: apiError(err) }) }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus className="me-2 h-4 w-4" aria-hidden />
          {t('add')}
        </Button>
      </div>

      {offices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('code')}</TableHead>
                <TableHead>{t('name')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('phone')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead className="text-end">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offices.map((office) => (
                <TableRow key={office.id}>
                  <TableCell className="font-mono" dir="ltr">
                    <span className="inline-flex items-center gap-1">
                      {office.code}
                      {office.codeLocked ? (
                        <Lock
                          className="h-3 w-3 text-muted-foreground"
                          aria-label={t('codeLockedShort')}
                        />
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div>{locale === 'ar' ? office.nameAr : office.nameEn}</div>
                    <div className="text-xs text-muted-foreground">
                      {locale === 'ar' ? office.nameEn : office.nameAr}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell" dir="ltr">
                    {office.phone}
                  </TableCell>
                  <TableCell>
                    <Badge variant={office.isActive ? 'default' : 'secondary'}>
                      {office.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(office)}
                        aria-label={t('editTitle')}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={save.isPending}
                        onClick={() => toggleActive(office)}
                      >
                        {office.isActive ? t('deactivate') : t('activate')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing !== undefined ? (
        <OfficeDialog
          key={editing?.id ?? 'new'}
          office={editing}
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}
