import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md, regra 2: nada específico de usuário ou instituição no repositório (processo real, caminho de máquina,
 * e-mail pessoal, credencial). Falha imprime só "arquivo: regra" — nunca o valor achado.
 * Os números reais já encontrados ficam só como hash (dígitos, sem pontuação), para não reaparecerem aqui.
 */
const REAIS_CONHECIDOS = new Set([
  "4c0a2f73da02c7e2d7d15ada1348215a0e6ad68145a28c5bc5ccad8f51b4abe4",
  "ab91aa730965bcfa246a215c6a65632cdadd74c809a005d9b236454e5d9da740",
  "f251dcf576f00282e6f508bc6e6a42a6d0c710bb1d794acabb2a59242f0c92ab",
]);

/** Número no formato do STJ ("1.234.567/SP"); fictícios aceitos: 1.000.00X e 1.234.567. */
const FORMATO_STJ = /\b\d\.\d{3}\.\d{3}\/[A-Z]{2}\b/g;
const FICTICIO_STJ = /^1\.(000\.\d{3}|234\.567)\//;

/**
 * Número CNJ "NNNNNNN-DD.AAAA.J.TR.OOOO"; fictícios aceitos: sequencial com quatro ou mais zeros à esquerda
 * (0000001, 0000123…), 1234567 (dígito verificador livre) ou tribunal 99 (código que não existe).
 */
const FORMATO_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
const FICTICIO_CNJ = /^(0000\d{3}|1234567)-|^\d{7}-\d{2}\.\d{4}\.\d\.99\./;

const CAMINHO_LOCAL = /[A-Za-z]:[\\/]+Users[\\/]|\/Users\/\w|\/home\/\w|One[D]rive/;

const EMAIL = /[\w.+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
/** Domínios de exemplo (RFC 2606) e o endereço de e-mail anônimo do GitHub: não identificam ninguém. */
const DOMINIO_DE_EXEMPLO = /^(example\.(com|org|net)|(.+\.)?(test|invalid|localhost|example)|users\.noreply\.github\.com)$/i;

const CREDENCIAIS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/,
  /(?:password|senha|token|secret|api[_-]?key)["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
];

type Regra = "formato STJ" | "formato CNJ" | "número real conhecido" | "caminho local" | "e-mail" | "credencial";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Regras aplicadas a um texto; devolve só os nomes das regras violadas (nunca o valor). */
function achar(texto: string): Regra[] {
  const regras = new Set<Regra>();
  for (const m of texto.match(FORMATO_STJ) ?? []) if (!FICTICIO_STJ.test(m)) regras.add("formato STJ");
  for (const m of texto.match(FORMATO_CNJ) ?? []) if (!FICTICIO_CNJ.test(m)) regras.add("formato CNJ");
  for (const m of texto.match(/\d[\d.]{4,}\d/g) ?? []) {
    if (REAIS_CONHECIDOS.has(sha(m.replace(/\./g, "")))) regras.add("número real conhecido");
  }
  if (CAMINHO_LOCAL.test(texto)) regras.add("caminho local");
  for (const m of texto.matchAll(EMAIL)) if (!DOMINIO_DE_EXEMPLO.test(m[1]!)) regras.add("e-mail");
  if (CREDENCIAIS.some((r) => r.test(texto))) regras.add("credencial");
  return [...regras];
}

describe("achar (casos montados em memória, pedaços concatenados para o arquivo não se pegar a si mesmo)", () => {
  const casos: [Regra, string][] = [
    ["formato STJ", "REsp 2.345.678" + "/SP"],
    ["formato CNJ", "processo 1111111-" + "22.2023.8.09.0001"],
    ["caminho local", "C:" + "\\Users\\alguem\\Projetos"],
    ["caminho local", "veja /Users" + "/alguem/projeto"],
    ["caminho local", "veja /home" + "/alguem/projeto"],
    ["caminho local", "pasta One" + "Drive sincronizada"],
    ["e-mail", "contato: fulano" + "@orgao-publico.gov.br"],
    ["credencial", "-----BEGIN " + "PRIVATE KEY-----"],
    ["credencial", "ghp" + "_" + "a".repeat(36)],
    ["credencial", "sk" + "-" + "a".repeat(24)],
    ["credencial", "AKIA" + "A".repeat(16)],
    ["credencial", "Bearer " + "a".repeat(30)],
    ["credencial", 'senha = "' + "x".repeat(10) + '"'],
  ];

  for (const [regra, texto] of casos) {
    it(`pega ${regra}`, () => expect(achar(texto)).toContain(regra));
  }

  it("não pega o texto limpo", () => {
    const limpo = [
      "REsp 1.234.567/SP e 1.000.001/RJ",
      "processo 0000000-00.2023.8.09.0001 ou 1234567-89.2020.4.01.3400",
      "contato: alguem@example.com, 12345+x@users.noreply.github.com",
      'const token = process.env.TOKEN; // sem valor em claro',
      "pasta do projeto: ./dados/inteiro-teor",
    ].join("\n");
    expect(achar(limpo)).toEqual([]);
  });

  it("não imprime o valor achado", () => {
    expect(JSON.stringify(achar("fulano" + "@orgao-publico.gov.br"))).not.toContain("orgao");
  });
});

/**
 * Fora da varredura, por regra explícita: `TICKETS/` (ignorado pelo git, tickets e fichas do dono),
 * `.agents/` e `.gemini/` (ferramentas de agente locais, fora do git). Os dois últimos aparecem como "novos não
 * ignorados" e não são publicados.
 */
const FORA_DA_VARREDURA = /^(TICKETS|\.agents|\.gemini)\//;

/**
 * Lista permitida: arquivo + regra + motivo. Nunca apague fixture legítima às cegas — declare aqui com o motivo.
 * As tabelas de precedentes são cópia de fonte oficial (ADR-0015: Portal de Dados Abertos do STJ; arquivos do portal
 * do STF): os processos citados nas teses e os paradigmas são dados públicos da fonte, não de usuário.
 */
const PERMITIDOS: { arquivo: RegExp; regra: Regra; motivo: string }[] = [
  { arquivo: /^dados\/tabela-precedentes-st[fj]\.json$/, regra: "formato STJ", motivo: "dados públicos da fonte oficial (ADR-0015)" },
  { arquivo: /^dados\/tabela-precedentes-st[fj]\.json$/, regra: "formato CNJ", motivo: "dados públicos da fonte oficial (ADR-0015)" },
  { arquivo: /^dados\/tabela-precedentes-st[fj]\.json$/, regra: "número real conhecido", motivo: "dados públicos da fonte oficial (ADR-0015)" },
  {
    arquivo: /^tests\/servidor\.test\.ts$/,
    regra: "formato CNJ",
    motivo: "fixture sintética (resposta marcada como fictícia, sequenciais com dígitos repetidos); confirmar com o dono do teste",
  },
];

const listar = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const arquivos = [...new Set([...listar("ls-files"), ...listar("ls-files", "--others", "--exclude-standard")])]
  .filter((f) => /\.(md|ts|json|ya?ml|txt|m?js)$/.test(f) && f !== "package-lock.json" && !FORA_DA_VARREDURA.test(f));

describe("dados reais", () => {
  it("nenhum dado de usuário ou de processo real nos arquivos do repositório (só arquivo + regra no relatório)", () => {
    const achados: string[] = [];
    for (const f of arquivos) {
      let texto: string;
      try {
        texto = readFileSync(f, "utf8");
      } catch {
        continue; // rastreado mas apagado no disco
      }
      for (const regra of achar(texto)) {
        if (!PERMITIDOS.some((p) => p.regra === regra && p.arquivo.test(f))) achados.push(`${f}: ${regra}`);
      }
    }
    expect(achados).toEqual([]);
  });
});
