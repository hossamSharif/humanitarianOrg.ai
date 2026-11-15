'use client';

import { userUpdate, type User } from '@ngo/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';
import { useUpdateUser } from './api';
import {
  UserFormFields,
  toFieldErrors,
  useFieldErrorText,
  type FieldErrors,
  type UserFormValues,
} from './user-form-fields';

function fromUser(user: User): UserFormValues {
  return {
    email: user.email,
    fullNameAr: user.fullNameAr,
    fullNameEn: user.fullNameEn,
    positionTitle: user.positionTitle ?? '',
    orgWideAccess: user.orgWideAccess,
    officeIds: user.offices.map((o) => o.id),
    roleIds: user.roles.map((r) => r.id),
  };
}

/** Edit names, position, offices, roles and access; suspend or reactivate. */
export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const { data: me } = useMe();
  const update = useUpdateUser();
  const [values, setValues] = useState<UserFormValues>(() => fromUser(user));
  const [errors, setErrors] = useState<FieldErrors>({});
  const errorText = useFieldErrorText();
  const isSelf = me?.membership?.id === user.membershipId;

  async function save(body: Record<string, unknown>) {
    const parsed = userUpdate.safeParse(body);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync({ membershipId: user.membershipId, body: parsed.data });
      toast({ description: t('saved') });
      onOpenChange(false);
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        err.code === 'VALIDATION_ERROR' &&
        Array.isArray(err.details)
      ) {
        setErrors(toFieldErrors(err.details));
        return;
      }
      toast({ variant: 'destructive', description: apiError(err) });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save({
      fullNameAr: values.fullNameAr,
      fullNameEn: values.fullNameEn,
      positionTitle: values.positionTitle,
      orgWideAccess: values.orgWideAccess,
      officeIds: values.orgWideAccess ? [] : values.officeIds,
      roleIds: values.roleIds,
    });
  }

  const suspended = user.status === 'suspended';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editIntro')}</DialogDescription>
          </DialogHeader>
          <UserFormFields
            values={values}
            onChange={setValues}
            errors={errors}
            emailEditable={false}
          />
          {errors.status ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText('status', errors.status)}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant={suspended ? 'secondary' : 'destructive'}
              disabled={update.isPending || (isSelf && !suspended)}
              onClick={() => void save({ status: suspended ? 'active' : 'suspended' })}
            >
              {suspended ? t('reactivate') : t('suspend')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {tCommon('save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
