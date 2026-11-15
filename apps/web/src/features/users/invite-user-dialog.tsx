'use client';

import { userInvite } from '@ngo/shared';
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
import { UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { useInviteUser } from './api';
import {
  UserFormFields,
  emptyUserForm,
  toFieldErrors,
  type FieldErrors,
  type UserFormValues,
} from './user-form-fields';

export function InviteUserDialog() {
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const apiError = useApiError();
  const invite = useInviteUser();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<UserFormValues>(emptyUserForm);
  const [errors, setErrors] = useState<FieldErrors>({});

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setValues(emptyUserForm);
      setErrors({});
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      ...values,
      officeIds: values.orgWideAccess ? [] : values.officeIds,
      locale: locale === 'en' ? ('en' as const) : ('ar' as const),
    };
    const parsed = userInvite.safeParse(body);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await invite.mutateAsync(body);
      toast({ description: t('inviteSent', { email: parsed.data.email }) });
      reset(false);
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

  return (
    <Dialog open={open} onOpenChange={reset}>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="me-2 h-4 w-4" aria-hidden />
        {t('invite')}
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('inviteTitle')}</DialogTitle>
            <DialogDescription>{t('inviteIntro')}</DialogDescription>
          </DialogHeader>
          <UserFormFields values={values} onChange={setValues} errors={errors} emailEditable />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {t('sendInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
