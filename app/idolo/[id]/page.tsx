import { IDOLS } from '@/lib/data';
import IdolProfile from './IdolProfile';

export function generateStaticParams() {
  return IDOLS.map((i) => ({ id: i.id }));
}

export default function Page({ params }: { params: { id: string } }) {
  return <IdolProfile id={params.id} />;
}
