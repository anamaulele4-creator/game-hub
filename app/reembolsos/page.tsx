import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Política de Reembolsos · Social POIPAK', description: 'Política de Reembolsos do Social POIPAK.' };

export default function P() {
  return (
    <Page title="Política de Reembolsos" back="/legal">
      <PolicyView slug="reembolsos" />
      <LegalFooter />
    </Page>
  );
}
