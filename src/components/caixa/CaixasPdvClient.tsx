'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  AbrirCaixaModal, FecharCaixaModal, ComprovanteFechamento,
  type CaixaPdvSessao, type ResultadoFechamento,
} from './SessaoModais'

// Os caixas de PDV — uma linha por gaveta, com o estado do turno.
//
// A tela separa duas coisas que o operador também separa na cabeça: o Caixa
// da Empresa (tesouraria), que é um saldo só, e as gavetas, que abrem e
// fecham todo dia. Aqui ficam as gavetas.
//
// Gaveta sem caixa criado aparece como fechada: o caixa nasce na primeira
// operação, e mostrar "ainda não existe" não ajudaria ninguém a decidir
// nada.

function reais(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function hora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function CaixasPdvClient({ aoMudar }: { aoMudar?: () => void }) {
  const [caixas, setCaixas] = useState<CaixaPdvSessao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [abrindo, setAbrindo] = useState<CaixaPdvSessao | null>(null)
  const [fechando, setFechando] = useState<CaixaPdvSessao | null>(null)
  const [comprovante, setComprovante] = useState<ResultadoFechamento | null>(null)

  const carregar = useCallback(async () => {
    const d = await fetch('/api/caixa/pdvs').then(r => r.json()).catch(() => null)
    if (d?.ok) setCaixas(d.caixas)
    setCarregando(false)
  }, [])

  useEffect(() => {
    let vivo = true
    fetch('/api/caixa/pdvs').then(r => r.json()).catch(() => null).then(d => {
      if (!vivo) return
      if (d?.ok) setCaixas(d.caixas)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [])

  function depoisDeMudar() {
    carregar()
    aoMudar?.()
  }

  if (carregando) return <p className="text-sm text-gray-400">Carregando caixas...</p>

  if (caixas.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">
        Nenhum terminal de PDV ativo nesta empresa.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {caixas.map(c => {
        const aberto = !!c.sessao_id
        return (
          <div key={c.terminal_id} className="rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold text-gray-900">
                    {c.caixa_nome ?? `Caixa ${c.terminal_nome}`}
                  </p>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                    aberto ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                           : 'text-gray-500 bg-gray-50 border-gray-200'}`}>
                    {aberto ? 'ABERTO' : 'FECHADO'}
                  </span>
                </div>

                {aberto ? (
                  <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">
                    <p>Aberto às {hora(c.sessao_aberta_em!)}</p>
                    <p>Fundo inicial: {reais(c.sessao_fundo_inicial ?? 0)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1.5">Terminal {c.terminal_nome}</p>
                )}
              </div>

              {aberto && (
                <div className="text-right">
                  <p className="text-xs text-gray-500">Esperado agora</p>
                  <p className={`text-2xl font-semibold ${
                    (c.saldo_esperado ?? 0) < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                    {reais(c.saldo_esperado ?? 0)}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4 flex-wrap">
              {aberto ? (
                <button onClick={() => setFechando(c)}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg">
                  Fechar caixa
                </button>
              ) : (
                <button onClick={() => setAbrindo(c)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg">
                  Abrir caixa
                </button>
              )}
            </div>
          </div>
        )
      })}

      {abrindo && (
        <AbrirCaixaModal caixa={abrindo} aoFechar={() => setAbrindo(null)}
          aoAbrir={() => { setAbrindo(null); depoisDeMudar() }} />
      )}
      {fechando && (
        <FecharCaixaModal caixa={fechando} aoFechar={() => setFechando(null)}
          aoFechado={(r) => { setFechando(null); setComprovante(r); depoisDeMudar() }} />
      )}
      {comprovante && (
        <ComprovanteFechamento r={comprovante} aoFechar={() => setComprovante(null)} />
      )}
    </div>
  )
}
