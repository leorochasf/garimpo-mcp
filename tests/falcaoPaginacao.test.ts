import { describe, expect, it } from "vitest";
import { chamar, conectar, documento, falcaoFalso, pagina, siteFalso } from "./apoioFalcao.js";

/** Dez documentos sintéticos da página `n`; `repetidos` troca os primeiros ids pelos da página anterior. */
function dez(n: number, repetidos = 0) {
  return Array.from({ length: 10 }, (_, i) => {
    const doIndice = i < repetidos ? n - 1 : n;
    return documento({
      idDocumentoAcordao: `${3000 + doIndice * 100 + i}`,
      tribunal: "TRT2",
      numeroProcesso: `00${doIndice}${i}000-00.2024.5.02.0001`,
    });
  });
}

async function buscar(responder: (n: number) => Response, limite = 30) {
  const falcao = falcaoFalso((url) => responder(Number(url.searchParams.get("page"))));
  const { mcp } = await conectar(siteFalso().cliente, falcao.cliente);
  const r = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: "horas extras", limite });
  return { r, falcao, mcp };
}

describe("paginação do Falcão: conferências (só detectam e avisam)", () => {
  it("páginas consistentes: sem aviso novo e as mesmas 3 chamadas", async () => {
    const { r, falcao } = await buscar((n) => pagina(dez(n), 120));
    expect(falcao.pedidos).toHaveLength(3);
    expect(r.dado.acordaos).toHaveLength(30);
    expect(r.texto).not.toMatch(/possivelmente incompleta/);
    expect(r.dado.cabecalhoDeCobertura).toMatch(/informou 120 acórdãos; o Garimpo recebeu 30 e mostra 30/);
  });

  it("total que muda entre páginas: aviso de lista possivelmente incompleta, acórdãos já obtidos ficam, sem chamada a mais", async () => {
    const { r, falcao } = await buscar((n) => pagina(dez(n), n === 0 ? 120 : 95));
    expect(falcao.pedidos).toHaveLength(3);
    expect(r.dado.acordaos).toHaveLength(30);
    expect(r.dado.avisos.join(" ")).toMatch(/lista possivelmente incompleta/);
    expect(r.dado.avisos.join(" ")).toMatch(/120.*95|95.*120/);
    expect(r.dado.cabecalhoDeCobertura).toMatch(/possivelmente incompleta/);
  });

  it("identificador repetido entre páginas: um só acórdão na lista, aviso e sem chamada a mais", async () => {
    const { r, falcao } = await buscar((n) => pagina(dez(n, n === 1 ? 2 : 0), 120), 20);
    expect(falcao.pedidos).toHaveLength(2);
    const ids = r.dado.acordaos.map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(18);
    expect(r.dado.avisos.join(" ")).toMatch(/2 acórdão\(s\) repetido\(s\).*lista possivelmente incompleta/);
    expect(r.dado.cabecalhoDeCobertura).toMatch(/possivelmente incompleta/);
  });

  it("mesmo identificador em outro tribunal não derruba o acórdão válido do tribunal pedido", async () => {
    const { r } = await buscar(() =>
      pagina([
        documento({ idDocumentoAcordao: "123", tribunal: "TRT3", numeroProcesso: "0000001-00.2024.5.03.0001" }),
        documento({ idDocumentoAcordao: "123", tribunal: "TRT2", numeroProcesso: "0000002-00.2024.5.02.0001" }),
      ]),
    );
    expect(r.dado.acordaos.map((a: { id: string }) => a.id)).toEqual(["trt2:123"]);
    expect(r.dado.avisos.join(" ")).toMatch(/1 registro\(s\) do Falcão descartado\(s\)/);
    expect(r.dado.avisos.join(" ")).not.toMatch(/repetido/);
  });

  it("busca inconsistente é guardada com os avisos e o cabeçalho de incompleta: a repetição não chama a fonte", async () => {
    const { falcao, mcp } = await buscar((n) => pagina(dez(n), n === 0 ? 120 : 95));
    expect(falcao.pedidos).toHaveLength(3);
    const repetida = await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: "horas extras", limite: 30 });
    expect(falcao.pedidos).toHaveLength(3);
    expect(repetida.dado.cabecalhoDeCobertura).toMatch(/Lista possivelmente incompleta/);
    expect(repetida.dado.avisos.join(" ")).toMatch(/possivelmente incompleta/);
    await chamar(mcp, "busca_direta", { tribunal: "trt2", texto: "horas extras", limite: 30, renovar: true });
    expect(falcao.pedidos).toHaveLength(6);
  });
});
