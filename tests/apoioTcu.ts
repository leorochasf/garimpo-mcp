import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** As 33 colunas do cabeçalho real do arquivo anual do TCU (relatório de 2026-10-14). */
export const COLUNAS_TCU = [
  "KEY", "TIPO", "TITULO", "NUMACORDAO", "ANOACORDAO", "NUMATA", "COLEGIADO", "DATASESSAO", "RELATOR", "SITUACAO",
  "PROC", "ACORDAOSRELACIONADOS", "TIPOPROCESSO", "INTERESSADOS", "ENTIDADE", "RELATORDELIBERACAORECORRIDA",
  "MINISTROREVISOR", "MINISTROAUTORVOTOVENCEDOR", "REPRESENTANTEMP", "UNIDADETECNICA", "ADVOGADO", "ASSUNTO", "SUMARIO",
  "ACORDAO", "DECISAO", "QUORUM", "MINISTROALEGOUIMPEDIMENTOSESSAO", "RECURSOS", "RELATORIO", "VOTO", "DECLARACAOVOTO",
  "VOTOCOMPLEMENTAR", "VOTOMINISTROREVISOR",
] as const;

export type RegistroTcu = Partial<Record<(typeof COLUNAS_TCU)[number], string>>;

const campo = (v = "") => `"${v.replaceAll('"', '""')}"`;

/** CSV no formato real: separador `|`, campos entre aspas (aspas dobradas), quebra de linha dentro do campo. */
export function csvDoTcu(registros: RegistroTcu[]): string {
  const linhas = [COLUNAS_TCU.map(campo).join("|")];
  for (const r of registros) linhas.push(COLUNAS_TCU.map((c) => campo(r[c])).join("|"));
  return linhas.join("\n") + "\n";
}

/** Registro fictício de acórdão comum (tipo ACÓRDÃO), com relatório e voto em HTML. */
export function acordaoFicticio(n: number, extra: RegistroTcu = {}): RegistroTcu {
  return {
    KEY: `ACORDAO-COMPLETO-${100000 + n}`,
    TIPO: "ACÓRDÃO",
    TITULO: `ACÓRDÃO ${n}/2025 ATA 40/2025 - PLENÁRIO`,
    NUMACORDAO: String(n),
    ANOACORDAO: "2025",
    NUMATA: "40/2025",
    COLEGIADO: "Plenário",
    DATASESSAO: "08/12/2025",
    RELATOR: "MINISTRO EXEMPLO",
    SITUACAO: "OFICIALIZADO",
    INTERESSADOS: "SEGREDO-INTERESSADO-FICTICIO",
    ADVOGADO: "SEGREDO-ADVOGADO-FICTICIO",
    ASSUNTO: "Licitação",
    SUMARIO: `SUMARIO FICTICIO ${n}. Pregão eletrônico. Sobrepreço em contratação de serviços.`,
    ACORDAO: "<p>VISTOS, relatados e discutidos estes autos.</p>\n<p>ACORDAM os Ministros do Tribunal.</p>",
    DECISAO: "",
    RELATORIO: "<p>Relatório fictício com\nquebra de linha e \"aspas\" dentro do campo.</p>",
    VOTO: `<p class="tCU_-_Rel/Voto_-_Corpo">Voto fictício ${n} sobre sobrepreço.</p>`,
    ...extra,
  };
}

/** Grava o arquivo anual na pasta de dados do TCU, como o baixador deixa. */
export async function gravarAnoTcu(dados: string, ano: number, registros: RegistroTcu[]): Promise<string> {
  const pasta = join(dados, "tcu");
  await mkdir(pasta, { recursive: true });
  const caminho = join(pasta, `acordao-completo-${ano}.csv`);
  await writeFile(caminho, csvDoTcu(registros), "utf8");
  return caminho;
}
