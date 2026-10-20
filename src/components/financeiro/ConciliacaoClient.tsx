'use client'

import { useEffect, useState } from 'react'
import { hojeISO } from '@/lib/financeiro/taxas'

// A CONFERÊNCIA CONTRA O QUE A ADQUIRENTE PAGOU.
//
// O ledger já sabe o que passou na maquininha e quanto deveria custar. Esta
// tela traz o outro lado: o relatório de Liberações do Mercado Pago, que diz
// quanto ele PAGOU, em que dia, e quanto cobrou de verdade.
//
// O fluxo é em três passos porque o relatório é assíncrono: pede-se, espera-se
// alguns minutos, e só então o arquivo existe para baixar.

type Importacao = {
  id: string; arquivo: string
  periodo_de: string | null; periodo_ate: string | null
  linhas_lidas: number; linhas_novas: number; linhas_descartadas: number
  erro: string | null; cabecalho_recebido: string[] | null; created_at: string
}
type Dia = {
  data: string; bruto: number; taxa: number; liquido: number; custo: number; lancamentos: number
  recebimento: number; saida: number; saque: number; ajuste: number
}
type Relatorio = { nomeArquivo: string; status: string | null; de: string | null; ate: string | null }

function brl(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataBR(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export default function ConciliacaoClient() {
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const [tokenOk, setTokenOk] = useState(true)
  const [importacoes, setImportacoes] = useState<Importacao[]>([])
  const [dias, setDias] = useState<Dia[]>([])
  const [suspeitos, setSuspeitos] = useState(0)
  const [relatorios, setRelatorios] = useState<Relatorio[] | null>(null)
  const [cabecalho, setCabecalho] = useState<string[] | null>(null)

  const [de, setDe] = useState(() => {
    const d = new Date(Date.now() - 7 * 86400_000)
    return d.toISOString().slice(0, 10)
  })
  const [ate, setAte] = useState(hojeISO())

  async function carregar() {
    setCarregando(true)
    try {
      const r = await fetch('/api/financeiro/adquirente/importar')
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro)
      setTokenOk(j.tokenConfigurado)
      setImportacoes(j.importacoes); setDias(j.dias); setSuspeitos(j.suspeitos)
    } catch (e: any) { setErro(e?.message ?? 'Erro ao carregar.') }
    finally { setCarregando(false) }
  }

  useEffect(() => { carregar() }, [])

  async function acao(corpo: any, rotulo: string) {
    setOcupado(rotulo); setErro(''); setAviso(''); setCabecalho(null)
    try {
      const r = await fetch('/api/financeiro/adquirente/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const j = await r.json()
      // O cabeçalho recebido aparece mesmo quando deu errado — é justamente
      // no erro que ele é a informação útil.
      if (j.cabecalhoRecebido) setCabecalho(j.cabecalhoRecebido)
      if (!j.ok) throw new Error(j.erro ?? 'Nao foi possivel completar.')
      return j
    } catch (e: any) {
      setErro(e?.message ?? 'Erro.')
      return null
    } finally { setOcupado('') }
  }

  async function pedir() {
    const j = await acao({ acao: 'pedir', de, ate }, 'pedir')
    if (j) setAviso(j.mensagem ?? 'Relatorio solicitado.')
  }

  async function listar() {
    const j = await acao({ acao: 'listar' }, 'listar')
    if (j) {
      setRelatorios(j.relatorios)
      if (j.relatorios.length === 0) {
        setAviso('Nenhum relatorio pronto ainda. Depois de pedir, costuma levar alguns minutos.')
      }
    }
  }

  async function importar(arquivo: string) {
    const j = await acao({ acao: 'importar', arquivo, de, ate }, arquivo)
    if (j) {
      setAviso(
        `${j.lidas} linha(s) lida(s): ${j.novas} nova(s), ${j.repetidas} ja estavam. ` +
        (j.descartadas?.length ? `${j.descartadas.length} descartada(s).` : ''),
      )
      carregar()
    }
  }

  if (carregando) return <p className="text-sm text-slate-400">Carregando…</p>

  return (
    <div className="space-y-6">
      {!tokenOk && (
        // Sem o token, os três botões não têm o que fazer. Dizer o nome exato
        // da variável porque existe outra parecida em produção, das
        // assinaturas — e conferir a errada custa a tarde de alguém.
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            <strong>O token do Mercado Pago não está configurado no servidor.</strong>{' '}
            Defina <code>MP_RELATORIOS_TOKEN</code> nas variáveis de ambiente do projeto e
            faça um deploy novo — variável só passa a valer em deploy novo.
          </p>
        </div>
      )}

      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <h2 className="font-semibold text-slate-800">1. Pedir o relatório</h2>
        <p className="text-xs text-slate-500 mt-1 mb-3">
          O Mercado Pago gera o arquivo em segundo plano. Costuma levar alguns minutos.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">De</label>
            <input type="date" value={de} onChange={e => setDe(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Até</label>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={pedir} disabled={!!ocupado || !tokenOk}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl">
            {ocupado === 'pedir' ? 'Pedindo…' : 'Pedir relatório'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">2. Importar um arquivo pronto</h2>
            <p className="text-xs text-slate-500 mt-1">
              Importar o mesmo arquivo duas vezes não duplica nada — a trava é do banco.
            </p>
          </div>
          <button onClick={listar} disabled={!!ocupado || !tokenOk}
            className="px-4 py-2 border border-slate-200 hover:border-slate-300 disabled:opacity-50 text-sm font-medium rounded-xl">
            {ocupado === 'listar' ? 'Buscando…' : 'Ver arquivos'}
          </button>
        </div>

        {relatorios && relatorios.length > 0 && (
          <div className="mt-4 divide-y divide-slate-50 border border-slate-100 rounded-xl">
            {relatorios.map(r => (
              <div key={r.nomeArquivo} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{r.nomeArquivo}</p>
                  <p className="text-xs text-slate-400">
                    {r.status ?? 'sem status'}
                    {r.de && <> · {dataBR(r.de)}{r.ate && ` a ${dataBR(r.ate)}`}</>}
                  </p>
                </div>
                <button onClick={() => importar(r.nomeArquivo)} disabled={!!ocupado}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex-shrink-0">
                  {ocupado === r.nomeArquivo ? 'Importando…' : 'Importar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {aviso && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <p className="text-sm text-emerald-900">{aviso}</p>
        </div>
      )}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      {cabecalho && (
        // O CABEÇALHO QUE CHEGOU. As colunas do relatório dependem da
        // configuração da conta no Mercado Pago, então esta é a informação que
        // permite consertar o leitor quando ele não reconhece o arquivo.
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <p className="text-xs font-medium text-slate-600 mb-1">Colunas que o arquivo trouxe</p>
          <p className="text-xs text-slate-500 font-mono break-words">{cabecalho.join(' · ')}</p>
          <p className="text-xs text-slate-400 mt-1.5">
            Se faltou alguma coluna obrigatória, me mande esta lista: as colunas dependem da
            configuração da sua conta, e é com ela que eu ajusto o leitor.
          </p>
        </div>
      )}

      {suspeitos > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            <strong>{suspeitos} lançamento(s) aparecendo mais de uma vez no extrato.</strong>{' '}
            Pode ser o mesmo arquivo reemitido com formatação diferente. Vale conferir antes
            de usar os totais.
          </p>
        </div>
      )}

      {dias.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-1">O que o Mercado Pago liberou</h2>
          <p className="text-xs text-slate-500 mb-2">
            Por data de <strong>liberação</strong>, não de venda. As linhas de{' '}
            <strong>reserva</strong> ficam de fora: são a contrapartida contábil das mesmas
            operações que já aparecem como pagamento, e somá-las contaria o mesmo dinheiro
            duas vezes.
          </p>
          <p className="text-xs text-slate-500 mb-2">
            Separado pela <strong>direção do dinheiro</strong>: venda que entrou, pagamento
            feito pela conta, e saque para o banco. Somar os três num número só faz o dia de
            saque parecer prejuízo.
          </p>
          <p className="text-xs text-slate-500 mb-2">
            O <strong>custo</strong> é bruto menos líquido — o que realmente deixou de entrar.
            Ele costuma ser maior que a tarifa declarada no arquivo: numa venda no crédito de
            R$ 30,00, o Mercado Pago declara R$ 0,17 de tarifa e credita R$ 29,08, custo real
            de R$ 0,92. A diferença aparece em linhas separadas, de antecipação.
          </p>
          <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
            {dias.slice(0, 60).map(d => (
              <div key={d.data} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">
                    {dataBR(d.data)}
                    <span className="text-slate-400"> · {d.lancamentos} lançamento(s)</span>
                  </span>
                  <span className="text-sm">
                    <span className="text-emerald-700 font-semibold">{brl(d.recebimento)}</span>
                    <span className="text-slate-400"> entrou de venda</span>
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-4">
                  {d.saida !== 0 && (
                    <span className="text-red-700">pagamentos pela conta {brl(d.saida)}</span>
                  )}
                  {d.saque !== 0 && (
                    <span>saque para o banco {brl(d.saque)}</span>
                  )}
                  {d.ajuste !== 0 && (
                    <span>ajustes {brl(d.ajuste)}</span>
                  )}
                  {d.custo !== 0 && (
                    <span>
                      custo {brl(d.custo)}
                      {d.custo !== d.taxa && <span className="text-slate-400"> (tarifa declarada {brl(d.taxa)})</span>}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {importacoes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Importações</h2>
          <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
            {importacoes.map(i => (
              <div key={i.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 truncate">{i.arquivo}</span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {new Date(i.created_at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {i.linhas_lidas} lida(s) · {i.linhas_novas} nova(s)
                  {i.linhas_descartadas > 0 && ` · ${i.linhas_descartadas} descartada(s)`}
                </p>
                {i.erro && <p className="text-xs text-red-700 mt-0.5">{i.erro}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {dias.length === 0 && importacoes.length === 0 && (
        <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-4">
          Nada importado ainda. Comece pedindo o relatório de um período acima.
        </p>
      )}
    </div>
  )
}
