'use client'

import { useEffect, useState } from 'react'

// O CAIXA, FINALMENTE VISÍVEL.
//
// Quatro tabelas e seis RPCs existiam desde setembro sem nenhuma tela. Esta é
// a primeira: saldo de cada caixa, extrato de um deles, e o que a venda
// deixou de fora.
//
// A separação entre banco e adquirente é o que esta tela existe para mostrar:
// em "Conta bancária" o dinheiro está disponível; em "Adquirente" ele existe e
// AINDA NÃO CHEGOU. Um total único somando os dois mentiria sobre o que dá
// para gastar hoje — e é essa mentira que faz lojista sacar dinheiro que
// ainda não caiu.

type Caixa = { id: string; nome: string; tipo: string; ativo: boolean; saldo: number }
type Mov = {
  id: string; tipo: string; natureza: string; valor: number
  forma_pagamento: string | null; referencia_tipo: string | null
  observacao: string | null; created_at: string
}
type Fora = {
  venda_id: string; created_at: string; terminal_id: string | null
  forma_pagamento: string | null; total: number; motivo: string
}

const TITULO: Record<string, string> = {
  pdv: 'Gavetas do balcão',
  tesouraria: 'Tesouraria',
  banco: 'Contas bancárias — disponível',
  adquirente: 'Adquirentes — ainda não caiu',
}

const NATUREZA: Record<string, string> = {
  venda: 'Venda', taxa: 'Taxa', liquidacao: 'Liquidação',
  estorno_venda: 'Devolução', sangria: 'Sangria', sangria_recebida: 'Sangria recebida',
  suprimento: 'Suprimento', suprimento_entregue: 'Suprimento entregue',
  fundo_abertura: 'Fundo de abertura', diferenca_fechamento: 'Diferença no fechamento',
  aporte: 'Aporte', retirada_socio: 'Retirada', deposito_banco: 'Depósito', ajuste: 'Ajuste',
}

function brl(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function CaixaClient() {
  const [caixas, setCaixas] = useState<Caixa[]>([])
  const [movimentos, setMovimentos] = useState<Mov[]>([])
  const [fora, setFora] = useState<Fora[]>([])
  const [extratoDe, setExtratoDe] = useState<string | null>(null)
  const [lancaDesde, setLancaDesde] = useState<string | null>(null)
  const [dias, setDias] = useState(7)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  async function carregar(caixa?: string, d = dias) {
    setCarregando(true)
    try {
      const q = new URLSearchParams({ dias: String(d) })
      if (caixa) q.set('caixa', caixa)
      const r = await fetch(`/api/financeiro/caixa?${q}`)
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro ?? 'Não foi possível carregar.')
      setCaixas(j.caixas); setMovimentos(j.movimentos); setFora(j.fora)
      setExtratoDe(j.extratoDe); setLancaDesde(j.lancaDesde)
    } catch (e: any) { setErro(e?.message ?? 'Erro ao carregar.') }
    finally { setCarregando(false) }
  }

  useEffect(() => { carregar() }, [])

  if (carregando && caixas.length === 0) {
    return <p className="text-sm text-slate-400">Carregando o caixa…</p>
  }

  if (erro) {
    return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{erro}</div>
  }

  const grupos = ['pdv', 'tesouraria', 'banco', 'adquirente']
  const disponivel = caixas
    .filter(c => c.tipo === 'pdv' || c.tipo === 'tesouraria' || c.tipo === 'banco')
    .reduce((s, c) => s + c.saldo, 0)
  const aReceber = caixas.filter(c => c.tipo === 'adquirente').reduce((s, c) => s + c.saldo, 0)
  const atual = caixas.find(c => c.id === extratoDe)

  return (
    <div className="space-y-6">
      {!lancaDesde && (
        // Sem a data, a trigger não lança nada. Dizer isso na cara evita a
        // conclusão errada de que "o caixa está zerado porque não vendeu".
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            <strong>O lançamento automático está desligado.</strong> Nenhuma venda entra no
            caixa até existir uma data de início em <code>caixa_lancamento_config</code>.
          </p>
        </div>
      )}

      {/* OS DOIS TOTAIS, SEPARADOS. Nunca um só. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-emerald-100 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500">Disponível hoje</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{brl(disponivel)}</p>
          <p className="text-xs text-slate-400 mt-1">Gavetas, tesouraria e contas bancárias.</p>
        </div>
        <div className="bg-white border border-amber-100 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500">Ainda não caiu</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{brl(aReceber)}</p>
          <p className="text-xs text-slate-400 mt-1">
            O que a maquininha deve, já descontada a taxa.
          </p>
        </div>
      </div>

      {grupos.map(tipo => {
        const doTipo = caixas.filter(c => c.tipo === tipo)
        if (doTipo.length === 0) return null
        return (
          <div key={tipo}>
            <h2 className="text-sm font-semibold text-slate-700 mb-2">{TITULO[tipo] ?? tipo}</h2>
            <div className="space-y-1.5">
              {doTipo.map(c => (
                <button key={c.id} onClick={() => carregar(c.id)}
                  className={`w-full text-left bg-white border rounded-xl px-4 py-3 flex items-center justify-between transition-colors ${
                    c.id === extratoDe ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-100 hover:border-slate-300'
                  }`}>
                  <span className="text-sm text-slate-700">
                    {c.nome}
                    {!c.ativo && <span className="ml-2 text-xs text-slate-400">(desligado)</span>}
                  </span>
                  <span className={`text-sm font-semibold ${
                    c.saldo < 0 ? 'text-red-700' : c.saldo === 0 ? 'text-slate-400' : 'text-slate-800'
                  }`}>
                    {brl(c.saldo)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Extrato{atual ? ` — ${atual.nome}` : ''}
          </h2>
          <select value={dias}
            onChange={e => { const d = Number(e.target.value); setDias(d); carregar(extratoDe ?? undefined, d) }}
            className="text-sm bg-white border border-slate-200 rounded-lg px-2 py-1">
            <option value={1}>hoje e ontem</option>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
        </div>

        {movimentos.length === 0
          ? <p className="text-sm text-slate-400 bg-white border border-slate-100 rounded-xl p-4">
              Nenhum movimento neste caixa no período.
            </p>
          : <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
              {movimentos.map(m => (
                <div key={m.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">
                      {NATUREZA[m.natureza] ?? m.natureza}
                      {m.forma_pagamento && <span className="text-slate-400"> · {m.forma_pagamento}</span>}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {quando(m.created_at)}
                      {m.observacao && ` · ${m.observacao}`}
                    </p>
                  </div>
                  <span className={`text-sm font-medium flex-shrink-0 ${
                    m.tipo === 'entrada' ? 'text-emerald-700' : 'text-red-700'
                  }`}>
                    {m.tipo === 'entrada' ? '+' : '−'} {brl(Number(m.valor))}
                  </span>
                </div>
              ))}
            </div>}
      </div>

      {fora.length > 0 && (
        // A CONTRAPARTIDA HONESTA. Sem esta lista, a soma do caixa pareceria
        // completa — e foi o silêncio que deixou 3.957 vendas fora do ledger
        // sem ninguém notar.
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-1">
            Vendas que não entraram no caixa ({fora.length})
          </h2>
          <p className="text-xs text-slate-500 mb-2">
            Fiado e carteira aparecem aqui por desenho: o título vive em Contas a Receber.
            O resto é o que falta resolver.
          </p>
          <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
            {fora.slice(0, 50).map(f => (
              <div key={f.venda_id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">
                    {f.forma_pagamento ?? '(sem forma)'}
                    <span className="text-slate-400"> · {quando(f.created_at)}</span>
                    {f.terminal_id && <span className="text-slate-400"> · {f.terminal_id}</span>}
                  </span>
                  <span className="text-sm text-slate-500 flex-shrink-0">{brl(Number(f.total))}</span>
                </div>
                <p className="text-xs text-amber-700 mt-0.5">{f.motivo}</p>
              </div>
            ))}
          </div>
          {fora.length > 50 && (
            <p className="text-xs text-slate-400 mt-1">
              Mostrando 50 de {fora.length}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
