/**
 * Tabela de precedentes (ADR-0015): fotografia datada dos temas repetitivos e IAC do conjunto "Precedentes
 * qualificados" do Portal de Dados Abertos do STJ, gerada por scripts/gerarTabela.ts e empacotada em dados/.
 */

/** Rótulos que o Garimpo dá às listas do site; os mesmos aqui, para Tema N e IAC N nunca se trocarem. */
export type TipoNaTabela = "tema repetitivo" | "IAC";

export const ATRIBUICAO = "Fonte: STJ — Portal de Dados Abertos, conjunto Precedentes qualificados";

/** Uma linha da tabela: campos copiados da fonte; campo que a fonte não preenche fica de fora. */
export interface LinhaDaTabela {
  tipo: TipoNaTabela;
  numero: number;
  situacao?: string;
  teseFirmada?: string;
  questaoSubmetida?: string;
  orgaoJulgador?: string;
  dataPrimeiraAfetacao?: string;
  dataJulgamento?: string;
  dataPublicacaoAcordao?: string;
  /** Processos paradigma, só quando a fonte os identifica com segurança (leadingCase, sem desafetados). */
  processosParadigma?: string[];
  sumulaOriginada?: string;
  referenciaSumular?: string;
  /** Temas de repercussão geral do STF ligados (a fonte repete a linha do tema uma vez por número). */
  numerosRepercussaoGeralSTF?: string[];
}

export interface TabelaDePrecedentes {
  fonte: { conjunto: string; portal: string; pagina: string };
  atribuicao: string;
  /** Licença como a página do conjunto a declara, e quando foi conferida. */
  licenca: { declarada: string; conferidaEm: string };
  /** Texto literal "Última Atualização …" da página do conjunto, ou "não informada". */
  atualizacaoDaFonte: { texto: string; pagina: string };
  arquivos: { url: string; coletadoEm: string; sha256: string }[];
  /** Quando a tabela foi gerada (distinta da coleta e da atualização da fonte). */
  geradaEm: string;
  versaoDoGerador: string;
  transformacaoDosTextos: string;
  linhas: LinhaDaTabela[];
}
