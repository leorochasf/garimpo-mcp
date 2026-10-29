import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  caminhoFisico,
  criarGravador,
  foraDoRepositorioNoDisco,
  gravacaoForaDoLugar,
  gravacaoForaDoLugarNoDisco,
  rodadaCompleta,
  saidaInvalida,
  type Registro,
  worktreesDoRepositorio,
} from "../scripts/seguroDaRodada.js";

const URL_OK = "https://www.jurisprudenciaia.com.br/api/tribunais/stj/search";
const PERMITIDA = /^https:\/\/www\.jurisprudenciaia\.com\.br\/api\/tribunais\/(stj|stf|tst|tse)\/search$/;

function montar(fetchFalso: typeof fetch) {
  const registros: Registro[] = [];
  const hosts = new Map<string, number>();
  const gravador = criarGravador({
    fetch: fetchFalso,
    permitida: PERMITIDA,
    teto: 5,
    consultaAtual: () => "c1",
    gravarRegistro: (r) => registros.push(r),
    aoContar: () => undefined,
    aoRecusa: () => undefined,
    hosts,
  });
  return { gravador, registros, hosts };
}

describe("saidaInvalida", () => {
  it("ausente, vazio ou começando por traço é recusado; pasta comum passa", () => {
    expect(saidaInvalida(undefined)).toMatch(/--saida/);
    expect(saidaInvalida("")).toMatch(/--saida/);
    expect(saidaInvalida("  ")).toMatch(/--saida/);
    expect(saidaInvalida("--ao-vivo")).toMatch(/--saida/);
    expect(saidaInvalida("-x")).toMatch(/--saida/);
    expect(saidaInvalida("pasta")).toBeUndefined();
  });
});

describe("gravacaoForaDoLugar (N03: a gravação crua só vai para pasta externa)", () => {
  const raiz = "D:/projetos/garimpo-mcp";

  it("recusa a pasta do projeto e qualquer pasta dentro dele, inclusive banco-de-provas-resultados", () => {
    expect(gravacaoForaDoLugar(raiz, raiz)).toMatch(/projeto/);
    expect(gravacaoForaDoLugar("D:/projetos/garimpo-mcp/banco-de-provas-resultados/1.2", raiz)).toMatch(/projeto/);
    expect(gravacaoForaDoLugar(String.raw`d:\Projetos\Garimpo-MCP\x`, raiz)).toMatch(/projeto/);
  });

  it("recusa pasta sincronizada de nuvem", () => {
    for (const nuvem of ["One" + "Drive", "One" + "Drive - Empresa", "Google Drive", "Meu Drive", "Dropbox", "iCloud" + "Drive"])
      expect(gravacaoForaDoLugar(`E:/${nuvem}/provas`, raiz), nuvem).toMatch(/nuvem/);
  });

  it("aceita pasta externa comum, inclusive irmã com nome parecido", () => {
    expect(gravacaoForaDoLugar("E:/provas-garimpo/1.2-base", raiz)).toBeUndefined();
    expect(gravacaoForaDoLugar("D:/projetos/garimpo-mcp-provas", raiz)).toBeUndefined();
  });

  it("caminho estendido do Windows (\\\\?\\) para dentro do projeto também é recusado", () => {
    expect(gravacaoForaDoLugar(String.raw`\\?\D:\projetos\garimpo-mcp\banco-de-provas-resultados`, raiz)).toMatch(/projeto/);
  });
});

describe("gravacaoForaDoLugarNoDisco (R02: atalho de pasta não engana a trava)", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "garimpo-trava-"));
    mkdirSync(join(base, "projeto", "banco-de-provas-resultados"), { recursive: true });
    mkdirSync(join(base, "Dropbox", "provas"), { recursive: true });
    mkdirSync(join(base, "fora"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("junction de fora apontando para o projeto é recusada, mesmo para subpasta que ainda não existe", () => {
    symlinkSync(join(base, "projeto"), join(base, "fora", "atalho"), "junction");
    const pasta = join(base, "fora", "atalho", "banco-de-provas-resultados", "1.2-nova");
    expect(gravacaoForaDoLugar(pasta, join(base, "projeto"))).toBeUndefined(); // só o texto não vê
    expect(gravacaoForaDoLugarNoDisco(pasta, join(base, "projeto"))).toMatch(/projeto/);
  });

  it("junction apontando para pasta de nuvem é recusada", () => {
    symlinkSync(join(base, "Dropbox", "provas"), join(base, "fora", "provas"), "junction");
    expect(gravacaoForaDoLugarNoDisco(join(base, "fora", "provas", "1.2"), join(base, "projeto"))).toMatch(/nuvem/);
  });

  it("pasta externa comum, existente ou não, passa", () => {
    expect(gravacaoForaDoLugarNoDisco(join(base, "fora"), join(base, "projeto"))).toBeUndefined();
    expect(gravacaoForaDoLugarNoDisco(join(base, "fora", "nova", "1.2"), join(base, "projeto"))).toBeUndefined();
  });
});

describe("B02-R03: foraDoRepositorioNoDisco (nenhuma worktree do repositório, nem a principal)", () => {
  let base: string;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=teste", "-c", "user.email=teste@exemplo.invalid", ...args], { cwd, stdio: "pipe" });
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "garimpo-worktrees-"));
    mkdirSync(join(base, "principal"));
    git(join(base, "principal"), "init", "-q");
    git(join(base, "principal"), "commit", "-q", "--allow-empty", "-m", "vazio");
    git(join(base, "principal"), "worktree", "add", "-q", "-b", "qualidade", join(base, "a"));
    git(join(base, "principal"), "worktree", "add", "-q", "--detach", join(base, "b"));
    git(join(base, "principal"), "worktree", "add", "-q", "-b", "outra", join(base, "c"));
    mkdirSync(join(base, "fora"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("o script na worktree A lista todas: a principal, A, B (o braço) e C", () => {
    const lista = worktreesDoRepositorio(join(base, "a")).map((w) => caminhoFisico(w).toLowerCase());
    expect(lista.sort()).toEqual(["principal", "a", "b", "c"].map((p) => caminhoFisico(join(base, p)).toLowerCase()).sort());
  });

  it("executor na A, braço na B: destino na principal ou na C é recusado, mesmo pasta nova; pasta externa passa", () => {
    const a = join(base, "a");
    expect(gravacaoForaDoLugarNoDisco(join(base, "principal", "provas-cruas-b02"), a)).toBeUndefined(); // a trava antiga não via
    expect(foraDoRepositorioNoDisco(join(base, "principal", "provas-cruas-b02"), a)).toMatch(/worktree/);
    expect(foraDoRepositorioNoDisco(join(base, "c", "chave.txt"), a)).toMatch(/worktree/);
    expect(foraDoRepositorioNoDisco(join(base, "b", "rodada"), a)).toMatch(/worktree/);
    expect(foraDoRepositorioNoDisco(join(base, "a", "x"), a)).toMatch(/projeto/);
    expect(foraDoRepositorioNoDisco(join(base, "fora", "rodada"), a)).toBeUndefined();
  });

  it("atalho de fora para dentro de outra worktree também é recusado", () => {
    symlinkSync(join(base, "c"), join(base, "fora", "atalho"), "junction");
    expect(foraDoRepositorioNoDisco(join(base, "fora", "atalho", "rodada"), join(base, "a"))).toMatch(/worktree/);
  });

  it("sem repositório git, recusa (não dá para saber onde estão as worktrees)", () => {
    mkdirSync(join(base, "fora", "projeto-sem-git"));
    expect(foraDoRepositorioNoDisco(join(base, "fora", "rodada"), join(base, "fora", "projeto-sem-git"))).toMatch(/git/);
  });
});

describe("criarGravador", () => {
  it("pede ao fetch sem seguir redirecionamento; um 302 vira falha registrada, sem 2ª requisição", async () => {
    const pedidos: string[] = [];
    const falso = (async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push(String(url));
      if (init?.redirect === "error") throw new TypeError("fetch failed: redirect mode is set to error");
      pedidos.push("https://outro-host.example/seguido");
      return new Response("", { status: 302, headers: { location: "https://outro-host.example/x" } });
    }) as typeof fetch;
    const { gravador, registros, hosts } = montar(falso);
    await expect(gravador(URL_OK, { method: "POST", body: "{}" })).rejects.toThrow(/redirect/);
    expect(pedidos).toEqual([URL_OK]);
    expect([...hosts.keys()]).toEqual(["www.jurisprudenciaia.com.br"]);
    expect(registros).toHaveLength(1);
    expect(registros[0].erroDeRede).toMatch(/redirect/);
  });

  it("resposta normal passa e é gravada; URL fora da permitida e teto continuam bloqueando", async () => {
    const { gravador, registros } = montar((async () => new Response('{"ok":1}', { status: 200 })) as typeof fetch);
    const r = await gravador(URL_OK, { method: "POST", body: "{}" });
    expect(await r.text()).toBe('{"ok":1}');
    expect(registros[0].status).toBe(200);
    await expect(gravador("https://outro.example/api", {})).rejects.toThrow(/bloqueada/);
    for (let i = 0; i < 4; i++) await gravador(URL_OK, { body: "{}" });
    await expect(gravador(URL_OK, { body: "{}" })).rejects.toThrow(/teto/);
  });
});

describe("rodadaCompleta", () => {
  const ok = (id: string) => ({ id });
  const erro = (id: string) => ({ id, erro: "HTTP 500" });
  it("tudo bem sucedido e sem parada: completa", () => {
    expect(rodadaCompleta({ principais: ["a", "b"], verificacoes: ["v"], resultados: [ok("a"), ok("b"), ok("v")] })).toBe(true);
  });
  it("registro de erro numa consulta principal não conta como concluída", () => {
    expect(rodadaCompleta({ principais: ["a", "b"], verificacoes: [], resultados: [ok("a"), erro("b")] })).toBe(false);
  });
  it("paradigma com erro (sem verificação possível) deixa a rodada incompleta", () => {
    expect(rodadaCompleta({ principais: ["p1"], verificacoes: [], resultados: [erro("p1")] })).toBe(false);
  });
  it("verificação com erro ou faltando, ou parada, é incompleta", () => {
    expect(rodadaCompleta({ principais: ["a"], verificacoes: ["v"], resultados: [ok("a"), erro("v")] })).toBe(false);
    expect(rodadaCompleta({ principais: ["a"], verificacoes: ["v"], resultados: [ok("a")] })).toBe(false);
    expect(rodadaCompleta({ parou: "x", principais: ["a"], verificacoes: [], resultados: [ok("a")] })).toBe(false);
  });
});
