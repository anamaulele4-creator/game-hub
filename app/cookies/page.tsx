import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = { title: 'Cookies, Armazenamento e Anúncios · TXAPILOG', description: 'Cookies, Armazenamento e Anúncios do TXAPILOG.' };

export default function P() {
  return (
    <Page title="Cookies, Armazenamento e Anúncios" back="/legal">
      <PolicyView slug="cookies" />
      <LegalFooter />
    </Page>
  );
}
