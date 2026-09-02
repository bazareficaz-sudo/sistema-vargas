'use client'

import { FormEvent, useState } from 'react'

export type DashboardQuestionContext = {
  vendasHoje: number
  quantidadeVendasHoje: number
  ticketMedioHoje: number
  projecaoFechamento: number
  variacaoRitmo: number | null
  variacaoTicket: number | null
  faturamentoMes: number
  contasReceber: number
  contasReceberVencidas: number
  contasPagar: number
  contasPagarVencidas: number
  saldoPrevisto30: number
  comprasMes: number
  variacaoCompras: number | null
  percentualVendasSemCliente: number
  vendasMarketplaceHoje: number
  produtoMaiorFaturamentoMes: string | null
  produtoMaiorFaturamentoMesValor: number
  produtoMaisVendidoMes: string | null
  produtoMaisVendidoMesQuantidade: number
  vendedorCampeaoMes: string | null
  vendedorCampeaoMesFaturamento: number
  vendedorCampeaoMesVendas: number
}

type Answer = { resposta: string; evidencias: string[]; sugestoes: string[]; modo?: 'ia' | 'automatico' }

const PERGUNTAS_DASHBOARD = [
  'Por que meu saldo previsto ficou negativo?',
  'Como estão as vendas de hoje?',
  'O que exige atenção agora?',
]

// O PAINEL DEIXOU DE SER SÓ DO DASHBOARD.
//
// Ele nasceu com o contexto do dashboard embutido no tipo. Para o mesmo
// painel responder sobre anúncios e marketplaces, o que muda é o ENDEREÇO e o
// CONTEÚDO — a mecânica (perguntar, esperar, mostrar evidências, distinguir
// resposta da IA de resposta automática) é a mesma.
//
// O contexto ficou aberto de propósito: cada tela sabe o que tem para
// oferecer, e quem valida é a rota do lado do servidor, que é onde a validação
// vale alguma coisa. Tipar aqui daria uma falsa sensação de garantia — o JSON
// chega no servidor por HTTP e precisa ser normalizado lá de qualquer forma.
export type ContextoPergunta = Record<string, unknown>

export default function AskVargas({
  context,
  endpoint = '/api/dashboard/perguntar',
  perguntasSugeridas = PERGUNTAS_DASHBOARD,
  descricao = 'Pergunte sobre vendas, caixa, contas e compras usando os dados atualizados desta tela.',
  exemplo = 'Ex.: Por que meu saldo previsto ficou negativo?',
}: {
  context: ContextoPergunta
  endpoint?: string
  perguntasSugeridas?: string[]
  descricao?: string
  exemplo?: string
}) {
  const [pergunta, setPergunta] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  async function perguntar(event?: FormEvent, textoSugerido?: string) {
    event?.preventDefault()
    const texto = (textoSugerido ?? pergunta).trim()
    if (!texto || loading) return
    setPergunta(texto)
    setLoading(true)
    setErro('')
    setAnswer(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta: texto, contexto: context }),
      })
      const data = await response.json() as { ok?: boolean; erro?: string; resultado?: Answer }
      if (!response.ok || !data.ok || !data.resultado) throw new Error(data.erro || 'Não foi possível analisar os dados agora.')
      setAnswer(data.resultado)
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível analisar os dados agora.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-indigo-900/60 bg-slate-950 p-5 text-white shadow-sm" aria-labelledby="pergunte-vargas-titulo">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold" id="pergunte-vargas-titulo">
          <SparkIcon /> Pergunte ao Vargas
        </div>
        {answer?.modo && (
          <span className="rounded-full border border-slate-700 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            {answer.modo === 'ia' ? 'Análise com IA' : 'Análise automática'}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">{descricao}</p>

      <form className="mt-4 flex gap-2" onSubmit={event => perguntar(event)}>
        <input
          value={pergunta}
          onChange={event => setPergunta(event.target.value)}
          disabled={loading}
          maxLength={300}
          placeholder={exemplo}
          aria-label="Pergunta para o Vargas"
          className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-xs text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!pergunta.trim() || loading}
          className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Enviar pergunta"
        >
          {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <SendIcon />}
        </button>
      </form>

      {!answer && !loading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {perguntasSugeridas.map(sugestao => (
            <button key={sugestao} type="button" onClick={() => perguntar(undefined, sugestao)}
              className="rounded-full border border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-400 transition hover:border-indigo-500 hover:text-white">
              {sugestao}
            </button>
          ))}
        </div>
      )}

      {erro && <p role="alert" className="mt-3 rounded-xl bg-red-950/50 px-3 py-2 text-xs text-red-300">{erro}</p>}

      {answer && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4" aria-live="polite">
          <p className="text-sm leading-6 text-slate-100">{answer.resposta}</p>
          {answer.evidencias.length > 0 && (
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Evidências usadas</p>
              <ul className="mt-2 space-y-1.5">
                {answer.evidencias.map(evidencia => <li key={evidencia} className="flex gap-2 text-[11px] leading-4 text-slate-400"><span className="text-indigo-400">•</span>{evidencia}</li>)}
              </ul>
            </div>
          )}
          <button type="button" onClick={() => { setAnswer(null); setPergunta('') }} className="mt-4 text-[10px] font-semibold text-indigo-400 hover:text-indigo-300">Fazer outra pergunta</button>
        </div>
      )}
    </section>
  )
}

function SparkIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 1.1 3.2a4 4 0 0 0 2.5 2.5L19 10l-3.4 1.2a4 4 0 0 0-2.5 2.5L12 17l-1.2-3.3a4 4 0 0 0-2.5-2.5L5 10l3.3-1.3a4 4 0 0 0 2.5-2.5L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
}

function SendIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 16 8-16 8 3-8-3-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M7 12h13" stroke="currentColor" strokeWidth="1.8" /></svg>
}
