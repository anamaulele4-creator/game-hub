import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Diretrizes da Comunidade · Social POIPAK', description: 'Diretrizes da Comunidade do Social POIPAK.' };

export default function P() {
  return (
    <Page title="Diretrizes da Comunidade" back="/legal">
      <PolicyView slug="diretrizes" />
      <LegalFooter />
    </Page>
  );
}
