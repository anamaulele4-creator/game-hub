import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Termos de Uso · GAME HUB', description: 'Termos de Uso do GAME HUB.' };

export default function P() {
  return (
    <Page title="Termos de Uso" back="/legal">
      <PolicyView slug="termos" />
      <LegalFooter />
    </Page>
  );
}
