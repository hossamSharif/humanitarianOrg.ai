'use client';

import {
  formatDocumentNumber,
  numberingConfigBody,
  type NumberingConfigInput,
  type NumberingConfigResponse,
} from '@ngo/shared';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@ngo/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useApiError } from '@/lib/use-api-error';
import { apiFieldErrors, useSaveNumbering, zodFieldErrors, type FieldErrors } from './api';
import { FieldMessage } from './field-message';

const SEPARATORS = ['-', '/', '_', '.', ''] as const;
/** Select items cannot have an empty value. */
const NO_SEPARATOR = 'none';

function draftFrom(config: NumberingConfigResponse): NumberingConfigInput {
  const { prefix, includeOffice, includeYear, padding, separator } = config;
  return { prefix, includeOffice, includeYear, padding, separator };
}

/** PR number format with a live preview; changes affect future numbers only (FR-005). */
export function NumberingForm({ config }: { config: NumberingConfigResponse }) {
  const t = useTranslations('setup.numbering');
  const tCommon = useTranslations('common');
  const apiError = useApiError();
  const save = useSaveNumbering(config.docType);
  const [draft, setDraft] = useState(() => draftFrom(config));
  const [errors, setErrors] = useState<FieldErrors>({});

  const parsed = numberingConfigBody.safeParse(draft);
  const { officeCode, year, seq } = config.previewParts;
  const preview = parsed.success ? formatDocumentNumber(parsed.data, officeCode, year, seq) : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(config));

  function set<K extends keyof NumberingConfigInput>(field: K, value: NumberingConfigInput[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: (saved) => {
        setDraft(draftFrom(saved));
        toast({ description: t('saved') });
      },
      onError: (err) => {
        setErrors(apiFieldErrors(err));
        toast({ variant: 'destructive', description: apiError(err) });
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardContent className="space-y-1 pt-6">
          <p className="text-sm text-muted-foreground">{t('preview')}</p>
          <p className="font-mono text-2xl font-semibold" dir="ltr" aria-live="polite">
            {preview ?? config.preview}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('previewHint', { office: officeCode, current: config.preview })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="prefix">{t('prefix')}</Label>
            <Input
              id="prefix"
              dir="ltr"
              className="font-mono"
              maxLength={10}
              value={draft.prefix}
              onChange={(e) => set('prefix', e.target.value)}
            />
            <FieldMessage errors={errors} field="prefix" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="separator">{t('separator')}</Label>
            <Select
              value={draft.separator === '' ? NO_SEPARATOR : draft.separator}
              onValueChange={(v) => set('separator', v === NO_SEPARATOR ? '' : v)}
            >
              <SelectTrigger id="separator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEPARATORS.map((s) => (
                  <SelectItem key={s || NO_SEPARATOR} value={s || NO_SEPARATOR}>
                    {s === '' ? t('separatorNone') : s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="padding">{t('padding')}</Label>
            <Input
              id="padding"
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={1}
              max={10}
              value={Number.isNaN(draft.padding) ? '' : draft.padding}
              onChange={(e) => set('padding', e.target.valueAsNumber)}
            />
            <p className="text-xs text-muted-foreground">{t('paddingHint')}</p>
            <FieldMessage errors={errors} field="padding" />
          </div>
          <div className="space-y-3 pt-1 sm:pt-7">
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeOffice"
                checked={draft.includeOffice}
                onCheckedChange={(c) => set('includeOffice', c === true)}
              />
              <Label htmlFor="includeOffice">{t('includeOffice')}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeYear"
                checked={draft.includeYear}
                onCheckedChange={(c) => set('includeYear', c === true)}
              />
              <Label htmlFor="includeYear">{t('includeYear')}</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {t('futureOnly')}
      </p>
      <Button type="submit" disabled={save.isPending || !dirty}>
        {tCommon('save')}
      </Button>
    </form>
  );
}
