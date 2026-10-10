/** Entrada de `vite-node scripts/rodarMedirAvisos.ts montar|medir <pasta>`: a medição cega dos avisos (ver medirAvisos.ts). */

import { principal } from "./medirAvisos.js";

process.exitCode = await principal(process.argv.slice(2));
