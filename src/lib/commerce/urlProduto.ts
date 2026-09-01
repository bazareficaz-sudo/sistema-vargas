import { DOMINIO_RAIZ } from './loja'

// ENDEREÇO PÚBLICO DE UM PRODUTO NA VITRINE.
//
// Mora aqui, e não dentro da página do painel, porque as regras não são
// óbvias e passaram a ter mais de um cliente: o selo LO na lista de produtos
// leva para cá, e qualquer lugar que queira "ver na loja" vai querer o mesmo.
// Duas cópias divergiriam no primeiro domínio próprio configurado.
//
// É função pura: recebe o que já foi lido do banco e devolve string. Não
// consulta nada — assim dá para testar as combinações sem subir banco.

export type EnderecoDaLoja = {
  /** `loja_config.dominio_proprio` — o domínio que o lojista apontou. */
  dominioProprio?: string | null
  /** `loja_config.subdominio` — o nome na plataforma. */
  subdominio?: string | null
}

/**
 * Monta o endereço do produto, ou devolve `undefined` quando não há um.
 *
 * DOMÍNIO PRÓPRIO VENCE O SUBDOMÍNIO. Quando o lojista aponta o domínio dele,
 * é ali que os clientes entram, é o endereço que o Google indexa e é o que
 * deve ser copiado e mandado no WhatsApp. Levar para o subdomínio da
 * plataforma funcionaria, mas divulgaria o endereço errado.
 *
 * `undefined` em vez de string vazia: quem chama precisa distinguir "não tem
 * endereço" de "tem, e é vazio". A string vazia viraria `href=""`, que no
 * navegador recarrega a página atual — um link que parece funcionar e não vai
 * a lugar nenhum.
 */
export function urlDoProdutoNaVitrine(
  loja: EnderecoDaLoja | null | undefined,
  slug: string | null | undefined,
  dominioRaiz: string = DOMINIO_RAIZ,
): string | undefined {
  const s = (slug ?? '').trim()
  if (!s || !loja) return undefined

  const proprio = (loja.dominioProprio ?? '').trim()
  if (proprio) return `https://${proprio}/produto/${s}`

  const sub = (loja.subdominio ?? '').trim()
  // Sem domínio raiz configurado não dá para montar o endereço do subdomínio.
  // Acontece em ambiente sem `NEXT_PUBLIC_LOJA_DOMINIO_RAIZ`, e o certo é não
  // oferecer link — um `https://bazareficaz./produto/x` seria pior.
  if (sub && dominioRaiz) return `https://${sub}.${dominioRaiz}/produto/${s}`

  return undefined
}
