// Copia lib/core/stats.ts para a Edge Function (mesmos cálculos no cliente e no servidor).
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../lib/core/stats.ts', import.meta.url), new URL('../supabase/functions/_shared/core-stats.ts', import.meta.url));
console.log('core-stats sincronizado');
