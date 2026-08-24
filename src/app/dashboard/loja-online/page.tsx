import Link from 'next/link'
import { contextoAdmin } from '@/lib/commerce/admin'

export const dynamic = 'force-dynamic'

// Visão Geral.
//
// O diagnóstico da Fase 0 foi que o gargalo deste projeto não é técnico: é a
// qualidade do cadastro. Esta tela é o número dessa frase.
//
// Ela CONTA e nunca corrige, nunca bloqueia. A decisão de publicar continua
// sendo do usuário — inclusive publicar sem foto. O papel do sistema é fazer
// ele enxergar o que está publicando.

function Cartao({ titulo, valor, detalhe, alerta }: {
  titulo: string; valor: number | string; detalhe?: string; alerta?: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className={`mt-1 text-2xl font-bold ${alerta ? 'text-amber-600' : 'text-gray-900'}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-gray-500">{detalhe}</p>}
    </div>
  )
}

export default async function VisaoGeral() {
  const ctx = await contextoAdmin()
  if (!ctx?.lojaId) return null

  const [{ data: saude }, { data: loja }] = await Promise.all([
    ctx.sb.rpc('loja_saude_catalogo', { p_loja_id: ctx.lojaId }),
    ctx.sb.from('loja_config')
      .select('nome, subdominio, dominio_proprio, ativo, em_manutencao, indexavel')
      .eq('id', ctx.lojaId).single(),
  ])

  const s = (Array.isArray(saude) ? saude[0] : saude) ?? {}
  const n = (v: unknown) => Number(v ?? 0)

  const publicados = n(s.publicados)
  const prontos = n(s.prontos)
  const endereco = loja?.dominio_proprio || `${loja?.subdominio}.<seu-domínio>`

  return (
    <div className="space-y-6">
      {/* Estado da loja: o primeiro que o operador precisa entender, porque
          define se o que ele está vendo já está no ar ou não. */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            !loja?.ativo ? 'bg-gray-100 text-gray-600'
            : loja?.em_manutencao ? 'bg-amber-100 text-amber-800'
            : 'bg-green-100 text-green-700'
          }`}>
            {!loja?.ativo ? 'Desativada' : loja?.em_manutencao ? 'Em manutenção' : 'No ar'}
          </span>
          <span className="font-mono text-sm text-gray-700">{endereco}</span>
          {!loja?.indexavel && (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
              Oculta para o Google
            </span>
          )}
          <Link
            href="/dashboard/loja-online/dominio"
            className="ml-auto text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Configurar endereço
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao titulo="Publicados" valor={publicados} detalhe={`de ${n(s.catalogo_ativo).toLocaleString('pt-BR')} produtos ativos`} />
        <Cartao
          titulo="Prontos para vender"
          valor={prontos}
          detalhe="com foto, preço e estoque"
          alerta={publicados > 0 && prontos < publicados / 2}
        />
        <Cartao titulo="Rascunhos" valor={n(s.rascunhos)} />
        <Cartao titulo="Pausados" valor={n(s.pausados)} />
      </div>

      {/* ── Saúde do catálogo ─────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900">Saúde do catálogo</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            O que falta nos produtos que já estão publicados. É recomendação, não trava:
            você decide o que sobe.
          </p>
        </div>

        {publicados === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm text-gray-600">Nenhum produto publicado ainda.</p>
            <Link
              href="/dashboard/loja-online/produtos"
              className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Escolher produtos
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {[
              { rotulo: 'Sem foto',      valor: n(s.sem_foto),      dica: 'Sobem com um marcador tipográfico no lugar da imagem.' },
              { rotulo: 'Sem descrição', valor: n(s.sem_descricao), dica: 'A página usa o nome do cadastro.' },
              { rotulo: 'Sem preço',     valor: n(s.sem_preco),     dica: 'Aparecem por R$ 0,00 — vale revisar.' },
              { rotulo: 'Sem estoque',   valor: n(s.sem_estoque),   dica: 'Dependem da política de estoque configurada.' },
              { rotulo: 'Sem marca',     valor: n(s.sem_marca),     dica: 'Não aparecem no filtro por marca.' },
              { rotulo: 'Sem categoria', valor: n(s.sem_categoria), dica: 'Não aparecem ao navegar por categoria.' },
            ].map(l => {
              const pct = publicados > 0 ? Math.round((l.valor / publicados) * 100) : 0
              return (
                <li key={l.rotulo} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
                  <span className="w-32 shrink-0 text-sm font-medium text-gray-900">{l.rotulo}</span>
                  <span className={`w-24 shrink-0 text-sm font-semibold ${l.valor === 0 ? 'text-green-700' : 'text-amber-700'}`}>
                    {l.valor} {l.valor === 1 ? 'produto' : 'produtos'}
                  </span>
                  <div className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-gray-100 sm:block">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="min-w-0 flex-1 text-xs text-gray-500">{l.dica}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-gray-500">
        Visitas, pedidos e conversão entram quando o checkout existir (Fase 3). Mostrar
        esses números zerados agora só ocuparia espaço.
      </p>
    </div>
  )
}
