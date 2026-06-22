import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0D10',
        panel: '#111317',
        line: 'rgba(255,255,255,0.1)',
        brand: {
          cyan: '#22D3EE',
          indigo: '#6366F1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 24px 80px rgba(34, 211, 238, 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
