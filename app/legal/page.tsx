import type { Metadata } from 'next';
import Link from 'next/link';
import { Page } from '@/components/ui';
import { Icon } from '@/components/icons';
import { POLICIES } from '@/lib/policies';
import { CONTACT_EMAIL, COMPANY } from '@/lib/config';

export const metadata: Metadata = { title: 'Centro legal · TXAPILOG' };

export default function Legal() {
  return (
    <Page title="Centro legal" back="/definicoes">
      <p className="mb-4 text-sm text-white/70">Políticas do TXAPILOG, operado por {COMPANY}. Contacto: <a className="text-neon2 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
      <div className="space-y-2">
        {POLICIES.map((p) => (
          <Link key={p.slug} href={`/${p.slug}`} className="card flex items-center gap-3 !p-3">
            <Icon name="doc" size={22} className="text-[#FFC107]" />
            <span className="flex-1"><span className="block text-sm font-semibold">{p.title}</span><span className="block text-xs text-white/50">{p.summary}</span></span>
            <span className="text-white/40">›</span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
