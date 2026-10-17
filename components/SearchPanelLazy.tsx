'use client';

import dynamic from 'next/dynamic';

export const SearchPanel = dynamic(
  () => import('./SearchPanel').then((m) => m.SearchPanel),
  { ssr: false },
);