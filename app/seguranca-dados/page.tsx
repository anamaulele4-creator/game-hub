import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Segurança dos Dados · GAME HUB', description: 'Segurança dos Dados do GAME HUB.' };

export default function P() {
  return (
    <Page title="Segurança dos Dados" back="/legal">
      <PolicyView slug="seguranca-dados" />
      <LegalFooter />
    </Page>
  );
}
