import { createClient } from '@/lib/supabase/server'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import FaltasClient from '@/components/auxiliar-compras/FaltasClient'

export const dynamic = 'force-dynamic'

// Faltas e encomendas anotadas no balcão.
//
// O PDV do balcão grava aqui desde o começo de agosto e, até agora, nenhuma
// tela do painel lia essa tabela. O vendedor anotava, a linha ia para o
// banco, e ninguém do lado da compra via. É a informação mais direta que
// existe para decidir o que comprar — alguém veio, pediu, e saiu sem levar —
// e estava sendo coletada para ninguém.

const LIMITE = 1000

export default async function FaltasPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const perfil = await perfilDaSessao(sb, user!.id)
  const empresaId = perfil?.empresa_id ?? ''

  const { data: faltas, error } = await sb.from('faltas')
    .select('id, produto_id, produto_nome, produto_sku, cliente_nome, cliente_telefone, quantidade_solicitada, quantidade_atendida, observacao, status, tipo, origem, usuario_nome, prazo_desejado, preco_negociado, created_at, updated_at')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(LIMITE)

  // Erro de consulta virando lista vazia é o tipo de falha que faz o usuário
  // concluir que "não tem nenhuma falta" quando na verdade a tela quebrou.
  const erro = error ? error.message : null
  const lista = faltas ?? []

  // Estoque atual de cada produto pedido. É o que transforma a linha em
  // decisão: "7 pessoas procuraram e tem 0 na prateleira" é urgente;
  // "7 pessoas procuraram e tem 40" é erro de busca no PDV, não de compra.
  const ids = [...new Set(lista.map(f => f.produto_id).filter(Boolean))] as string[]
  const produtos: Record<string, { estoque: number; sku: string | null; custo: number; preco: number; categoria: string | null }> = {}

  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('produtos')
      .select('id, sku, estoque, preco_custo, preco_venda, categoria')
      .eq('empresa_id', empresaId)
      .in('id', ids.slice(i, i + 200))
    for (const p of data ?? []) {
      produtos[p.id] = {
        estoque: Number(p.estoque ?? 0),
        sku: p.sku ?? null,
        custo: Number(p.preco_custo ?? 0),
        preco: Number(p.preco_venda ?? 0),
        categoria: p.categoria ?? null,
      }
    }
  }

  const enriquecida = lista.map(f => ({
    ...f,
    tipo: (f.tipo === 'encomenda' ? 'encomenda' : 'falta') as 'falta' | 'encomenda',
    quantidade_solicitada: Number(f.quantidade_solicitada ?? 1),
    quantidade_atendida: Number(f.quantidade_atendida ?? 0),
    estoqueAtual: f.produto_id ? (produtos[f.produto_id]?.estoque ?? null) : null,
    custo: f.produto_id ? (produtos[f.produto_id]?.custo ?? 0) : 0,
    categoria: f.produto_id ? (produtos[f.produto_id]?.categoria ?? null) : null,
  }))

  return <FaltasClient faltas={enriquecida} erro={erro} limite={LIMITE} />
}
