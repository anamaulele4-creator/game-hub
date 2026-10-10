import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca TXAPILOG 2026: base "noite royal" + azul royal + amarelo + branco (tokens espelhados em app/globals.css :root)
        bg: '#0A1230',
        panel: '#111D47',
        panel2: '#1A2A5E',
        line: '#26386F',
        surface3: '#22356F',
        neon: '#FFC20E',
        neon2: '#FFD65C',
        neon3: '#FFEDB3',
        ink: '#0B1B4D',
        royal: '#1E3A8A',
        pink: '#FFB020',
        lime: '#FFE38A',
        // AI CORE: variante mais escura da marca (painel de inteligência)
        core: { bg: '#0B1B4D', panel: '#10256A', panel2: '#173080', line: '#284A9E' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      // Escala tipográfica única (12/13/15/16/18/20/24/30)
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.2rem' }],
        sm: ['0.9375rem', { lineHeight: '1.45rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }],
        lg: ['1.125rem', { lineHeight: '1.6rem' }],
        xl: ['1.25rem', { lineHeight: '1.65rem' }],
        '2xl': ['1.5rem', { lineHeight: '1.9rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.2rem' }],
      },
      borderRadius: { card: '20px', ctl: '14px' },
      boxShadow: {
        neon: '0 1px 2px rgba(0,0,0,.25)',
        cyan: '0 1px 2px rgba(0,0,0,.25)',
        e1: '0 1px 2px rgba(2,6,23,.35), 0 1px 1px rgba(2,6,23,.2)',
        e2: '0 8px 24px -8px rgba(2,6,23,.6), 0 2px 6px rgba(2,6,23,.3)',
        e3: '0 24px 60px -20px rgba(2,6,23,.8), 0 8px 20px -8px rgba(2,6,23,.5)',
      },
      screens: { fold: '540px' },
      keyframes: {
        pulseGlow: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
        floatUp: { '0%': { transform: 'translateY(0) scale(1)', opacity: '1' }, '100%': { transform: 'translateY(-120px) scale(1.6)', opacity: '0' } },
        gradientMove: { '0%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' }, '100%': { backgroundPosition: '0% 50%' } },
        pop: { '0%': { transform: 'scale(0)', opacity: '0' }, '40%': { transform: 'scale(1.3)', opacity: '1' }, '100%': { transform: 'scale(1)', opacity: '0' } },
      },
      animation: {
        pulseGlow: 'pulseGlow 1.6s ease-in-out infinite',
        floatUp: 'floatUp 1.4s ease-out forwards',
        gradientMove: 'gradientMove 6s ease infinite',
        pop: 'pop .9s ease-out forwards',
      },
    },
  },
  plugins: [],
};
export default config;
