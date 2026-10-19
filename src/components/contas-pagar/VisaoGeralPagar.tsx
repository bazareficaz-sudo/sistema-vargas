import Link from 'next/link'
import type { createClient } from '@/lib/supabase/server'
import GraficoMesAMes from './GraficoMesAMes'
import {
  painelDoPagar, mesAMes, semanasAFrente, faixasDeAtraso, situacaoDaConta, somarMeses,
  rotuloDoMes, nomeDoMes, diaMes, ultimoDiaDoMes,
} from '@/lib/contas/agendaPagar'

// Aba "Visão geral" do relatório: o que vence e o que venceu, mês a mês e
// semana a semana, pelo VENCIMENTO. Responde "quanto teve de boleto neste
// mês, quanto tem no próximo, o que está atrasado e com quem".

function fmt(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

type Linha = {
  valor: number; vencimento: string; status: string; fornecedor_id: string | null; tipo_despesa_id: string | null
  fornecedores: { razao_social: string; nome_fantasia: string | null } | null
}

const linkLista = (de: string, ate: string, situacao = 'todos') =>
  `/dashboard/contas-pagar?situacao=${situacao}&periodo=personalizado&de=${de}&ate=${ate}`

export default async function VisaoGeralPagar({ supabase, empresaId, hojeIso }: {
  supabase: Awaited<ReturnType<typeof createClient>>
  empresaId: string
  hojeIso: string
}) {
  const ANTES = 6, DEPOIS = 6
  const desde = `${somarMeses(hojeIso.slice(0, 7), -ANTES)}-01`
  const contas: Linha[] = []
  for (let de = 0; ; de += 1000) {
    const { data } = await supabase.from('contas_pagar')
      .select('valor, vencimento, status, fornecedor_id, tipo_despesa_id, fornecedores(razao_social, nome_fantasia)')
      .eq('empresa_id', empresaId)
      .neq('status', 'cancelado')
      .or(`status.in.(pendente,vencido),vencimento.gte.${desde}`)
      .order('id', { ascending: true })
      .range(de, de + 999)
    contas.push(...((data ?? []) as unknown as Linha[]))
    if (!data || data.length < 1000) break
  }
  const { data: tipos } = await supabase.from('tipos_despesa').select('id, nome, cor').eq('empresa_id', empresaId)
  const infoTipo = new Map((tipos ?? []).map(t => [t.id, t as { id: string; nome: string; cor: string | null }]))

  const painel = painelDoPagar(contas, hojeIso)
  // Meses vazios nas pontas (antes do primeiro boleto, depois do último) só
  // ocupam espaço; os do meio ficam, para o buraco aparecer.
  const todosMeses = mesAMes(contas, hojeIso, ANTES, DEPOIS)
  const comDados = todosMeses.map((m, i) => (m.total.quantidade > 0 || m.mes === hojeIso.slice(0, 7) ? i : -1)).filter(i => i >= 0)
  const meses = todosMeses.slice(Math.min(...comDados), Math.max(...comDados) + 1)
  const semanas = semanasAFrente(contas, hojeIso, 8)
  const atraso = faixasDeAtraso(contas, hojeIso)
  const mesAtual = hojeIso.slice(0, 7)
  const proximo = somarMeses(mesAtual, 1)

  // ── Em aberto por fornecedor ──
  const abertas = contas.filter(c => { const s = situacaoDaConta(c, hojeIso); return s === 'vencido' || s === 'a_vencer' })
  type PorForn = { nome: string; vencido: number; mes: number; proximo: number; depois: number; total: number; qtd: number }
  const porForn = new Map<string, PorForn>()
  for (const c of abertas) {
    const k = c.fornecedor_id ?? '__sem__'
    const nome = c.fornecedores?.nome_fantasia || c.fornecedores?.razao_social || 'Sem fornecedor'
    const at = porForn.get(k) ?? { nome, vencido: 0, mes: 0, proximo: 0, depois: 0, total: 0, qtd: 0 }
    const v = Number(c.valor)
    const ym = c.vencimento.slice(0, 7)
    if (situacaoDaConta(c, hojeIso) === 'vencido') at.vencido += v
    else if (ym === mesAtual) at.mes += v
    else if (ym === proximo) at.proximo += v
    else at.depois += v
    at.total += v; at.qtd += 1
    porForn.set(k, at)
  }
  const rankForn = [...porForn.values()].sort((a, b) => b.total - a.total)

  // ── Em aberto por tipo de despesa ──
  const porTipo = new Map<string, { nome: string; cor: string; total: number; vencido: number; qtd: number }>()
  for (const c of abertas) {
    const t = c.tipo_despesa_id ? infoTipo.get(c.tipo_despesa_id) : null
    const k = t?.id ?? '__sem__'
    const at = porTipo.get(k) ?? { nome: t?.nome ?? 'Sem tipo', cor: t?.cor ?? '#d1d5db', total: 0, vencido: 0, qtd: 0 }
    at.total += Number(c.valor); at.qtd += 1
    if (situacaoDaConta(c, hojeIso) === 'vencido') at.vencido += Number(c.valor)
    porTipo.set(k, at)
  }
  const rankTipo = [...porTipo.values()].sort((a, b) => b.total - a.total)

  const maxSemana = Math.max(1, ...semanas.map(s => s.total))
  const maxAtraso = Math.max(1, ...atraso.map(a => a.total))
  const totalVencido = atraso.reduce((s, a) => s + a.total, 0)

  const dadosGrafico = meses.map(m => ({
    rotulo: `${nomeDoMes(m.mes).slice(0, 3)}/${m.mes.slice(2, 4)}`,
    pago: m.pago.total, vencido: m.vencido.total, aVencer: m.aVencer.total,
  }))

  const cartoes: [string, number, string, string][] = [
    ['🔴 Vencido', painel.vencido.total, `${painel.vencido.quantidade} boleto(s)`, painel.vencido.quantidade ? 'text-red-600' : 'text-gray-400'],
    ['📅 Esta semana', painel.semana.total, `falta ${fmt(painel.semana.aberto.total)}`, 'text-gray-900'],
    [`🗓 ${maiuscula(nomeDoMes(mesAtual))}`, painel.mes.total, `falta ${fmt(painel.mes.aberto.total)} · pago ${fmt(painel.mes.pago.total)}`, 'text-gray-900'],
    [`➡️ ${maiuscula(nomeDoMes(proximo))}`, painel.proximoMes.total, `${painel.proximoMes.quantidade} boleto(s)`, 'text-blue-700'],
    ['💳 Total em aberto', painel.totalAberto.total, `${painel.totalAberto.quantidade} boleto(s)`, 'text-gray-900'],
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cartoes.map(([t, v, l, cor]) => (
          <div key={t} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-gray-500">{t}</p>
            <p className={`text-lg sm:text-xl font-bold ${cor}`}>{fmt(v)}</p>
            <p className="text-[11px] text-gray-500">{l}</p>
          </div>
        ))}
      </div>

      {/* Mês a mês */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Boletos mês a mês</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Pela data de vencimento: quanto venceu (ou vai vencer) em cada mês, quanto disso foi pago e quanto ficou para trás.
          </p>
        </div>
        <div className="px-2 pt-3"><GraficoMesAMes dados={dadosGrafico} /></div>
        {/* Celular: um mês por linha, os números embaixo */}
        <ul className="md:hidden divide-y divide-gray-100 border-t border-gray-100">
          {meses.map(m => (
            <li key={m.mes} className={`px-4 py-2.5 ${m.mes === mesAtual ? 'bg-blue-50/50' : ''}`}>
              <Link href={linkLista(`${m.mes}-01`, ultimoDiaDoMes(m.mes))} className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-blue-700">{maiuscula(rotuloDoMes(m.mes))}{m.mes === mesAtual && <span className="ml-1.5 text-[10px] font-medium">este mês</span>}</span>
                <span className="text-sm font-semibold text-gray-900">{m.total.total ? fmt(m.total.total) : '—'}</span>
              </Link>
              {m.total.quantidade > 0 && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {m.total.quantidade} boleto(s)
                  {m.pago.total > 0 && <span className="text-green-700"> · pago {fmt(m.pago.total)}</span>}
                  {m.vencido.total > 0 && <span className="text-red-600"> · vencido {fmt(m.vencido.total)}</span>}
                  {m.aVencer.total > 0 && <span className="text-amber-700"> · a vencer {fmt(m.aVencer.total)}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Mês</th>
                <th className="px-3 py-2 text-right font-medium">Boletos</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Pago</th>
                <th className="px-3 py-2 text-right font-medium">Vencido sem pagar</th>
                <th className="px-4 py-2 text-right font-medium">A vencer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {meses.map(m => (
                <tr key={m.mes} className={m.mes === mesAtual ? 'bg-blue-50/50' : ''}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link href={linkLista(`${m.mes}-01`, ultimoDiaDoMes(m.mes))} className="text-blue-700 hover:underline">
                      {maiuscula(rotuloDoMes(m.mes))}
                    </Link>
                    {m.mes === mesAtual && <span className="ml-1.5 text-[10px] text-blue-600 font-medium">este mês</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{m.total.quantidade || '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{m.total.total ? fmt(m.total.total) : '—'}</td>
                  <td className="px-3 py-2 text-right text-green-700 whitespace-nowrap">{m.pago.total ? fmt(m.pago.total) : '—'}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap ${m.vencido.total ? 'text-red-600 font-medium' : 'text-gray-300'}`}>{m.vencido.total ? fmt(m.vencido.total) : '—'}</td>
                  <td className="px-4 py-2 text-right text-amber-700 whitespace-nowrap">{m.aVencer.total ? fmt(m.aVencer.total) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Próximas semanas */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Próximas 8 semanas</h2>
            <p className="text-xs text-gray-500 mt-0.5">O que ainda vai vencer, semana a semana (segunda a domingo).</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {semanas.map((s, i) => (
              <li key={s.de}>
                <Link href={linkLista(s.de, s.ate, 'a_vencer')} className="block px-4 py-2 hover:bg-gray-50">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-gray-700">
                      {i === 0 ? 'Esta semana' : i === 1 ? 'Semana que vem' : 'Semana'} <span className="text-gray-400 text-xs">{diaMes(s.de)} a {diaMes(s.ate)}</span>
                    </span>
                    <span className={s.total ? 'font-semibold text-gray-900' : 'text-gray-300'}>{s.total ? fmt(s.total) : '—'}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-amber-400 mt-1" style={{ width: `${(s.total / maxSemana) * 100}%`, minWidth: s.total ? '3px' : 0 }} />
                  {s.quantidade > 0 && <p className="text-[11px] text-gray-400 mt-0.5">{s.quantidade} boleto(s)</p>}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Atraso */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Vencidos por tempo de atraso</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalVencido > 0 ? <>{fmt(totalVencido)} vencidos sem pagar.</> : 'Nada vencido sem pagar.'}
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {atraso.map((a, i) => (
              <li key={a.rotulo} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-gray-700">{a.rotulo}</span>
                  <span className={a.total ? 'font-semibold text-red-600' : 'text-gray-300'}>{a.total ? fmt(a.total) : '—'}</span>
                </div>
                <div className="h-1.5 rounded-full mt-1" style={{ width: `${(a.total / maxAtraso) * 100}%`, minWidth: a.total ? '3px' : 0, background: ['#fca5a5', '#f87171', '#ef4444', '#dc2626', '#991b1b'][i] }} />
                {a.quantidade > 0 && <p className="text-[11px] text-gray-400 mt-0.5">{a.quantidade} boleto(s)</p>}
              </li>
            ))}
          </ul>
          {totalVencido > 0 && (
            <div className="px-4 py-2 border-t border-gray-100">
              <Link href="/dashboard/contas-pagar?situacao=vencido" className="text-xs text-blue-600 hover:underline">Ver os vencidos na lista →</Link>
            </div>
          )}
        </div>
      </div>

      {/* Por fornecedor */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Em aberto por fornecedor</h2>
          <p className="text-xs text-gray-500 mt-0.5">Quanto se deve a cada um, separado por quando vence.</p>
        </div>
        {rankForn.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">Nenhuma conta em aberto.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Fornecedor</th>
                  <th className="px-3 py-2 text-right font-medium">Vencido</th>
                  <th className="px-3 py-2 text-right font-medium">{nomeDoMes(mesAtual)}</th>
                  <th className="px-3 py-2 text-right font-medium">{nomeDoMes(proximo)}</th>
                  <th className="px-3 py-2 text-right font-medium">Depois</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rankForn.slice(0, 20).map(f => (
                  <tr key={f.nome}>
                    <td className="px-4 py-2 text-gray-900 max-w-[16rem]">
                      <p className="truncate" title={f.nome}>{f.nome}</p>
                      <p className="text-[11px] text-gray-400">{f.qtd} boleto(s)</p>
                    </td>
                    {[f.vencido, f.mes, f.proximo, f.depois].map((v, i) => (
                      <td key={i} className={`px-3 py-2 text-right whitespace-nowrap ${!v ? 'text-gray-300' : i === 0 ? 'text-red-600 font-medium' : 'text-gray-700'}`}>{v ? fmt(v) : '—'}</td>
                    ))}
                    <td className="px-4 py-2 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(f.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rankForn.length > 20 && <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">Mostrando os 20 maiores de {rankForn.length} fornecedores.</p>}
          </div>
        )}
      </div>

      {/* Por tipo de despesa */}
      {rankTipo.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">Em aberto por tipo de despesa</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {rankTipo.map(t => (
              <li key={t.nome} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.cor }} />
                <span className="flex-1 min-w-0 truncate text-gray-800">{t.nome} <span className="text-[11px] text-gray-400">{t.qtd} boleto(s)</span></span>
                {t.vencido > 0 && <span className="text-xs text-red-600 whitespace-nowrap">{fmt(t.vencido)} vencido</span>}
                <span className="font-semibold text-gray-900 whitespace-nowrap">{fmt(t.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
