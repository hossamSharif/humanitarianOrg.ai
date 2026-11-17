'use client';

import { DOC_TYPE_CODES, type DocTypeCode } from '@ngo/shared';
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useNumbering } from '@/features/setup/api';
import { NumberingForm } from '@/features/setup/numbering-form';
import { SetupPage } from '@/features/setup/setup-page';

export default function NumberingSetupPage() {
  const t = useTranslations('setup.numbering');
  const tDocs = useTranslations('documents.docTypes');
  const [docType, setDocType] = useState<DocTypeCode>('PR');
  const numbering = useNumbering(docType);

  return (
    <SetupPage title={t('title')} intro={t('intro')} query={numbering}>
      {(config) => (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="numbering-doc-type">{t('docType')}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocTypeCode)}>
              <SelectTrigger id="numbering-doc-type" className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code} — {tDocs(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* remount per type so the form starts from that type's stored format */}
          <NumberingForm key={config.docType} config={config} />
        </div>
      )}
    </SetupPage>
  );
}
