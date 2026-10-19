'use client'

import { useEffect, useMemo, useState } from 'react'
import EnvioContadorCard from './EnvioContadorCard'

// Fechamento do contador: escolhe o mês, confere o resumo e as pendências,
// baixa o .zip com os XMLs de venda e de compra.

type Totais = { quantidade: number; valor: number }
type Pendencia = { tipo: string; quantidade: number; detalhe: string; exemplos?: string[] }
type NotaCompra = { numero: string; serie: string; emissao: string; valor: number; contraparte: string; origem: string; chave: string }
type Resumo = {
  periodo: { mes: string; rotulo: string }
  vendasNfce: Totais; vendasNfe: Totais; compras: Totais
  pendencias: Pendencia[]
  notasCompra: NotaCompra[]
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCnpj = (c: string) => c.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const dataBr = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${m[3]}/${m[2]}` : '' }

/** Os últimos 13 meses, do mais recente para trás (inclui o mês corrente). */
function opcoesDeMes(): { valor: string; rotulo: string }[] {
  const hoje = new Date()
  const out: { valor: string; rotulo: string }[] = []
  for (let i = 0; i < 13; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    out.push({ valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, rotulo: `${MESES[d.getMonth()]} de ${d.getFullYear()}${i === 0 ? ' (em andamento)' : ''}` })
  }
  return out
}

export default function FechamentoContadorClient({ mesInicial, empresa }: {
  mesInicial: string
  empresa: { nome: string; cnpj: string; contador: string | null; emailContador: string | null }
}) {
  const meses = useMemo(() => opcoesDeMes(), [])
  const [mes, setMes] = useState(mesInicial)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [baixando, setBaixando] = useState<string | null>(null)
  const [verCompras, setVerCompras] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`/api/fiscal/fechamento?mes=${mes}&formato=resumo`)
      .then(r => r.json())
      .then(d => {
        if (!vivo) return
        if (!d.ok) { setErro(d.erro ?? 'Não foi possível montar o resumo'); setResumo(null) } else { setErro(''); setResumo(d) }
      })
      .catch(() => { if (vivo) setErro('Falha de conexão ao montar o resumo') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [mes])

  function trocarMes(m: string) { setCarregando(true); setResumo(null); setMes(m) }

  async function baixar(partes: '' | 'vendas' | 'compras') {
    setBaixando(partes || 'tudo'); setErro('')
    try {
      const r = await fetch(`/api/fiscal/fechamento?mes=${mes}&formato=zip${partes ? `&partes=${partes}` : ''}`)
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        // Resposta grande demais para a hospedagem: o pacote em duas partes cabe.
        setErro(d.erro ?? (r.status === 413 || r.status >= 500
          ? 'O pacote ficou grande demais para baixar de uma vez. Baixe vendas e compras separadamente.'
          : 'Não foi possível gerar o arquivo'))
        return
      }
      const blob = await r.blob()
      const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? `Fechamento_${mes}.zip`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = nome
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch {
      setErro('Falha de conexão ao baixar o arquivo')
    } finally { setBaixando(null) }
  }

  const totalNotas = resumo ? resumo.vendasNfce.quantidade + resumo.vendasNfe.quantidade + resumo.compras.quantidade : 0
  const mesAtual = meses[0]?.valor === mes

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Fechamento do Contador</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Os XMLs das notas de venda e de compra do mês, num arquivo .zip para enviar à contabilidade.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-end gap-3 sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">Empresa (CNPJ das notas)</p>
          <p className="text-sm font-medium text-gray-900 truncate">{empresa.nome}</p>
          <p className="text-xs text-gray-400 font-mono">{fmtCnpj(empresa.cnpj)}</p>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Mês de competência</label>
          <select value={mes} onChange={e => trocarMes(e.target.value)}
            className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-base sm:text-sm bg-white focus:outline-none focus:border-blue-500">
            {meses.map(m => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
          </select>
        </div>
      </div>

      {mesAtual && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Este mês ainda não terminou — o pacote sai só com o que foi emitido até agora.
        </p>
      )}

      {erro && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

      {carregando ? (
        <div className="bg-white border border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">Lendo as notas do mês…</div>
      ) : resumo && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['🧾 Vendas — NFC-e (balcão)', resumo.vendasNfce, 'text-emerald-700'],
              ['📦 Vendas — NF-e', resumo.vendasNfe, 'text-blue-700'],
              ['🛒 Compras — NF-e', resumo.compras, 'text-orange-700'],
            ] as const).map(([titulo, t, cor]) => (
              <div key={titulo} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500">{titulo}</p>
                <p className={`text-2xl font-semibold ${cor}`}>{t.quantidade.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-gray-500">{brl(t.valor)}</p>
              </div>
            ))}
          </div>

          {resumo.vendasNfe.quantidade === 0 && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              As NF-e dos pedidos de marketplace emitidas em outro sistema não estão aqui — baixe-as por lá
              até a emissão passar a ser feita pelo Vargas.
            </p>
          )}

          {resumo.pendencias.length > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
              <p className="text-sm font-medium text-amber-900">⚠ Confira antes de enviar</p>
              <ul className="space-y-1.5">
                {resumo.pendencias.map(p => (
                  <li key={p.tipo} className="text-xs text-amber-900">
                    <strong>{p.tipo}: {p.quantidade}</strong> — {p.detalhe}
                    {p.exemplos && p.exemplos.length > 0 && (
                      <span className="block text-amber-700">{p.exemplos.join(' · ')}{p.quantidade > p.exemplos.length ? ' …' : ''}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : totalNotas > 0 && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ Nenhuma pendência encontrada neste mês.</p>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Baixar o pacote</p>
              <p className="text-xs text-gray-500">
                Pastas <code className="text-[11px] bg-gray-100 px-1 rounded">Vendas/NFC-e</code>, <code className="text-[11px] bg-gray-100 px-1 rounded">Vendas/NF-e</code> e{' '}
                <code className="text-[11px] bg-gray-100 px-1 rounded">Compras/NF-e</code>, mais a planilha <strong>resumo.csv</strong> (abre no Excel) e um LEIA-ME com os totais.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => baixar('')} disabled={!!baixando || totalNotas === 0}
                className="px-4 py-2.5 sm:py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {baixando === 'tudo' ? 'Gerando o .zip…' : `⬇ Baixar tudo (.zip · ${totalNotas} notas)`}
              </button>
              <button onClick={() => baixar('vendas')} disabled={!!baixando || resumo.vendasNfce.quantidade + resumo.vendasNfe.quantidade === 0}
                className="px-4 py-2.5 sm:py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm rounded-lg">
                {baixando === 'vendas' ? 'Gerando…' : 'Só vendas'}
              </button>
              <button onClick={() => baixar('compras')} disabled={!!baixando || resumo.compras.quantidade === 0}
                className="px-4 py-2.5 sm:py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm rounded-lg">
                {baixando === 'compras' ? 'Gerando…' : 'Só compras'}
              </button>
            </div>
          </div>

          <EnvioContadorCard mes={mes} rotulo={resumo.periodo.rotulo} totalNotas={totalNotas} />

          {resumo.notasCompra.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl">
              <button onClick={() => setVerCompras(v => !v)} className="w-full text-left px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-xl">
                {verCompras ? '▾' : '▸'} Notas de compra do mês ({resumo.notasCompra.length})
              </button>
              {verCompras && (
                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {resumo.notasCompra.map(n => (
                    <li key={n.chave || `${n.numero}-${n.contraparte}`} className="px-4 py-2 flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-gray-900 break-words">{n.contraparte || '—'}</p>
                        <p className="text-xs text-gray-500">NF {n.numero}{n.serie ? `/${n.serie}` : ''} · {dataBr(n.emissao)}
                          {n.origem !== 'Lançada no estoque' && <span className="text-amber-700"> · {n.origem}</span>}</p>
                      </div>
                      <p className="shrink-0 text-gray-800 font-medium">{brl(n.valor)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
