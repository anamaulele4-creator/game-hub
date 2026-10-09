import type { Metadata } from 'next';
import { Page } from '@/components/ui';
import { PolicyView } from '@/components/PolicyView';
import { LegalFooter } from '@/components/LegalFooter';
import { DeletionForm } from './DeletionForm';

export const metadata: Metadata = { title: 'Eliminar conta e dados · TXAPILOG', description: 'Como pedir a eliminação da tua conta TXAPILOG e dos dados associados.' };

export default function P() {
  return (
    <Page title="Eliminar conta" back="/legal">
      <PolicyView slug="eliminar-conta" />
      <DeletionForm />
      <LegalFooter />
    </Page>
  );
}
