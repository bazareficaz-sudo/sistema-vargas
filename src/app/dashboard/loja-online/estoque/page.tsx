import { contextoAdmin } from '@/lib/commerce/admin'
import FormularioLoja, { type Secao } from '@/components/loja-admin/FormularioLoja'

export const dynamic = 'force-dynamic'

// Política de estoque do canal.
//
// A decisão de 24/08 foi que isso NÃO pode ser constante no código: cada
// empresa — e, no futuro, cada cliente do SaaS — decide de onde vem o saldo
// que a loja publica.
//
// A tela mostra o DIAGNÓSTICO junto com a configuração. É a diferença entre
// "disponível: 6" e "6 = 10 no depósito Padrão, menos 2 reservados, menos 2
// de segurança". Sem isso, quando o número sai errado ninguém sabe onde olhar.

const CAMPOS = [
  'estoque_modo', 'estoque_deposito_id', 'estoque_fonte', 'estoque_seguranca',
  'estoque_percentual_publicado', 'estoque_maximo_publicado',
  'permitir_venda_sem_estoque', 'sem_estoque_comportamento',
  'limite_maximo_por_compra', 'reserva_minutos', 'entrega_ativa', 'retirada_ativa',
]

export default async function EstoqueLoja() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const [{ data: cfg }, { data: depositos }, { data: diagnostico }, { data: divergentes }] =
    await Promise.all([
      ctx.sb.from('loja_config').select(CAMPOS.join(', ')).eq('id', ctx.lojaId).single(),
      ctx.sb.from('depositos').select('id, nome, principal')
        .eq('empresa_id', ctx.empresaId).eq('ativo', true).order('nome'),
      ctx.sb.rpc('loja_estoque_diagnostico', { p_loja_id: ctx.lojaId }),
      // O número da divergência entre as duas fontes, medido AGORA. É o que
      // torna a escolha de `estoque_fonte` uma decisão informada em vez de um
      // campo que ninguém sabe o que faz.
      ctx.sb.rpc('loja_divergencia_estoque', { p_loja_id: ctx.lojaId }),
    ])

  const listaDepositos = (depositos ?? []) as { id: string; nome: string; principal: boolean }[]
  const linhasDiag = (diagnostico ?? []) as {
    empresa_nome: string | null; deposito_nome: string | null
    proprio: boolean; situacao: string; detalhe: string | null
  }[]
  const div = Array.isArray(divergentes) ? divergentes[0] : divergentes

  const SECOES: Secao[] = [
    {
      titulo: 'De onde vem o saldo',
      descricao: 'Define o número que a vitrine publica. Vale só para a Loja Online — PDV e marketplaces não mudam.',
      campos: [
        { nome: 'estoque_modo', rotulo: 'Origem do estoque', tipo: 'select', opcoes: [
            { valor: 'deposito_unico', rotulo: 'Um depósito específico' },
            { valor: 'depositos_selecionados', rotulo: 'Soma de depósitos selecionados' },
            { valor: 'empresa_consolidado', rotulo: 'Todos os depósitos da empresa' },
            { valor: 'grupo_consolidado', rotulo: 'Consolidado do grupo empresarial' },
          ],
          ajuda: 'O consolidado do grupo respeita as regras já existentes em Empresas → Estoque: só entram empresas do mesmo tenant e do mesmo grupo, e só produtos com vínculo de parceria ativo.' },
        { nome: 'estoque_deposito_id', rotulo: 'Depósito', tipo: 'select', opcoes: [
            { valor: '', rotulo: 'Principal da empresa' },
            ...listaDepositos.map(d => ({ valor: d.id, rotulo: d.nome + (d.principal ? ' (principal)' : '') })),
          ],
          ajuda: 'Usado quando a origem é "um depósito específico".' },
        { nome: 'estoque_fonte', rotulo: 'Fonte do número', tipo: 'select', opcoes: [
            { valor: 'produto_estoque', rotulo: 'Saldo por depósito (recomendado)' },
            { valor: 'produto_campo', rotulo: 'Campo estoque do cadastro' },
          ],
          ajuda: div?.divergentes != null
            ? `O sistema tem duas fontes de saldo e hoje ${div.divergentes} produtos divergem entre elas. Enquanto isso não for acertado, a escolha aqui muda o número que o cliente vê.`
            : 'O sistema tem duas fontes de saldo. A tabela por depósito é a mais confiável.' },
      ],
    },
    {
      titulo: 'Quanto publicar',
      descricao: 'Nada aqui altera o estoque real. Só o quanto dele a vitrine mostra.',
      campos: [
        { nome: 'estoque_seguranca', rotulo: 'Estoque de segurança', tipo: 'numero', sufixo: 'un',
          ajuda: 'Retido de toda venda online. Protege o balcão de vender o que a vitrine já prometeu.' },
        { nome: 'estoque_percentual_publicado', rotulo: 'Percentual publicado', tipo: 'numero', sufixo: '%',
          ajuda: '100 publica tudo. 70 publica 7 de cada 10 unidades disponíveis.' },
        { nome: 'estoque_maximo_publicado', rotulo: 'Máximo exibido', tipo: 'numero', sufixo: 'un',
          ajuda: 'Vazio = sem teto. Com 10, um item que tem 74 aparece como 10 — sem entregar o tamanho do estoque ao concorrente.' },
        { nome: 'limite_maximo_por_compra', rotulo: 'Máximo por compra', tipo: 'numero', sufixo: 'un',
          ajuda: 'Vazio = sem limite.' },
      ],
    },
    {
      titulo: 'Produto sem estoque',
      campos: [
        { nome: 'sem_estoque_comportamento', rotulo: 'Na listagem e na busca', tipo: 'select', opcoes: [
            { valor: 'mostrar_indisponivel', rotulo: 'Mostrar como indisponível' },
            { valor: 'ocultar', rotulo: 'Ocultar da listagem' },
          ],
          ajuda: 'Em qualquer das duas opções a PÁGINA do produto continua acessível: tirá-la do ar quebraria link já compartilhado e faria o Google despublicar o endereço.' },
        { nome: 'permitir_venda_sem_estoque', rotulo: 'Permitir comprar sem estoque (sob encomenda)', tipo: 'bool',
          ajuda: 'Ligado, o botão de compra continua ativo mesmo sem saldo.' },
      ],
    },
    {
      titulo: 'Entrega e reserva',
      descricao: 'A reserva entra em uso quando o checkout existir (Fase 3). A configuração já fica pronta.',
      campos: [
        { nome: 'entrega_ativa', rotulo: 'Entrega no endereço', tipo: 'bool' },
        { nome: 'retirada_ativa', rotulo: 'Retirada na loja', tipo: 'bool',
          ajuda: 'Entra em funcionamento com o checkout.' },
        { nome: 'reserva_minutos', rotulo: 'Tempo de reserva no checkout', tipo: 'numero', sufixo: 'min',
          ajuda: 'Quanto tempo o estoque fica segurado enquanto o cliente termina a compra.' },
      ],
    },
  ]

  return (
    <div className="space-y-5">
      {/* ── Diagnóstico ─────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900">De onde a loja está contando hoje</h2>
          <p className="mt-0.5 text-sm text-gray-500">Resultado da configuração abaixo, conferido agora.</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {linhasDiag.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                l.situacao === 'contando' ? 'bg-green-100 text-green-700'
                : l.situacao === 'recusado' ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-800'
              }`}>
                {l.situacao === 'contando' ? 'Contando' : l.situacao === 'recusado' ? 'Recusado' : 'Bloqueado'}
              </span>
              <span className="text-sm font-medium text-gray-900">{l.empresa_nome ?? '—'}</span>
              {l.deposito_nome && <span className="text-sm text-gray-500">{l.deposito_nome}</span>}
              {!l.proprio && l.situacao === 'contando' && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">outra empresa do grupo</span>
              )}
              {l.detalhe && <span className="w-full text-xs text-gray-600 sm:w-auto sm:flex-1">{l.detalhe}</span>}
            </li>
          ))}
          {linhasDiag.length === 0 && (
            <li className="p-4 text-sm text-gray-500">Nenhuma fonte de estoque resolvida.</li>
          )}
        </ul>
      </section>

      {div?.divergentes > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>{div.divergentes}</strong> produtos publicados têm saldo diferente entre o campo do
          cadastro e a tabela por depósito. A loja usa a fonte escolhida abaixo — os dois números
          existem no sistema, e nenhum dos dois está errado por si.
        </p>
      )}

      <FormularioLoja lojaId={ctx.lojaId} secoes={SECOES} valores={(cfg ?? {}) as Record<string, unknown>} />
    </div>
  )
}
