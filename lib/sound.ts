'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'gh_sound_on';
// Som dos clipes: começa sem som (regra dos navegadores), mas depois do 1.º toque fica ligado e é lembrado.
export function useClipSound(): [boolean, (m: boolean) => void] {
  const [muted, setM] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(KEY) === '1') setM(false); } catch {} }, []);
  const setMuted = useCallback((m: boolean) => { setM(m); try { localStorage.setItem(KEY, m ? '0' : '1'); } catch {} }, []);
  return [muted, setMuted];
}
