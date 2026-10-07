import { DEMO_IDS } from '@/lib/data';
import IdolProfile from './IdolProfile';

// Páginas pré-geradas para os IDs da demo. Em modo real, conteúdos novos (UUID) abrem pela página 404 inteligente (app/not-found.tsx).
export function generateStaticParams() {
  return DEMO_IDS.idols.map((id) => ({ id }));
}

export default function Page({ params }: { params: { id: string } }) {
  return <IdolProfile id={params.id} />;
}
