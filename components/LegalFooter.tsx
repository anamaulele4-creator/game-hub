import Link from 'next/link';
import { POLICY_LINKS } from '@/lib/policies';
import { CONTACT_EMAIL } from '@/lib/config';

export function LegalFooter() {
  return (
    <footer className="mt-8 border-t border-line pt-4 text-center text-xs text-white/50">
      <nav className="mb-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {POLICY_LINKS.map((l) => <Link key={l.href} href={l.href} className="hover:text-neon2">{l.label}</Link>)}
        <Link href="/legal" className="hover:text-neon2">Centro legal</Link>
      </nav>
      <p>Contacto: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> · 18+ · Feito em Moçambique </p>
    </footer>
  );
}
