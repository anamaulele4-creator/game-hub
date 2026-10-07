import { TOURNAMENTS } from '@/lib/data';
import TournamentDetail from './TournamentDetail';

export function generateStaticParams() {
  return [...TOURNAMENTS.map((t) => t.id), 'n1', 'n2', 'n3', 'n4', 'n5'].map((id) => ({ id }));
}

export default function Page({ params }: { params: { id: string } }) {
  return <TournamentDetail id={params.id} />;
}
