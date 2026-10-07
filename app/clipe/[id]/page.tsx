import { CLIPS } from '@/lib/data';
import ClipDetail from './ClipDetail';

export function generateStaticParams() {
  return CLIPS.map((c) => ({ id: c.id }));
}

export default function Page({ params }: { params: { id: string } }) {
  return <ClipDetail id={params.id} />;
}
