import createNextIntlPlugin from 'next-intl/plugin';

// next-intl request config (locales, messages) lives in src/i18n.ts.
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ngo/ui', '@ngo/shared'],
  // ESLint runs from the root flat config (`pnpm lint`), not during `next build`.
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(nextConfig);
