'use client';

import { Card, CardDescription, CardHeader, CardTitle } from '@ngo/ui';
import { Building2, Hash, MapPin, Ruler, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

const SECTIONS: { key: 'organization' | 'offices' | 'units' | 'numbering'; icon: LucideIcon }[] = [
  { key: 'organization', icon: Building2 },
  { key: 'offices', icon: MapPin },
  { key: 'units', icon: Ruler },
  { key: 'numbering', icon: Hash },
];

/** Settings hub (nav "Settings"). */
export default function SetupIndexPage() {
  const t = useTranslations('setup');

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ key, icon: Icon }) => (
          <Link key={key} href={`/setup/${key}`} className="rounded-lg focus-visible:outline-none">
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  {t(`${key}.title`)}
                </CardTitle>
                <CardDescription>{t(`${key}.intro`)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
