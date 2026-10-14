/** Entrada de `vite-node scripts/rodarMedirPertoDe.ts <pasta banco-de-provas-resultados>`: ver medirPertoDe.ts. */

import { carregarMarcadas, medirTudo, resumo } from "./medirPertoDe.js";

const pasta = process.argv[2];
if (!pasta) {
  console.error("Uso: npx vite-node scripts/rodarMedirPertoDe.ts <pasta banco-de-provas-resultados>");
  process.exit(2);
}
console.log(resumo(medirTudo(await carregarMarcadas(pasta))));
