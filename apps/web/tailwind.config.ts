import ngoPreset from '@ngo/ui/tailwind.preset';
import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [ngoPreset],
  content: ['./src/**/*.{ts,tsx,mdx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
