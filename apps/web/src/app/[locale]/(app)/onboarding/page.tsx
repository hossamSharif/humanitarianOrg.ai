'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { apiFieldErrors, useCreateTenant, type FieldErrors } from '@/features/setup/api';
import { FieldMessage } from '@/features/setup/field-message';
import {
  EMPTY_ORGANIZATION,
  OrganizationFields,
  parseCreate,
} from '@/features/setup/organization-form';
import { Link, useRouter } from '@/i18n/routing';
import { useApiError } from '@/lib/use-api-error';
import { useMe } from '@/lib/use-me';

/** Create an organization; the creator becomes its Organization Admin (POST /tenants). */
export default function OnboardingPage() {
  const t = useTranslations('setup.onboarding');
  const router = useRouter();
  const apiError = useApiError();
  const { data: me } = useMe();
  const create = useCreateTenant();
  const [values, setValues] = useState(EMPTY_ORGANIZATION);
  const [admin, setAdmin] = useState({ adminFullNameAr: '', adminFullNameEn: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  if (me?.tenantId) {
    return (
      <div className="max-w-prose space-y-3">
        <p className="text-sm text-muted-foreground">{t('alreadyMember')}</p>
        <Button asChild variant="outline">
          <Link href="/">{t('goHome')}</Link>
        </Button>
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = parseCreate(values, admin);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    create.mutate(parsed.body, {
      onSuccess: () => {
        router.replace('/setup/organization');
        router.refresh();
      },
      onError: (err) => {
        setErrors(apiFieldErrors(err));
        setFormError(apiError(err));
      },
    });
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-6" noValidate>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <OrganizationFields values={values} onChange={setValues} errors={errors} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('adminSection')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="adminFullNameAr">{t('adminNameAr')}</Label>
            <Input
              id="adminFullNameAr"
              dir="rtl"
              lang="ar"
              value={admin.adminFullNameAr}
              onChange={(e) => setAdmin({ ...admin, adminFullNameAr: e.target.value })}
            />
            <FieldMessage errors={errors} field="adminFullNameAr" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adminFullNameEn">{t('adminNameEn')}</Label>
            <Input
              id="adminFullNameEn"
              dir="ltr"
              lang="en"
              value={admin.adminFullNameEn}
              onChange={(e) => setAdmin({ ...admin, adminFullNameEn: e.target.value })}
            />
            <FieldMessage errors={errors} field="adminFullNameEn" />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('adminHint')}</p>
        </CardContent>
      </Card>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? t('creating') : t('create')}
      </Button>
    </form>
  );
}
