import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/features/shell/locale-switcher';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="w-full max-w-sm">{children}</div>
      <LocaleSwitcher />
    </main>
  );
}
