import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Normas de Segurança Infantil (CSAE) · Social POIPAK', description: 'Normas de Segurança Infantil (CSAE) do Social POIPAK.' };

export default function P() {
  return (
    <Page title="Normas de Segurança Infantil (CSAE)" back="/legal">
      <PolicyView slug="seguranca-infantil" />
      <LegalFooter />
    </Page>
  );
}
