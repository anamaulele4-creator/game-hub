import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Diretrizes da Comunidade · GAME HUB', description: 'Diretrizes da Comunidade do GAME HUB.' };

export default function P() {
  return (
    <Page title="Diretrizes da Comunidade" back="/legal">
      <PolicyView slug="diretrizes" />
      <LegalFooter />
    </Page>
  );
}
