'use client';

import dynamic from 'next/dynamic';

const SystemOverlays = dynamic(() => import('./SystemOverlays'), { ssr: false });
const PoipakAI = dynamic(() => import('./PoipakAI'), { ssr: false });
const ChatLayer = dynamic(() => import('./chat/ChatLayer'), { ssr: false });

export function LazyShell() {
  return <><SystemOverlays /><PoipakAI /><ChatLayer /></>;
}
