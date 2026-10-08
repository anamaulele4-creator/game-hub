import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#121417',
        panel: '#1a1d21',
        panel2: '#23272d',
        line: '#30353c',
        neon: '#3d85c6',
        neon2: '#8ab9de',
        pink: '#e08585',
        lime: '#86c79b',
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
