// TELA DE INÍCIO DO VENDEDOR — o que ele faz, em botões grandes, e o que
// está esperando por ele hoje.
//
// Os botões são telas do menu: a lista aqui só escolhe QUAIS e o texto do
// botão. Se a tela for bloqueada para a pessoa (Usuários → Permissões) ou não
// estiver no plano, o botão some — a mesma regra do menu.
//
// Os números são os MESMOS das telas de destino: "sai hoje" e "atrasados"
// usam a esteira de pedidos (src/lib/pedidos/esteira.ts), "esperando" é o
// filtro Aguardando das Conversas. Número que não bate com a tela que ele
// abre faz o vendedor parar de confiar nos dois.

import { allItems, type NavItem } from '@/components/nav-config'
import { emAberto, etapaEsteira, janelaDoPrazo } from '@/lib/pedidos/esteira'

export type AtalhoInicio = {
  href: string
  titulo: string
  descricao: string
  icone: string
  /** Fundo do ícone (classe Tailwind). */
  cor: string
}

export const ATALHOS_VENDEDOR: AtalhoInicio[] = [
  { href: '/dashboard/integracoes/whatsapp/conversas', titulo: 'Atendimento WhatsApp', descricao: 'Responder os clientes', icone: '💬', cor: 'bg-emerald-100' },
  { href: '/dashboard/orcamentos', titulo: 'Orçamentos', descricao: 'Criar e acompanhar orçamentos', icone: '📋', cor: 'bg-amber-100' },
  { href: '/dashboard/marketplaces/anuncios', titulo: 'Anúncios', descricao: 'Anúncios dos marketplaces', icone: '🏷️', cor: 'bg-violet-100' },
  { href: '/dashboard/pedidos-ecommerce', titulo: 'Pedidos da Internet', descricao: 'Separar, emitir e despachar', icone: '📦', cor: 'bg-blue-100' },
  { href: '/dashboard/produtos', titulo: 'Consultar produto', descricao: 'Preço, estoque e código', icone: '🔎', cor: 'bg-sky-100' },
  { href: '/dashboard/clientes', titulo: 'Clientes', descricao: 'Cadastro e histórico', icone: '👥', cor: 'bg-rose-100' },
]

/**
 * Os atalhos que esta pessoa pode abrir. `podeAbrir` recebe o item do menu
 * (com o módulo do plano) e responde se o plano tem o módulo e se a tela não
 * está bloqueada.
 */
export function atalhosVisiveis(atalhos: AtalhoInicio[], podeAbrir: (item: NavItem) => boolean): AtalhoInicio[] {
  const menu = new Map(allItems().map(i => [i.href, i]))
  return atalhos.filter(a => {
    const item = menu.get(a.href)
    return item ? podeAbrir(item) : false
  })
}

type PedidoParaDespacho = {
  status: string | null; status_externo?: string | null; etapa_interna?: string | null
  envio_substatus?: string | null; prazo_postagem?: string | null
}

/** Pedidos da internet em aberto: quantos saem hoje e quantos já atrasaram. */
export function resumoDespacho(pedidos: PedidoParaDespacho[], agora = new Date()): { saemHoje: number; atrasados: number; abertos: number } {
  let saemHoje = 0, atrasados = 0, abertos = 0
  for (const p of pedidos) {
    if (!emAberto(etapaEsteira(p, agora))) continue
    abertos++
    const j = janelaDoPrazo(p, agora)
    // Mesma conta da tela de pedidos: sem prazo informado entra em "sai hoje".
    if (j === 'atrasado') atrasados++
    else if (j === 'hoje' || j === 'sem_prazo') saemHoje++
  }
  return { saemHoje, atrasados, abertos }
}

/** Orçamentos em aberto e quantos vencem hoje (validade é DATE). */
export function resumoOrcamentos(orcs: { status: string | null; validade: string | null }[], hoje: string): { abertos: number; vencemHoje: number } {
  const abertos = orcs.filter(o => o.status === 'aberto')
  return { abertos: abertos.length, vencemHoje: abertos.filter(o => String(o.validade ?? '').slice(0, 10) === hoje).length }
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora de Brasília. */
export function saudacao(agora = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}
