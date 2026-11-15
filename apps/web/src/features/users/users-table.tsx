'use client';

import type { User } from '@ngo/shared';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ngo/ui';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { useBilingual, useUsers, type UsersFilter } from './api';
import { EditUserDialog } from './edit-user-dialog';

const STATUS_VARIANT = {
  active: 'default',
  invited: 'secondary',
  suspended: 'destructive',
} as const;

const ALL = 'all';

export function UsersTable() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const name = useBilingual();
  const [filter, setFilter] = useState<UsersFilter>({ page: 1 });
  const [editing, setEditing] = useState<User | null>(null);
  const { data, isLoading, error } = useUsers(filter);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          type="search"
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          value={filter.q ?? ''}
          onChange={(e) => setFilter({ ...filter, page: 1, q: e.target.value })}
        />
        <Select
          value={filter.status ?? ALL}
          onValueChange={(v) =>
            setFilter({ ...filter, page: 1, status: v === ALL ? undefined : (v as User['status']) })
          }
        >
          <SelectTrigger className="w-44" aria-label={t('status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {(['active', 'invited', 'suspended'] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(`statuses.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {apiError(error)}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('name')}</TableHead>
            <TableHead>{t('email')}</TableHead>
            <TableHead>{t('positionTitle')}</TableHead>
            <TableHead>{t('roles')}</TableHead>
            <TableHead>{t('offices')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('edit')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7}>{tCommon('loading')}</TableCell>
            </TableRow>
          ) : data?.data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          ) : (
            data?.data.map((user) => (
              <TableRow key={user.membershipId}>
                <TableCell className="font-medium">
                  {name({ nameAr: user.fullNameAr, nameEn: user.fullNameEn })}
                </TableCell>
                <TableCell dir="ltr" className="text-start">
                  {user.email}
                </TableCell>
                <TableCell>{user.positionTitle ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.roles.map((r) => (
                      <Badge key={r.id} variant="outline">
                        {name(r)}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {user.orgWideAccess ? (
                    t('allOffices')
                  ) : (
                    <span dir="ltr" className="font-mono text-xs">
                      {user.offices.map((o) => o.code).join(', ') || '—'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[user.status]}>
                    {t(`statuses.${user.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('editUser', {
                      name: name({ nameAr: user.fullNameAr, nameEn: user.fullNameEn }),
                    })}
                    onClick={() => setEditing(user)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={filter.page <= 1}
            onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
          >
            {t('previous')}
          </Button>
          <span>{t('pageOf', { page: filter.page, pages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={filter.page >= pages}
            onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
          >
            {t('next')}
          </Button>
        </div>
      ) : null}

      {editing ? (
        <EditUserDialog
          key={editing.membershipId}
          user={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
    </div>
  );
}
