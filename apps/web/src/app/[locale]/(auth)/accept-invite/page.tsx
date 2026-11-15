'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@ngo/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type Phase = 'verifying' | 'ready' | 'invalid' | 'saving';

/**
 * Landing page of the Supabase invitation email (research R17). Establishes the session from the
 * link (hash tokens, PKCE code, or token_hash), lets the user choose a password, then calls
 * GET /me, which activates the membership and sets the active organization.
 */
export default function AcceptInvitePage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    async function establishSession() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const query = new URLSearchParams(window.location.search);
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const code = query.get('code');
      const tokenHash = query.get('token_hash');

      let ok = false;
      if (accessToken && refreshToken) {
        ok = !(
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        ).error;
      } else if (code) {
        ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
      } else if (tokenHash) {
        ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })).error;
      } else {
        ok = !!(await supabase.auth.getSession()).data.session;
      }
      window.history.replaceState(null, '', window.location.pathname);
      setPhase(ok ? 'ready' : 'invalid');
    }
    void establishSession();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError(t('passwordTooShort'));
    if (password !== confirm) return setError(t('passwordMismatch'));
    setError(null);
    setPhase('saving');

    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(tErrors('INTERNAL_ERROR'));
      setPhase('ready');
      return;
    }
    try {
      // activates the invited membership and selects the organization
      await api.get('/me');
      await supabase.auth.refreshSession();
    } catch {
      // the app shell retries GET /me
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('acceptInviteTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {phase === 'verifying' ? (
          <p className="text-sm text-muted-foreground">{t('verifyingInvite')}</p>
        ) : phase === 'invalid' ? (
          <p role="alert" className="text-sm text-destructive">
            {t('inviteLinkInvalid')}
          </p>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit}>
            <p className="text-sm text-muted-foreground">{t('acceptInviteIntro')}</p>
            <div className="space-y-2">
              <Label htmlFor="password">{t('newPassword')}</Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t('confirmPassword')}</Label>
              <Input
                id="confirm"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={phase === 'saving'}>
              {t('setPassword')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
