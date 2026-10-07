'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Page } from '@/components/ui';

const TIPS: Record<string, string[]> = {
  'M1887': ['Joga perto: até 5 m é letal', 'Combina com gel wall antes do tiro', 'Treina o drag ao centro do corpo'],
  'AWM': ['Posiciona-te em altura', 'Não fiques parado após o disparo', 'Usa mira 4x e respira (segura) antes'],
  'MP40': ['Rusher: entra após granada', 'Spray curto e contínuo', 'Ótima para finais de zona'],
};

export default function CoachPage() {
  const { s } = useStore();
  const [weapon, setWeapon] = useState('M1887');
  const [kd, setKd] = useState(1.8);
  const [analysed, setAnalysed] = useState(false);
  const has = s.plans.includes('coach');
  return (
    <Page title="Coach IA" back="/mais">
      <p className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-center text-[11px] text-amber-200">Demonstração: análise simulada, sem IA real ligada.</p>
      {!has && <Link href="/planos" className="card mb-4 block text-center text-sm">🤖 Ativa o plano <b>Coach IA</b> para análises completas · ver planos</Link>}
      <div className="card mb-4 space-y-3">
        <label className="text-xs text-white/60">Arma principal</label>
        <div className="flex gap-2">{Object.keys(TIPS).map((w) => <button key={w} onClick={() => setWeapon(w)} className={`flex-1 rounded-lg py-2 text-sm ${weapon === w ? 'bg-neon' : 'bg-panel2'}`}>{w}</button>)}</div>
        <label className="text-xs text-white/60">K/D das últimas partidas: {kd.toFixed(1)}</label>
        <input type="range" min={0.2} max={5} step={0.1} value={kd} onChange={(e) => setKd(Number(e.target.value))} className="w-full accent-fuchsia-500" />
        <button className="btn w-full" onClick={() => setAnalysed(true)}>Analisar</button>
      </div>
      {analysed && (
        <div className="card space-y-2">
          <p className="font-semibold">📋 Plano de treino para esta semana</p>
          <p className="text-sm text-white/80">{kd < 1 ? 'Foco em sobrevivência: menos confrontos, melhor posição.' : kd < 2.5 ? 'Bom equilíbrio. Vamos afinar a mira e as rotações.' : 'Nível alto! Treina liderança de squad e chamadas.'}</p>
          <ul className="list-inside list-disc text-sm">{TIPS[weapon].slice(0, has ? 3 : 1).map((t) => <li key={t}>{t}</li>)}</ul>
          {!has && <p className="text-xs text-white/50">+2 dicas e plano diário com o plano Coach IA.</p>}
          <p className="text-xs text-white/50">Lembra-te: 3 sessões de 30 min valem mais que 1 de 3 horas 💜</p>
        </div>
      )}
    </Page>
  );
}
