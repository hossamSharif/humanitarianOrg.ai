'use client';

import {
  createTenantBody,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  updateTenantBody,
  type TenantProfile,
} from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@ngo/ui';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useApiError } from '@/lib/use-api-error';
import {
  apiFieldErrors,
  useUpdateTenant,
  useUploadLogo,
  zodFieldErrors,
  type FieldErrors,
} from './api';
import { FieldMessage } from './field-message';

/** Currencies seeded by migration 0008 (reference data, not UI text). */
export const CURRENCY_CODES = ['SDG', 'USD', 'EUR', 'GBP', 'SAR'] as const;

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

export interface OrganizationValues {
  nameAr: string;
  nameEn: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  baseCurrency: string;
  doaReferenceCurrency: string;
  fiscalYearStartMonth: string;
  timezone: string;
  maxBackdateDays: string;
}

export const EMPTY_ORGANIZATION: OrganizationValues = {
  nameAr: '',
  nameEn: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  baseCurrency: 'SDG',
  doaReferenceCurrency: 'USD',
  fiscalYearStartMonth: '1',
  timezone: 'Africa/Khartoum',
  maxBackdateDays: '30',
};

function fromProfile(p: TenantProfile): OrganizationValues {
  return {
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    address: p.address ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
    website: p.website ?? '',
    baseCurrency: p.baseCurrency,
    doaReferenceCurrency: p.doaReferenceCurrency,
    fiscalYearStartMonth: String(p.fiscalYearStartMonth),
    timezone: p.timezone,
    maxBackdateDays: String(p.maxBackdateDays),
  };
}

/** Form values → request body; numbers are parsed here, everything else is validated by Zod. */
export function toRequest(v: OrganizationValues) {
  return {
    ...v,
    fiscalYearStartMonth: Number(v.fiscalYearStartMonth),
    maxBackdateDays: v.maxBackdateDays.trim() === '' ? Number.NaN : Number(v.maxBackdateDays),
  };
}

function Field({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors: FieldErrors;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldMessage errors={errors} field={id} />
    </div>
  );
}

/** The organization profile fields, shared by onboarding (create) and settings (edit). */
export function OrganizationFields({
  values,
  onChange,
  errors,
  baseCurrencyLocked = false,
}: {
  values: OrganizationValues;
  onChange: (values: OrganizationValues) => void;
  errors: FieldErrors;
  baseCurrencyLocked?: boolean;
}) {
  const t = useTranslations('setup.organization');
  const tMonths = useTranslations('setup.months');
  const set = (field: keyof OrganizationValues) => (value: string) =>
    onChange({ ...values, [field]: value });
  const text = (field: keyof OrganizationValues, props: { dir?: 'ltr'; type?: string } = {}) => (
    <Input
      id={field}
      value={values[field]}
      onChange={(e) => set(field)(e.target.value)}
      aria-invalid={errors[field] ? true : undefined}
      aria-describedby={errors[field] ? `${field}-error` : undefined}
      {...props}
    />
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">{t('profileSection')}</h2>
        <Field id="nameAr" label={t('nameAr')} errors={errors}>
          <Input
            id="nameAr"
            dir="rtl"
            lang="ar"
            required
            value={values.nameAr}
            onChange={(e) => set('nameAr')(e.target.value)}
            aria-invalid={errors.nameAr ? true : undefined}
          />
        </Field>
        <Field id="nameEn" label={t('nameEn')} errors={errors}>
          <Input
            id="nameEn"
            dir="ltr"
            lang="en"
            required
            value={values.nameEn}
            onChange={(e) => set('nameEn')(e.target.value)}
            aria-invalid={errors.nameEn ? true : undefined}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="address" label={t('address')} errors={errors}>
            <Textarea
              id="address"
              rows={2}
              value={values.address}
              onChange={(e) => set('address')(e.target.value)}
            />
          </Field>
        </div>
        <Field id="phone" label={t('phone')} errors={errors}>
          {text('phone', { dir: 'ltr', type: 'tel' })}
        </Field>
        <Field id="email" label={t('email')} errors={errors}>
          {text('email', { dir: 'ltr', type: 'email' })}
        </Field>
        <Field id="website" label={t('website')} errors={errors}>
          {text('website', { dir: 'ltr', type: 'url' })}
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="text-base font-semibold sm:col-span-2">{t('financeSection')}</h2>
        <Field
          id="baseCurrency"
          label={t('baseCurrency')}
          hint={baseCurrencyLocked ? t('baseCurrencyLocked') : t('baseCurrencyHint')}
          errors={errors}
        >
          <Select
            value={values.baseCurrency}
            onValueChange={set('baseCurrency')}
            disabled={baseCurrencyLocked}
          >
            <SelectTrigger id="baseCurrency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          id="doaReferenceCurrency"
          label={t('doaReferenceCurrency')}
          hint={t('doaReferenceCurrencyHint')}
          errors={errors}
        >
          <Select value={values.doaReferenceCurrency} onValueChange={set('doaReferenceCurrency')}>
            <SelectTrigger id="doaReferenceCurrency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="fiscalYearStartMonth" label={t('fiscalYearStartMonth')} errors={errors}>
          <Select value={values.fiscalYearStartMonth} onValueChange={set('fiscalYearStartMonth')}>
            <SelectTrigger id="fiscalYearStartMonth">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m) => (
                <SelectItem key={m} value={m}>
                  {tMonths(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="timezone" label={t('timezone')} hint={t('timezoneHint')} errors={errors}>
          {text('timezone', { dir: 'ltr' })}
        </Field>
        <Field
          id="maxBackdateDays"
          label={t('maxBackdateDays')}
          hint={t('maxBackdateDaysHint')}
          errors={errors}
        >
          <Input
            id="maxBackdateDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            dir="ltr"
            value={values.maxBackdateDays}
            onChange={(e) => set('maxBackdateDays')(e.target.value)}
            aria-invalid={errors.maxBackdateDays ? true : undefined}
          />
        </Field>
      </section>
    </div>
  );
}

/** Validates create-mode values with the shared schema; returns the body or field errors. */
export function parseCreate(values: OrganizationValues, extra: Record<string, string> = {}) {
  const filled = Object.fromEntries(Object.entries(extra).filter(([, v]) => v.trim() !== ''));
  const result = createTenantBody.safeParse({ ...toRequest(values), ...filled });
  return result.success
    ? ({ ok: true, body: result.data } as const)
    : ({ ok: false, errors: zodFieldErrors(result.error) } as const);
}

function LogoUpload({ profile }: { profile: TenantProfile }) {
  const t = useTranslations('setup.organization');
  const apiError = useApiError();
  const upload = useUploadLogo();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type) || file.size > LOGO_MAX_BYTES) {
      setError(t('logoInvalid'));
      return;
    }
    upload.mutate(file, {
      onSuccess: () => toast({ description: t('logoUploaded') }),
      onError: (err) => setError(apiError(err)),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
        {profile.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={profile.logoUrl} alt={t('logo')} className="h-full w-full object-contain" />
        ) : (
          <span className="px-1 text-center text-xs text-muted-foreground">{t('noLogo')}</span>
        )}
      </div>
      <div className="space-y-1">
        <input
          ref={input}
          type="file"
          accept={LOGO_MIME_TYPES.join(',')}
          className="sr-only"
          id="logo"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload className="me-2 h-4 w-4" aria-hidden />
          {t('uploadLogo')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('logoHint')}</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Settings → Organization: edit the profile and the logo. */
export function OrganizationForm({ profile }: { profile: TenantProfile }) {
  const t = useTranslations('setup');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const update = useUpdateTenant();
  const [values, setValues] = useState(() => fromProfile(profile));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const body = toRequest(values);
    if (!profile.baseCurrencyEditable) delete (body as Partial<typeof body>).baseCurrency;
    const result = updateTenantBody.safeParse(body);
    if (!result.success) {
      setErrors(zodFieldErrors(result.error));
      return;
    }
    setErrors({});
    update.mutate(result.data, {
      onSuccess: (saved) => {
        setValues(fromProfile(saved));
        toast({ description: t('saved') });
      },
      onError: (err) => {
        setErrors(apiFieldErrors(err));
        setFormError(apiError(err));
      },
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('organization.logo')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LogoUpload profile={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <OrganizationFields
            values={values}
            onChange={setValues}
            errors={errors}
            baseCurrencyLocked={!profile.baseCurrencyEditable}
          />
        </CardContent>
      </Card>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={update.isPending}>
        {tCommon('save')}
      </Button>
    </form>
  );
}
