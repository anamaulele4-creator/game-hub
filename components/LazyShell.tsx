'use client';

import dynamic from 'next/dynamic';

const SystemOverlays = dynamic(() => import('./SystemOverlays'), { ssr: false });

export function LazyShell() {
  return <SystemOverlays />;
}
