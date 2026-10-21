import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Diretrizes da Comunidade · TxapZone', description: 'Diretrizes da Comunidade da TxapZone.' };

export default function P() {
  return (
    <Page title="Diretrizes da Comunidade" back="/legal">
      <PolicyView slug="diretrizes" />
      <LegalFooter />
    </Page>
  );
}
