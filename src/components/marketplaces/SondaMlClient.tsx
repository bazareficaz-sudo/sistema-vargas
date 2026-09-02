'use client'

import { useState } from 'react'

// A SONDA PRECISA DE UM BOTÃO.
//
// `/api/precificacao/sondar-ml` existe desde 31/08/2026 e a terceira rodada
// nunca aconteceu — pelo mesmo motivo que a tabela NCM ficou três dias vazia:
// não havia botão em tela nenhuma, e a única instrução possível era "abra o
// console do navegador e rode um fetch".
//
// A sonda é SOMENTE LEITURA. Todas as chamadas são GET: nada entra em
// campanha, cria promoção ou altera preço.

type Sonda = {
  pergunta?: string
  caminho?: string
  status?: number
  ok?: boolean
  rateLimit?: unknown
  amostra?: unknown
  erro?: string
}

type Canal = {
  canal?: string
  sellerId?: string
  anuncioSondado?: string | null
  anuncioComVariacaoSondado?: string | null
  tiposDeCampanha?: string[]
  tiposAbertos?: string[]
  sondas?: Sonda[]
}

type Relatorio = {
  ok?: boolean
  erro?: string
  relatorio?: Canal[]
  naoRespondido?: string[]
}

export default function SondaMlClient() {
  const [rodando, setRodando] = useState(false)
  const [r, setR] = useState<Relatorio | null>(null)

  async function rodar() {
    setRodando(true); setR(null)
    try {
      const resp = await fetch('/api/precificacao/sondar-ml').then(x => x.json())
      setR(resp)
    } catch (e) {
      setR({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao sondar' })
    } finally {
      setRodando(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-700">
          Mede o que a API do Mercado Livre realmente responde sobre campanhas, usando as contas
          conectadas desta empresa.
        </p>
        <p className="mt-2 text-xs leading-5 text-gray-500">
          <b>Somente leitura.</b> Todas as chamadas são GET — nada entra em campanha, cria promoção
          ou muda preço. O resultado alimenta o que o sistema pode ou não fazer com campanhas: sem
          ele, o Mercado Livre fica marcado como <i>não verificado</i>, que não é o mesmo que
          &quot;não suportado&quot;.
        </p>
        <button onClick={() => void rodar()} disabled={rodando}
          className="mt-3 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
          {rodando ? 'Sondando o Mercado Livre…' : 'Rodar sonda'}
        </button>
      </div>

      {r && !r.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {r.erro ?? 'A sonda não completou.'}
        </div>
      )}

      {r?.ok && (
        <div className="space-y-4">
          {(r.relatorio ?? []).map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900">{c.canal}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                anúncio sondado: {c.anuncioSondado ?? '—'}
                {c.anuncioComVariacaoSondado && <> · com variação: {c.anuncioComVariacaoSondado}</>}
              </p>

              {/* OS DOIS NÚMEROS, e precisa dos dois: o que a conta TEM e o
                  que a sonda chegou a abrir. Só o segundo faria uma amostra
                  parecer o total. */}
              <p className="mt-2 text-xs text-gray-700">
                {(c.tiposDeCampanha ?? []).length} tipo(s) de campanha na conta ·{' '}
                {(c.tiposAbertos ?? []).length} aberto(s) pela sonda
              </p>
              {(c.tiposDeCampanha ?? []).length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {(c.tiposDeCampanha ?? []).map(t => (
                    <span key={t} className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      (c.tiposAbertos ?? []).includes(t)
                        ? 'border-green-300 bg-green-50 text-green-800'
                        : 'border-gray-200 bg-gray-50 text-gray-500'
                    }`}>{t}</span>
                  ))}
                </p>
              )}

              <div className="mt-3 space-y-1.5">
                {(c.sondas ?? []).map((s, j) => (
                  <details key={j} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5">
                    <summary className="cursor-pointer text-xs text-gray-700">
                      <span className={`mr-1.5 font-mono ${
                        s.status === 200 ? 'text-green-700'
                        : s.status === 403 ? 'text-amber-700'
                        : s.status === 404 ? 'text-gray-500' : 'text-red-600'
                      }`}>{s.status ?? '—'}</span>
                      {s.pergunta}
                    </summary>
                    <p className="mt-1.5 break-all font-mono text-[10px] text-gray-500">{s.caminho}</p>
                    <pre className="mt-1.5 max-h-56 overflow-auto rounded bg-white p-2 text-[10px] text-gray-700">
                      {JSON.stringify(s.amostra ?? s.erro ?? null, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </div>
          ))}

          {/* O QUE A SONDA NÃO RESPONDE continua dito em voz alta. Uma sonda
              que só lista o que descobriu deixa o resto parecer respondido. */}
          {(r.naoRespondido ?? []).length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">O que esta sonda NÃO responde</p>
              <ul className="mt-1.5 space-y-1">
                {(r.naoRespondido ?? []).map((n, i) => (
                  <li key={i} className="text-xs leading-5 text-amber-800">• {n}</li>
                ))}
              </ul>
            </div>
          )}

          <details className="rounded-xl border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-800">
              Relatório completo (para copiar)
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-50 p-3 text-[10px] text-gray-700">
              {JSON.stringify(r, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
