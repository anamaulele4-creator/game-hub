import { DEMO_IDS } from '@/lib/data';
import ClipDetail from './ClipDetail';

// Páginas pré-geradas para os IDs da demo. Em modo real, conteúdos novos (UUID) abrem pela página 404 inteligente (app/not-found.tsx).
export function generateStaticParams() {
  return DEMO_IDS.clips.map((id) => ({ id }));
}

export default function Page({ params }: { params: { id: string } }) {
  return <ClipDetail id={params.id} />;
}
