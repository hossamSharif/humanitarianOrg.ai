'use client';

// Create or edit a role: bilingual name and a permission checklist grouped by resource, with the
// catalogue's descriptions in the current locale (GET /permissions).
import { permissionResource, roleCreate, type Permission, type Role } from '@ngo/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { usePermissionCatalogue, useSaveRole } from './api';
import { toFieldErrors, useFieldErrorText, type FieldErrors } from './user-form-fields';

export function RoleEditor({
  role,
  open,
  onOpenChange,
}: {
  /** null = new role */
  role: Role | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('roles');
  const tPermissions = useTranslations('permissions');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const apiError = useApiError();
  const errorText = useFieldErrorText();
  const { data: catalogue } = usePermissionCatalogue();
  const save = useSaveRole();
  const [nameAr, setNameAr] = useState(role?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(role?.nameEn ?? '');
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [errors, setErrors] = useState<FieldErrors>({});

  const groups = useMemo(() => {
    const byResource = new Map<string, NonNullable<typeof catalogue>['data']>();
    for (const p of catalogue?.data ?? []) {
      const key = permissionResource(p.code);
      byResource.set(key, [...(byResource.get(key) ?? []), p]);
    }
    return [...byResource.entries()];
  }, [catalogue]);

  function toggle(code: Permission, on: boolean) {
    setPermissions((list) => (on ? [...new Set([...list, code])] : list.filter((c) => c !== code)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = roleCreate.safeParse({ nameAr, nameEn, permissions });
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ id: role?.id, body: parsed.data });
      toast({ description: t('saved') });
      onOpenChange(false);
    } catch (err) {
      toast({ variant: 'destructive', description: apiError(err) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{role ? t('editTitle') : t('createTitle')}</DialogTitle>
            <DialogDescription>{t('editorIntro')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-name-ar">{t('nameAr')}</Label>
              <Input
                id="role-name-ar"
                dir="rtl"
                lang="ar"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
              />
              {errors.nameAr ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorText('nameAr', errors.nameAr)}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-name-en">{t('nameEn')}</Label>
              <Input
                id="role-name-en"
                dir="ltr"
                lang="en"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
              />
              {errors.nameEn ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorText('nameEn', errors.nameEn)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium">{t('permissions')}</p>
            {groups.map(([resource, items]) => (
              <fieldset key={resource} className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-semibold">
                  {tPermissions.has(`groups.${resource}`)
                    ? tPermissions(`groups.${resource}`)
                    : resource}
                </legend>
                {items.map((p) => (
                  <label key={p.code} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={permissions.includes(p.code)}
                      onCheckedChange={(on) => toggle(p.code, on === true)}
                    />
                    <span>
                      <span className="block">
                        {locale === 'ar' ? p.descriptionAr : p.descriptionEn}
                      </span>
                      <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
