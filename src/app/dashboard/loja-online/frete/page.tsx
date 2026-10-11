import { contextoAdmin } from '@/lib/commerce/admin'
import FreteClient, { type ConfigFreteTela, type RegraTela, type ProdutoEspecialTela } from '@/components/loja-admin/FreteClient'

export const dynamic = 'force-dynamic'

// Aba Frete do painel da Loja Online.
//
// Se a migração `supabase-loja-frete.sql` ainda não rodou, as tabelas não
// existem e a consulta falha. Em vez de uma tela quebrada, o aviso diz qual
// arquivo executar — e a vitrine segue com o frete combinado, como antes.

function tabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return erro.code === 'PGRST205' || erro.code === '42P01'
    || /schema cache|does not exist/i.test(erro.message ?? '')
}

export default async function Frete() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const [cfg, regras, especiais, loja] = await Promise.all([
    ctx.sb.from('loja_frete_config').select('*').eq('loja_id', ctx.lojaId).maybeSingle(),
    ctx.sb.from('loja_frete_regras').select('*').eq('loja_id', ctx.lojaId)
      .order('prioridade').order('created_at'),
    ctx.sb.from('loja_frete_produtos').select('*').eq('loja_id', ctx.lojaId),
    ctx.sb.from('loja_config').select('cep, cidade, uf, entrega_ativa').eq('id', ctx.lojaId).single(),
  ])

  if (tabelaAusente(cfg.error) || tabelaAusente(regras.error)) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">O cadastro de frete ainda não foi instalado no banco.</p>
        <p className="mt-1">
          Execute o arquivo <code className="rounded bg-white px-1">supabase-loja-frete.sql</code> no SQL Editor do
          Supabase e recarregue esta página. Enquanto isso, a loja continua combinando o frete pelo WhatsApp.
        </p>
      </div>
    )
  }

  // Nome dos produtos com regra especial: a tabela guarda só o id.
  const lista = (especiais.data ?? []) as Record<string, any>[]
  const ids = lista.map(e => e.produto_id)
  const nomes = new Map<string, { nome: string; sku: string | null }>()
  if (ids.length > 0) {
    const { data } = await ctx.sb.from('produtos').select('id, nome, sku').in('id', ids)
    for (const p of (data ?? []) as any[]) nomes.set(p.id, { nome: p.nome, sku: p.sku })
  }

  const produtos: ProdutoEspecialTela[] = lista.map(e => ({
    produtoId: e.produto_id,
    nome: nomes.get(e.produto_id)?.nome ?? '(produto removido)',
    sku: nomes.get(e.produto_id)?.sku ?? null,
    freteGratis: !!e.frete_gratis,
    somenteRetirada: !!e.somente_retirada,
    adicionalUnidade: Number(e.adicional_unidade ?? 0),
    pesoKg: e.peso_kg != null ? Number(e.peso_kg) : null,
  }))

  return (
    <FreteClient
      lojaId={ctx.lojaId}
      config={(cfg.data ?? null) as ConfigFreteTela | null}
      regras={(regras.data ?? []) as RegraTela[]}
      produtos={produtos}
      entregaAtiva={!!loja.data?.entrega_ativa}
      enderecoLojaOk={!!(loja.data?.cep || (loja.data?.cidade && loja.data?.uf))}
    />
  )
}
