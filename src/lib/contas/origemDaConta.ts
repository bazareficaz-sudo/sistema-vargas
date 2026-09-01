// DE ONDE VEIO UMA CONTA A PAGAR, e para onde clicar para ver o documento.
//
// São dois caminhos, e eles não se parecem no banco. Medido em 01/09/2026,
// nas 139 contas deste sistema:
//
//   67 + 6  gravam `entrada_id`     → entrada manual, tela /dashboard/entradas
//   66      gravam `origem='entrada_xml'` + `origem_id` → NF-e importada por
//           XML, tela /dashboard/entradas-xml (tabela `nfe_entradas`)
//
// Nenhuma usa as duas colunas. Quem for ler isto depois vai querer saber por
// que existem dois mecanismos para a mesma ideia: porque foram escritos em
// momentos diferentes, e a coluna genérica (`origem`/`origem_id`) chegou
// depois sem migrar quem já usava `entrada_id`.
//
// O NÚMERO EXIBIDO E O DESTINO DO CLIQUE SÃO COISAS DIFERENTES. A descrição
// das contas vindas de entrada manual diz "NF a5f2d2ee — FORNECEDOR", e
// aqueles 8 caracteres NÃO são número de nota: são o começo do UUID da
// entrada. O `numero_nf` da entrada está vazio em 67 dos 73 casos. Então o
// rótulo do link vem do que existe de verdade — o número da entrada
// (ENT-000051) quando não há número de nota — em vez de repetir um fragmento
// de identificador com cara de documento fiscal.

export type OrigemDaConta = {
  /** Para onde o clique leva. */
  href: string
  /** O que aparece escrito, já legível para quem confere nota. */
  rotulo: string
  /** `nf` quando é número de documento fiscal; `entrada` quando é interno. */
  tipo: 'nf' | 'entrada' | 'pedido'
  /** Texto do `title`, dizendo o que vai abrir. */
  descricao: string
}

export type DadosDaEntrada = {
  id: string
  numero_nf?: string | null
  numero_entrada?: string | null
  observacoes?: string | null
  pedido_compra_id?: string | null
}

export type DadosDaNfe = {
  id: string
  numero?: string | number | null
  serie?: string | number | null
}

const vazio = (v: unknown) => !String(v ?? '').trim()

/**
 * Resolve o link de origem de uma conta.
 *
 * Devolve `null` quando não há documento nenhum para abrir — despesa avulsa
 * criada à mão, por exemplo. Nesse caso a coluna fica vazia, e vazio é a
 * resposta certa: não há para onde ir.
 */
export function origemDaConta(
  conta: { entrada_id?: string | null; origem?: string | null; origem_id?: string | null },
  entrada: DadosDaEntrada | null | undefined,
  nfe: DadosDaNfe | null | undefined,
): OrigemDaConta | null {
  // NF-e importada por XML: aqui o número é de verdade, e é o que quem
  // confere procura.
  if (conta.origem === 'entrada_xml' && conta.origem_id) {
    const num = String(nfe?.numero ?? '').trim()
    const serie = String(nfe?.serie ?? '').trim()
    return {
      href: `/dashboard/entradas-xml/${conta.origem_id}`,
      rotulo: num ? `NF-e ${num}${serie ? `/${serie}` : ''}` : 'NF-e importada',
      tipo: 'nf',
      descricao: 'Abrir a NF-e que originou esta conta',
    }
  }

  if (conta.entrada_id && entrada) {
    // Número de nota quando a entrada tem um; senão o número da entrada, que
    // é o identificador que o operador vê na tela de entradas.
    const nf = String(entrada.numero_nf ?? '').trim()
    if (!vazio(nf)) {
      return {
        href: `/dashboard/entradas/${conta.entrada_id}`,
        rotulo: `NF ${nf}`,
        tipo: 'nf',
        descricao: 'Abrir a entrada que originou esta conta',
      }
    }
    const numEnt = String(entrada.numero_entrada ?? '').trim()
    return {
      href: `/dashboard/entradas/${conta.entrada_id}`,
      rotulo: numEnt || 'Entrada',
      tipo: 'entrada',
      descricao: numEnt
        ? `Abrir a entrada ${numEnt}, que originou esta conta (esta entrada não tem número de nota preenchido)`
        : 'Abrir a entrada que originou esta conta',
    }
  }

  return null
}

/**
 * O pedido de compra que originou a conta, quando existe.
 *
 * Separado da origem porque são documentos diferentes: a entrada é o que
 * chegou, o pedido é o que foi encomendado. Uma conta pode ter os dois, e
 * quem confere quer poder ir a qualquer um.
 *
 * HOJE ISTO NÃO APARECE PARA NINGUÉM: medido em 01/09/2026, `pedido_compra_id`
 * é nulo em todas as entradas ligadas a conta. A função existe para o link
 * funcionar no dia em que uma entrada nascer de um pedido, e não para fingir
 * que já funciona.
 */
export function pedidoDaConta(entrada: DadosDaEntrada | null | undefined): OrigemDaConta | null {
  const id = entrada?.pedido_compra_id
  if (!id) return null
  return {
    href: `/dashboard/pedidos-compra?pedido=${id}`,
    rotulo: 'Pedido',
    tipo: 'pedido',
    descricao: 'Abrir o pedido de compra que originou esta entrada',
  }
}
