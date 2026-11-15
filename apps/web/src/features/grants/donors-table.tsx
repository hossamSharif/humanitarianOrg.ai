'use client';

import { PERMISSIONS, type Donor } from '@ngo/shared';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useHasPermission } from '@/lib/use-me';
import { useDonors } from './api';
import { DonorDialog } from './donor-dialog';
import { ErrorText } from './shared';

export function DonorsTable() {
  const t = useTranslations('donors');
  const tc = useTranslations('common');
  const apiError = useApiError();
  const can = useHasPermission();
  const canManage = can(PERMISSIONS.GRANTS_MANAGE);
  const { data, error, isPending } = useDonors();
  const [editing, setEditing] = useState<Donor | undefined>();
  const [open, setOpen] = useState(false);

  const openDialog = (donor?: Donor) => {
    setEditing(donor);
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {canManage ? (
          <Button onClick={() => openDialog()}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('add')}
          </Button>
        ) : null}
      </div>

      {error ? <ErrorText>{apiError(error)}</ErrorText> : null}
      {isPending ? <p className="text-sm text-muted-foreground">{tc('loading')}</p> : null}

      {data ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('shortName')}</TableHead>
                <TableHead>{t('contactName')}</TableHead>
                <TableHead>{t('contactEmail')}</TableHead>
                <TableHead>{t('contactPhone')}</TableHead>
                <TableHead>{t('statusColumn')}</TableHead>
                {canManage ? <TableHead className="w-0" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                data.data.map((donor) => (
                  <TableRow key={donor.id}>
                    <TableCell className="font-medium">{donor.name}</TableCell>
                    <TableCell>{donor.shortName ?? '—'}</TableCell>
                    <TableCell>{donor.contactName ?? '—'}</TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {donor.contactEmail ?? '—'}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {donor.contactPhone ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={donor.isActive ? 'default' : 'outline'}>
                        {donor.isActive ? t('active') : t('inactive')}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openDialog(donor)}>
                          {t('edit')}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <DonorDialog open={open} onOpenChange={setOpen} donor={editing} />
    </div>
  );
}
