import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca TXAPILOG: azul royal + amarelo + branco
        bg: '#162F78',
        panel: '#1D3A8C',
        panel2: '#26469E',
        line: '#3A5AB4',
        neon: '#FFC20E',
        neon2: '#FFD65C',
        neon3: '#FFEDB3',
        ink: '#0B1B4D',
        royal: '#1E3A8A',
        pink: '#FFB020',
        lime: '#FFE38A',
      },
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.2rem' }],
        sm: ['0.9375rem', { lineHeight: '1.45rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }],
      },
      boxShadow: {
        neon: '0 1px 2px rgba(0,0,0,.25)',
        cyan: '0 1px 2px rgba(0,0,0,.25)',
      },
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
