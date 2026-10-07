import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Política de Privacidade · Social POIPAK', description: 'Política de Privacidade do Social POIPAK.' };

export default function P() {
  return (
    <Page title="Política de Privacidade" back="/legal">
      <PolicyView slug="privacidade" />
      <LegalFooter />
    </Page>
  );
}
