import { LIVES } from '@/lib/data';
import LiveRoom from './LiveRoom';

export function generateStaticParams() {
  return LIVES.map((l) => ({ id: l.id }));
}

export default function Page({ params }: { params: { id: string } }) {
  return <LiveRoom id={params.id} />;
}
