'use client';

import dynamic from 'next/dynamic';

const SystemOverlays = dynamic(() => import('./SystemOverlays'), { ssr: false });
const PoipakAI = dynamic(() => import('./PoipakAI'), { ssr: false });

export function LazyShell() {
  return <><SystemOverlays /><PoipakAI /></>;
}
