'use client';

// Fields shared by the invite and edit dialogs: bilingual names, position title, org-wide access,
// offices and roles.
import { Checkbox, Input, Label } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useBilingual, useOffices, useRoles } from './api';

export interface UserFormValues {
  email: string;
  fullNameAr: string;
  fullNameEn: string;
  positionTitle: string;
  orgWideAccess: boolean;
  officeIds: string[];
  roleIds: string[];
}

export const emptyUserForm: UserFormValues = {
  email: '',
  fullNameAr: '',
  fullNameEn: '',
  positionTitle: '',
  orgWideAccess: false,
  officeIds: [],
  roleIds: [],
};

/** field path → i18n message key under `users.fieldErrors` */
export type FieldErrors = Partial<Record<string, string>>;

/** Zod issues or API `VALIDATION_ERROR` details → first message per top-level field. */
export function toFieldErrors(
  issues: readonly { field?: string; path?: (string | number)[]; message: string }[]
): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const field = (issue.field ?? issue.path?.join('.') ?? '').split('.')[0] ?? '';
    if (field && !out[field]) out[field] = issue.message;
  }
  return out;
}

/** Server codes (`already_member`, …) first, then a per-field text, then a generic one. */
export function useFieldErrorText() {
  const t = useTranslations('users');
  return (field: string, message: string | undefined): string => {
    if (message && t.has(`fieldErrors.${message}`)) return t(`fieldErrors.${message}`);
    if (t.has(`fieldErrors.byField.${field}`)) return t(`fieldErrors.byField.${field}`);
    return t('fieldErrors.invalid');
  };
}

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

export function UserFormFields({
  values,
  onChange,
  errors,
  emailEditable,
}: {
  values: UserFormValues;
  onChange: (values: UserFormValues) => void;
  errors: FieldErrors;
  emailEditable: boolean;
}) {
  const t = useTranslations('users');
  const name = useBilingual();
  const { data: roles } = useRoles();
  const { data: offices } = useOffices();
  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const errorText = useFieldErrorText();
  const error = (field: string) =>
    errors[field] ? (
      <p role="alert" className="text-sm text-destructive">
        {errorText(field, errors[field])}
      </p>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="user-email">{t('email')}</Label>
        <Input
          id="user-email"
          type="email"
          dir="ltr"
          autoComplete="off"
          disabled={!emailEditable}
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
        />
        {error('email')}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="user-name-ar">{t('fullNameAr')}</Label>
          <Input
            id="user-name-ar"
            dir="rtl"
            lang="ar"
            value={values.fullNameAr}
            onChange={(e) => set('fullNameAr', e.target.value)}
          />
          {error('fullNameAr')}
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-name-en">{t('fullNameEn')}</Label>
          <Input
            id="user-name-en"
            dir="ltr"
            lang="en"
            value={values.fullNameEn}
            onChange={(e) => set('fullNameEn', e.target.value)}
          />
          {error('fullNameEn')}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-position">{t('positionTitle')}</Label>
        <Input
          id="user-position"
          value={values.positionTitle}
          onChange={(e) => set('positionTitle', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('positionTitleHint')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('roles')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles?.data.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={values.roleIds.includes(role.id)}
                onCheckedChange={(on) =>
                  set('roleIds', toggle(values.roleIds, role.id, on === true))
                }
              />
              {name(role)}
            </label>
          ))}
        </div>
        {error('roleIds')}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('offices')}</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.orgWideAccess}
            onCheckedChange={(on) => set('orgWideAccess', on === true)}
          />
          {t('orgWideAccess')}
        </label>
        <p className="text-xs text-muted-foreground">{t('orgWideAccessHint')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {offices?.data.map((office) => (
            <label key={office.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                disabled={values.orgWideAccess}
                checked={values.orgWideAccess || values.officeIds.includes(office.id)}
                onCheckedChange={(on) =>
                  set('officeIds', toggle(values.officeIds, office.id, on === true))
                }
              />
              <span dir="ltr" className="font-mono text-xs">
                {office.code}
              </span>
              {name(office)}
            </label>
          ))}
        </div>
        {error('officeIds')}
      </fieldset>
    </div>
  );
}
