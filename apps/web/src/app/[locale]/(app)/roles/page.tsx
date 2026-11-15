'use client';

import type { Role } from '@ngo/shared';
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
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useBilingual, useDeleteRole, useRoles } from '@/features/users/api';
import { RoleEditor } from '@/features/users/role-editor';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';

export default function RolesPage() {
  const t = useTranslations('roles');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const name = useBilingual();
  const { data, isLoading, error } = useRoles();
  const remove = useDeleteRole();
  // undefined = closed, null = new role
  const [editing, setEditing] = useState<Role | null | undefined>(undefined);

  async function onDelete(role: Role) {
    try {
      await remove.mutateAsync(role.id);
      toast({ description: t('deleted', { name: name(role) }) });
    } catch (err) {
      const inUse = err instanceof ApiRequestError && err.code === 'ROLE_IN_USE';
      toast({ variant: 'destructive', description: inUse ? t('inUse') : apiError(err) });
    }
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
          {t('create')}
        </Button>
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
            <TableHead>{t('permissionCount')}</TableHead>
            <TableHead>{t('memberCount')}</TableHead>
            <TableHead>{t('ruleStepCount')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5}>{tCommon('loading')}</TableCell>
            </TableRow>
          ) : (
            data?.data.map((role) => {
              const used = role.memberCount > 0 || role.ruleStepCount > 0;
              return (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    {name(role)}
                    {role.isSystem ? (
                      <Badge variant="secondary" className="ms-2">
                        {t('system')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{role.permissions.length}</TableCell>
                  <TableCell>{role.memberCount}</TableCell>
                  <TableCell>{role.ruleStepCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('editRole', { name: name(role) })}
                        onClick={() => setEditing(role)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={used || remove.isPending}
                        title={used ? t('inUse') : undefined}
                        aria-label={t('deleteRole', { name: name(role) })}
                        onClick={() => void onDelete(role)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {editing !== undefined ? (
        <RoleEditor
          key={editing?.id ?? 'new'}
          role={editing}
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}
