import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm paper / cream backgrounds
        paper: {
          DEFAULT: '#f7f4ec',
          50: '#fdfcf9',
          100: '#f7f4ec',
          200: '#efe9da',
          300: '#e3d9c3',
        },
        // Deep racing green
        racing: {
          DEFAULT: '#0f3d2e',
          50: '#eef4f1',
          100: '#d4e3dc',
          600: '#1d5a44',
          700: '#164635',
          800: '#0f3d2e',
          900: '#0a2b20',
        },
        // Ink / charcoal for text
        ink: {
          DEFAULT: '#1c1b18',
          500: '#5c5953',
          600: '#46443f',
          700: '#33312c',
          800: '#26241f',
          900: '#1c1b18',
        },
        // Metallic brass / gold accent
        brass: {
          DEFAULT: '#b08642',
          50: '#faf5ea',
          100: '#f1e4c8',
          200: '#e4cd97',
          400: '#c79a52',
          500: '#b08642',
          600: '#946d33',
          700: '#74552a',
        },
      },
      fontFamily: {
        serif: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tightish: '-0.01em',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,27,24,0.04), 0 8px 24px -12px rgba(28,27,24,0.18)',
        cardHover: '0 2px 4px rgba(28,27,24,0.06), 0 16px 36px -14px rgba(28,27,24,0.28)',
      },
    },
  },
  plugins: [],
} satisfies Config;
