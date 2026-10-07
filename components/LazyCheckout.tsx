'use client';

import dynamic from 'next/dynamic';

// O checkout só é descarregado quando é preciso (não pesa no primeiro carregamento das páginas).
export const CheckoutSheet = dynamic(() => import('./Checkout').then((m) => m.CheckoutSheet), { ssr: false });
