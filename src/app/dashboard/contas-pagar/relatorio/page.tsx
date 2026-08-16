import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import FiltroPeriodo from '@/components/contas-pagar/FiltroPeriodo'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'

export const dynamic = 'force-dynamic'

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

function primeiroDiaDoMes() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

// Dias entre vencimento e pagamento. Negativo = pagou adiantado.
function diasAtraso(vencimento: string | null, pagamento: string | null): number | null {
  if (!vencimento || !pagamento) return null
  const v = new Date(vencimento + 'T00:00:00').getTime()
  const p = new Date(pagamento + 'T00:00:00').getTime()
  return Math.round((p - v) / 86400000)
}

export default async function RelatorioContasPagarPage({
  searchParams,
}: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const sp = await searchParams
  const de = sp.de || primeiroDiaDoMes()
  const ate = sp.ate || new Date().toISOString().split('T')[0]

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await perfilDaSessao(supabase, user!.id)
  const empresaId = profile?.empresa_id ?? ''

  // O relatório é sobre dinheiro que SAIU — por isso filtra por
  // data_pagamento, não por vencimento. Uma conta de janeiro paga em março
  // é despesa de março para quem olha o caixa.
  const { data: pagas } = await supabase
    .from('contas_pagar')
    .select('id, descricao, valor, valor_pago, juros, multa, desconto, vencimento, competencia, data_pagamento, forma_pagamento, fornecedor_id, tipo_despesa_id')
    .eq('empresa_id', empresaId)
    .eq('status', 'pago')
    .gte('data_pagamento', de)
    .lte('data_pagamento', ate)
    .order('data_pagamento', { ascending: false })

  const contas = pagas ?? []

  // Nomes vêm por consulta separada e Map, não por embed do PostgREST — é o
  // padrão já usado no resto do sistema depois dos embeds quebrarem nesta base.
  const fornIds = [...new Set(contas.map(c => c.fornecedor_id).filter(Boolean))] as string[]
  const tipoIds = [...new Set(contas.map(c => c.tipo_despesa_id).filter(Boolean))] as string[]

  const [{ data: forns }, { data: tipos }] = await Promise.all([
    fornIds.length
      ? supabase.from('fornecedores').select('id, razao_social, nome_fantasia').in('id', fornIds)
      : Promise.resolve({ data: [] as { id: string; razao_social: string; nome_fantasia: string | null }[] }),
    tipoIds.length
      ? supabase.from('tipos_despesa').select('id, nome, cor').in('id', tipoIds)
      : Promise.resolve({ data: [] as { id: string; nome: string; cor: string | null }[] }),
  ])

  const nomeForn = new Map((forns ?? []).map(f => [f.id, f.nome_fantasia || f.razao_social]))
  const infoTipo = new Map((tipos ?? []).map(t => [t.id, t]))

  // ── Totais ──
  // valor_pago pode ser NULL nas contas quitadas antes desta funcionalidade
  // existir; nesses casos o valor original é a melhor informação disponível.
  const pago = (c: typeof contas[number]) => Number(c.valor_pago ?? c.valor ?? 0)

  const totalPago = contas.reduce((s, c) => s + pago(c), 0)
  const totalOriginal = contas.reduce((s, c) => s + Number(c.valor ?? 0), 0)
  const totalJuros = contas.reduce((s, c) => s + Number(c.juros ?? 0), 0)
  const totalMulta = contas.reduce((s, c) => s + Number(c.multa ?? 0), 0)
  const totalDesconto = contas.reduce((s, c) => s + Number(c.desconto ?? 0), 0)

  // ── Por fornecedor ──
  const porForn = new Map<string, { nome: string; total: number; juros: number; qtd: number }>()
  for (const c of contas) {
    const k = c.fornecedor_id ?? '__sem__'
    const nome = c.fornecedor_id ? (nomeForn.get(c.fornecedor_id) ?? 'Fornecedor removido') : 'Sem fornecedor'
    const at = porForn.get(k) ?? { nome, total: 0, juros: 0, qtd: 0 }
    at.total += pago(c); at.juros += Number(c.juros ?? 0) + Number(c.multa ?? 0); at.qtd += 1
    porForn.set(k, at)
  }
  const rankForn = [...porForn.values()].sort((a, b) => b.total - a.total)

  // ── Por tipo de despesa ──
  const porTipo = new Map<string, { nome: string; cor: string | null; total: number; qtd: number }>()
  for (const c of contas) {
    const k = c.tipo_despesa_id ?? '__sem__'
    const t = c.tipo_despesa_id ? infoTipo.get(c.tipo_despesa_id) : null
    const at = porTipo.get(k) ?? { nome: t?.nome ?? 'Sem classificação', cor: t?.cor ?? '#d1d5db', total: 0, qtd: 0 }
    at.total += pago(c); at.qtd += 1
    porTipo.set(k, at)
  }
  const rankTipo = [...porTipo.values()].sort((a, b) => b.total - a.total)

  // ── Atraso ──
  const comAtraso = contas
    .map(c => ({ c, dias: diasAtraso(c.vencimento, c.data_pagamento) }))
    .filter((x): x is { c: typeof contas[number]; dias: number } => x.dias !== null)

  const atrasadas = comAtraso.filter(x => x.dias > 0).sort((a, b) => b.dias - a.dias)
  const mediaAtraso = comAtraso.length
    ? comAtraso.reduce((s, x) => s + x.dias, 0) / comAtraso.length
    : 0

  // ── Por competência ──
  // O relatório soma pela data de PAGAMENTO, mas o gasto pertence ao mês da
  // competência. Uma conta de luz de julho paga em agosto aparece no total
  // de agosto e nesta tabela como despesa de julho — as duas leituras são
  // corretas e respondem perguntas diferentes.
  const porComp = new Map<string, { total: number; qtd: number }>()
  for (const c of contas) {
    const k = c.competencia ? String(c.competencia).slice(0, 7) : '__sem__'
    const at = porComp.get(k) ?? { total: 0, qtd: 0 }
    at.total += pago(c); at.qtd += 1
    porComp.set(k, at)
  }
  const rankComp = [...porComp.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const maiorTipo = rankTipo[0]
  const maiorForn = rankForn[0]

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <Link href="/dashboard/contas-pagar" className="hover:text-gray-600">Contas a Pagar</Link>
        <span>›</span><span className="text-gray-600">Relatório</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Relatório de Contas a Pagar</h1>
          <p className="text-sm text-gray-500 mt-1">
            O que saiu do caixa entre {new Date(de + 'T00:00:00').toLocaleDateString('pt-BR')} e{' '}
            {new Date(ate + 'T00:00:00').toLocaleDateString('pt-BR')}.
          </p>
        </div>
        <FiltroPeriodo de={de} ate={ate} />
      </div>

      {contas.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-gray-500">Nenhuma conta paga neste período.</p>
          <p className="text-xs text-gray-400 mt-1">
            O relatório conta pela data do pagamento — uma conta ainda em aberto não aparece aqui.
          </p>
        </div>
      ) : (
        <>
          {/* Cartões de resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500">Total pago</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalPago)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{contas.length} conta(s)</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500">Juros e multa</p>
              <p className={`text-2xl font-bold mt-1 ${totalJuros + totalMulta > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                {fmt(totalJuros + totalMulta)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {totalOriginal > 0 ? `${(((totalJuros + totalMulta) / totalOriginal) * 100).toFixed(1)}% do valor original` : '—'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500">Descontos obtidos</p>
              <p className={`text-2xl font-bold mt-1 ${totalDesconto > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                {fmt(totalDesconto)}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500">Atraso médio</p>
              <p className={`text-2xl font-bold mt-1 ${mediaAtraso > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {mediaAtraso > 0 ? `${mediaAtraso.toFixed(1)} dias` : 'em dia'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{atrasadas.length} paga(s) com atraso</p>
            </div>
          </div>

          {/* Leitura em uma frase — o gestor não deveria precisar somar coluna */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 text-sm text-blue-900">
            {maiorForn && (
              <>Quem mais recebeu foi <b>{maiorForn.nome}</b>, {fmt(maiorForn.total)} em {maiorForn.qtd} conta(s)
                {' '}({totalPago > 0 ? ((maiorForn.total / totalPago) * 100).toFixed(0) : 0}% de tudo que saiu).{' '}</>
            )}
            {maiorTipo && <>A maior categoria de despesa foi <b>{maiorTipo.nome}</b>, {fmt(maiorTipo.total)}.{' '}</>}
            {totalJuros + totalMulta > 0
              ? <>Juros e multa custaram <b>{fmt(totalJuros + totalMulta)}</b> no período.</>
              : <>Nenhum juro ou multa foi registrado no período.</>}
          </div>

          <div className="grid lg:grid-cols-2 gap-5 mb-5">
            {/* Fornecedores */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Quem mais recebeu</h2>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Fornecedor</th>
                    <th className="px-3 py-2 text-right font-medium">Contas</th>
                    <th className="px-3 py-2 text-right font-medium">Juros</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rankForn.slice(0, 12).map(f => (
                    <tr key={f.nome}>
                      <td className="px-4 py-2.5 text-sm text-gray-900">
                        {f.nome}
                        <div className="h-1 rounded-full bg-blue-500 mt-1"
                          style={{ width: `${rankForn[0].total > 0 ? (f.total / rankForn[0].total) * 100 : 0}%`, minWidth: '2px' }} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm text-gray-500">{f.qtd}</td>
                      <td className={`px-3 py-2.5 text-right text-sm ${f.juros > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {f.juros > 0 ? fmt(f.juros) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900">{fmt(f.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rankForn.length > 12 && (
                <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                  Mostrando os 12 maiores de {rankForn.length} fornecedores.
                </p>
              )}
            </div>

            {/* Categorias */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Por tipo de despesa</h2>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Tipo</th>
                    <th className="px-3 py-2 text-right font-medium">Contas</th>
                    <th className="px-3 py-2 text-right font-medium">%</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rankTipo.map(t => (
                    <tr key={t.nome}>
                      <td className="px-4 py-2.5 text-sm text-gray-900">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: t.cor ?? '#d1d5db' }} />
                          {t.nome}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm text-gray-500">{t.qtd}</td>
                      <td className="px-3 py-2.5 text-right text-sm text-gray-500">
                        {totalPago > 0 ? ((t.total / totalPago) * 100).toFixed(1) : '0'}%
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900">{fmt(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {porTipo.has('__sem__') && (
                <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                  {porTipo.get('__sem__')!.qtd} conta(s) sem tipo de despesa — classifique no pagamento
                  para elas entrarem na divisão.
                </p>
              )}
            </div>
          </div>

          {/* Competência */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Por competência</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                A que mês cada gasto pertence — não em que mês foi pago. A luz de julho paga em
                agosto conta como julho aqui.
              </p>
            </div>
            <table className="w-full">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Mês</th>
                  <th className="px-3 py-2 text-right font-medium">Contas</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rankComp.map(([mes, v]) => (
                  <tr key={mes}>
                    <td className="px-4 py-2.5 text-sm text-gray-900">
                      {mes === '__sem__'
                        ? <span className="text-gray-400">Sem competência informada</span>
                        : new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)
                            .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm text-gray-500">{v.qtd}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900">{fmt(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Demora para pagar */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">As que mais demoraram para ser pagas</h2>
              <p className="text-xs text-gray-500 mt-0.5">Dias entre o vencimento e o pagamento.</p>
            </div>
            {atrasadas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                Nenhuma conta foi paga depois do vencimento neste período.
              </p>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Descrição</th>
                    <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                    <th className="px-3 py-2 text-left font-medium">Venceu</th>
                    <th className="px-3 py-2 text-left font-medium">Pagou</th>
                    <th className="px-3 py-2 text-right font-medium">Atraso</th>
                    <th className="px-3 py-2 text-right font-medium">Juros+multa</th>
                    <th className="px-4 py-2 text-right font-medium">Pago</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {atrasadas.slice(0, 20).map(({ c, dias }) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 text-sm text-gray-900 max-w-xs truncate" title={c.descricao}>{c.descricao}</td>
                      <td className="px-3 py-2.5 text-sm text-gray-500">
                        {c.fornecedor_id ? (nomeForn.get(c.fornecedor_id) ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-gray-500">
                        {c.vencimento ? new Date(c.vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-gray-500">
                        {c.data_pagamento ? new Date(c.data_pagamento + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          dias > 30 ? 'bg-red-100 text-red-700' : dias > 7 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {dias} dia{dias > 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 text-right text-sm ${Number(c.juros ?? 0) + Number(c.multa ?? 0) > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {Number(c.juros ?? 0) + Number(c.multa ?? 0) > 0 ? fmt(Number(c.juros ?? 0) + Number(c.multa ?? 0)) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900">{fmt(pago(c))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-4">
            Juros, multa e valor efetivamente pago passaram a ser registrados a partir da atualização
            desta tela. Contas quitadas antes disso entram pelo valor original, com juros zero — não
            porque não houve juros, mas porque não havia onde guardar essa informação.
          </p>
        </>
      )}
    </div>
  )
}
