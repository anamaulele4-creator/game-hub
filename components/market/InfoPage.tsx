'use client';

import Link from 'next/link';
import { Page } from '@/components/ui';
import { MarketNav } from './Kit';

export function InfoPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Page title={title} back="/marketplace">
      <div className="bx max-w-2xl">
        <MarketNav active="info" />
        <article className="bx-card space-y-3 p-5 text-[14.5px] leading-relaxed [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-bold">{children}</article>
        <p className="bx-dim mt-4 flex flex-wrap gap-x-4 text-[12.5px]">
          <Link href="/marketplace/como-funciona" className="min-h-[44px] content-center">Como funciona</Link>
          <Link href="/marketplace/tarifas" className="min-h-[44px] content-center">Tarifas e prazos</Link>
          <Link href="/marketplace/reembolsos" className="min-h-[44px] content-center">Política de reembolso</Link>
        </p>
      </div>
    </Page>
  );
}
