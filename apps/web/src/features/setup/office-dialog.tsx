'use client';

import { createOfficeBody, updateOfficeBody, type Office } from '@ngo/shared';
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
  Textarea,
  toast,
} from '@ngo/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { useApiError } from '@/lib/use-api-error';
import { apiFieldErrors, useSaveOffice, zodFieldErrors, type FieldErrors } from './api';
import { FieldMessage } from './field-message';

interface Values {
  code: string;
  nameAr: string;
  nameEn: string;
  address: string;
  phone: string;
  isActive: boolean;
}

function initial(office: Office | null): Values {
  return {
    code: office?.code ?? '',
    nameAr: office?.nameAr ?? '',
    nameEn: office?.nameEn ?? '',
    address: office?.address ?? '',
    phone: office?.phone ?? '',
    isActive: office?.isActive ?? true,
  };
}

/** Add or edit an office. The code is read-only (with the reason) once PRs reference it. */
export function OfficeDialog({
  office,
  open,
  onOpenChange,
}: {
  /** null = add */
  office: Office | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('setup.offices');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveOffice();
  const [values, setValues] = useState(() => initial(office));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [codeLocked, setCodeLocked] = useState(office?.codeLocked ?? false);

  const set = <K extends keyof Values>(field: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [field]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const body = codeLocked ? { ...values, code: undefined } : values;
    const result = (office ? updateOfficeBody : createOfficeBody).safeParse(body);
    if (!result.success) {
      setErrors(zodFieldErrors(result.error));
      return;
    }
    setErrors({});
    save.mutate(
      { id: office?.id, input: result.data },
      {
        onSuccess: () => {
          toast({ description: t('saved') });
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'OFFICE_CODE_IN_USE') {
            setCodeLocked(true);
            set('code', office?.code ?? values.code);
          }
          setErrors(apiFieldErrors(err));
          setFormError(apiError(err));
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{office ? t('editTitle') : t('addTitle')}</DialogTitle>
            <DialogDescription>{t('dialogIntro')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="office-code">{t('code')}</Label>
            <Input
              id="office-code"
              dir="ltr"
              className="font-mono uppercase"
              maxLength={10}
              value={values.code}
              readOnly={codeLocked}
              aria-readonly={codeLocked}
              aria-describedby="office-code-hint"
              onChange={(e) => set('code', e.target.value.toUpperCase())}
            />
            {codeLocked ? (
              <p
                id="office-code-hint"
                className="flex items-start gap-1 text-xs text-muted-foreground"
              >
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {t('codeLocked')}
              </p>
            ) : (
              <p id="office-code-hint" className="text-xs text-muted-foreground">
                {t('codeHint')}
              </p>
            )}
            <FieldMessage errors={errors} field="code" hint="officeCode" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="office-nameAr">{t('nameAr')}</Label>
              <Input
                id="office-nameAr"
                dir="rtl"
                lang="ar"
                value={values.nameAr}
                onChange={(e) => set('nameAr', e.target.value)}
              />
              <FieldMessage errors={errors} field="nameAr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="office-nameEn">{t('nameEn')}</Label>
              <Input
                id="office-nameEn"
                dir="ltr"
                lang="en"
                value={values.nameEn}
                onChange={(e) => set('nameEn', e.target.value)}
              />
              <FieldMessage errors={errors} field="nameEn" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="office-address">{t('address')}</Label>
            <Textarea
              id="office-address"
              rows={2}
              value={values.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="office-phone">{t('phone')}</Label>
            <Input
              id="office-phone"
              type="tel"
              dir="ltr"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="office-active"
              checked={values.isActive}
              onCheckedChange={(checked) => set('isActive', checked === true)}
            />
            <Label htmlFor="office-active">{t('active')}</Label>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
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
