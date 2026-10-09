import { GAME_KEYS, GameKey } from '@/lib/jogos';
import GamePage from '@/components/jogos/GamePage';

// Uma página estática por categoria (export estático do GitHub Pages).
export function generateStaticParams() {
  return GAME_KEYS.map((game) => ({ game }));
}

export default function Page({ params }: { params: { game: string } }) {
  return <GamePage game={params.game as GameKey} />;
}
