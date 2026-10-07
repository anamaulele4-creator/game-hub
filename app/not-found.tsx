import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-6xl">👾</p><p className="text-lg font-bold">Página não encontrada</p>
      <Link href="/" className="btn">Voltar ao Início</Link>
    </main>
  );
}
