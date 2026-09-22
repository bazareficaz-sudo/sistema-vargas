'use client'

import { useState, useEffect } from 'react'
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

// `revalidacao` é o caminho PAI → FILHO que faltava.
//
// Sangria e suprimento acontecem no componente de cima, onde mora o modal.
// Antes, este componente só carregava na montagem (`useEffect` com `[]`) e
// não tinha como saber que a gaveta havia mudado — o card ficava com o
// esperado velho até um F5. O contador muda a cada operação bem-sucedida em
// qualquer ponto da tela, e o efeito abaixo relê o estado do SERVIDOR.
//
// Contador, e não os dados em si: quem sabe o saldo é o servidor. Somar o
// valor da sangria no número que já está na tela seria inventar saldo no
// frontend, que é justamente o que este módulo não faz em lugar nenhum.
export default function CaixasPdvClient({ aoMudar, revalidacao = 0 }: {
  aoMudar?: () => void
  revalidacao?: number
}) {
  const [caixas, setCaixas] = useState<CaixaPdvSessao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [abrindo, setAbrindo] = useState<CaixaPdvSessao | null>(null)
  const [fechando, setFechando] = useState<CaixaPdvSessao | null>(null)
  const [comprovante, setComprovante] = useState<ResultadoFechamento | null>(null)

  // Carga inicial E revalidação, no mesmo efeito: um caminho só para trazer
  // o estado, em vez de duas funções que podem divergir.
  useEffect(() => {
    let vivo = true
    fetch('/api/caixa/pdvs').then(r => r.json()).catch(() => null).then(d => {
      if (!vivo) return
      if (d?.ok) setCaixas(d.caixas)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [revalidacao])

  // Abrir e fechar avisam o pai, que incrementa `revalidacao` — e é o
  // incremento que faz este componente recarregar. Recarregar aqui também
  // seria um GET a mais pelo mesmo motivo.
  //
  // Nada aqui reenvia POST: a operação já aconteceu, e daqui para frente é
  // só leitura.
  function depoisDeMudar() {
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
