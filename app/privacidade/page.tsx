import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Política de Privacidade · TXAPILOG', description: 'Política de Privacidade do TXAPILOG.' };

export default function P() {
  return (
    <Page title="Política de Privacidade" back="/legal">
      <PolicyView slug="privacidade" />
      <LegalFooter />
    </Page>
  );
}
