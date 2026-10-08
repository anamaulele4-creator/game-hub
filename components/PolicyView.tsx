'use client';

import Link from 'next/link';
import { POLICIES, parsePolicyText, policy } from '@/lib/policies';
import { useStore } from '@/lib/store';
import { CONTACT_EMAIL, POLICY_DATE } from '@/lib/config';

// Renderiza a versão por omissão no HTML estático (para a Google Play e motores de busca)
// e, depois de hidratar, a versão editada no Admin › Políticas (se existir).
export function PolicyView({ slug }: { slug: string }) {
  const { s, ready } = useStore();
  const p = policy(slug);
  const override = ready ? s.admin.policies[slug] : undefined;
  const sections = override ? parsePolicyText(override) : p.sections;
  return (
    <article className="space-y-4 text-sm leading-relaxed">
      <header className="card">
        <p className="text-3xl">{p.emoji}</p>
        <h1 className="mt-1 text-xl font-bold">{p.title}</h1>
        <p className="mt-1 text-white/70">{p.summary}</p>
        <p className="mt-2 text-xs text-white/40">Última atualização: {POLICY_DATE}{override ? ' · versão editada pelo admin' : ''}</p>
      </header>
      {sections.map((sec, i) => (
        <section key={i}>
          {sec.h && <h2 className="mb-1 font-semibold text-neon2">{sec.h}</h2>}
          {sec.p.map((t, j) => <p key={j} className="mb-2 text-white/80">{t}</p>)}
        </section>
      ))}
      <p className="card !p-3 text-xs text-white/60">Dúvidas? Escreve para <a className="text-neon2 underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      <nav className="flex flex-wrap gap-2 text-xs">
        {POLICIES.filter((x) => x.slug !== slug).map((x) => <Link key={x.slug} href={`/${x.slug}`} className="chip">{x.emoji} {x.title}</Link>)}
      </nav>
    </article>
  );
}
