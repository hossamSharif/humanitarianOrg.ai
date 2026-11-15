'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@ngo/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type Status = 'idle' | 'busy' | 'linkSent' | 'invalidCredentials' | 'error';

export default function LoginPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function signInWithPassword(event: FormEvent) {
    event.preventDefault();
    setStatus('busy');
    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(error.status === 400 ? 'invalidCredentials' : 'error');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  async function sendMagicLink() {
    if (!email) return;
    setStatus('busy');
    const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/${locale}` },
    });
    setStatus(error ? 'error' : 'linkSent');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('signInTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={signInWithPassword}>
          <div className="space-y-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {status === 'invalidCredentials' ? (
            <p role="alert" className="text-sm text-destructive">
              {t('invalidCredentials')}
            </p>
          ) : null}
          {status === 'error' ? (
            <p role="alert" className="text-sm text-destructive">
              {tErrors('INTERNAL_ERROR')}
            </p>
          ) : null}
          {status === 'linkSent' ? (
            <p role="status" className="text-sm text-primary">
              {t('magicLinkSent')}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={status === 'busy'}>
            {t('signIn')}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t('or')}</p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={status === 'busy' || !email}
            onClick={sendMagicLink}
          >
            {t('sendMagicLink')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
