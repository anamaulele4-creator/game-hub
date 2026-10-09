import type { Config } from 'tailwindcss';

// Design system TXAPILOG — todos os tokens vêm de variáveis CSS definidas em app/globals.css (:root).
// As cores usam canais RGB para que as opacidades do Tailwind (bg-panel/80, border-neon/40…) continuem a funcionar.
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca TXAPILOG: azul royal + amarelo + branco
        bg: rgb('--c-bg'),
        panel: rgb('--c-panel'),
        panel2: rgb('--c-panel2'),
        line: rgb('--c-line'),
        neon: rgb('--c-accent'),
        neon2: rgb('--c-accent2'),
        neon3: rgb('--c-accent3'),
        ink: rgb('--c-ink'),
        royal: rgb('--c-royal'),
        pink: rgb('--c-warm'),
        lime: rgb('--c-soft'),
        danger: rgb('--c-danger'),
        ok: rgb('--c-ok'),
        // AI CORE: variante mais escura da marca (painel de inteligência)
        core: { bg: '#0B1B4D', panel: '#10256A', panel2: '#173080', line: '#284A9E' },
        // TXAPZONE (/jogos): escuro + laranja
        tz: { bg: '#0E0E10', card: '#18181B', card2: '#222226', line: '#2A2A2F', accent: '#FF6B1A' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.2rem' }],
        sm: ['0.9375rem', { lineHeight: '1.45rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }],
      },
      borderRadius: {
        chip: 'var(--r-chip)',
        ctl: 'var(--r-ctl)',
        card: 'var(--r-card)',
        sheet: 'var(--r-sheet)',
      },
      boxShadow: {
        e1: 'var(--sh-1)',
        e2: 'var(--sh-2)',
        e3: 'var(--sh-3)',
        glow: 'var(--glow)',
        neon: 'var(--sh-1)',
        cyan: 'var(--sh-1)',
      },
      maxWidth: {
        col: 'var(--col-w)',
        prose: '40rem',
      },
      spacing: {
        tap: '44px',
        bnav: 'var(--bnav-h)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.2,.8,.2,1)',
      },
      keyframes: {
        pulseGlow: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
        floatUp: { '0%': { transform: 'translateY(0) scale(1)', opacity: '1' }, '100%': { transform: 'translateY(-120px) scale(1.6)', opacity: '0' } },
        gradientMove: { '0%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' }, '100%': { backgroundPosition: '0% 50%' } },
        pop: { '0%': { transform: 'scale(0)', opacity: '0' }, '40%': { transform: 'scale(1.3)', opacity: '1' }, '100%': { transform: 'scale(1)', opacity: '0' } },
        sheetIn: { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'none', opacity: '1' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: {
        pulseGlow: 'pulseGlow 1.6s ease-in-out infinite',
        floatUp: 'floatUp 1.4s ease-out forwards',
        gradientMove: 'gradientMove 6s ease infinite',
        pop: 'pop .9s ease-out forwards',
        sheetIn: 'sheetIn .22s cubic-bezier(.2,.8,.2,1) both',
        fadeIn: 'fadeIn .18s ease-out both',
      },
    },
  },
  plugins: [],
};
export default config;
