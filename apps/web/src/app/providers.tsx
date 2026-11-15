'use client';

import { Toaster } from '@ngo/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '@/lib/api-client';

interface ProvidersProps {
  locale: string;
  messages: AbstractIntlMessages;
  timeZone: string;
  children: ReactNode;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // client errors (4xx) are answers, not outages: do not retry them
        retry: (failureCount, error) =>
          !(error instanceof ApiRequestError && error.status < 500) && failureCount < 2,
      },
    },
  });
}

export function Providers({ locale, messages, timeZone, children }: ProvidersProps) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}
