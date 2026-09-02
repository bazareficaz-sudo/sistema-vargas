'use client'

import { useState } from 'react'

// CARGA DA TABELA NCM, com botao.
//
// A rota `/api/fiscal/ncm/atualizar` existia desde 31/08/2026 e NUNCA foi
// executada: `ncm_tabela` seguia com zero linhas em 02/09. O motivo nao era
// falta de vontade — era nao existir botao nenhum em tela nenhuma. A unica
// instrucao possivel era "abra o console do navegador e rode um fetch", que
// nao e instrucao que se da a quem usa o sistema.
//
// A CARGA PRECISA SER REPETIDA. A nomenclatura muda a cada Resolucao Gecex, e
// um NCM que valia ano passado e foi extinto e metade da Rejeicao 778. Uma
// rota sem botao nao e rodada de novo — por isso a tela mostra QUANDO foi a
// ultima carga e qual ato esta valendo, e nao so um botao solto.

type Estado = {
  linhas: number
  ultimaCarga: string | null
  ato: string | null
}

type Resposta = {
  ok?: boolean
  erro?: string
  gravadas?: number
  totalNaTabela?: number
  codigosDeOitoDigitos?: number
  recebidasDaFonte?: number
  ato?: string | null
  vigencia?: string | null
  observacao?: string
}

export default function TabelaNcmClient({ inicial }: { inicial: Estado }) {
  const [estado, setEstado] = useState(inicial)
  const [carregando, setCarregando] = useState(false)
  const [resultado, setResultado] = useState<Resposta | null>(null)

  async function atualizar() {
    setCarregando(true); setResultado(null)
    try {
      const r = await fetch('/api/fiscal/ncm/atualizar', { method: 'POST' })
        .then(x => x.json()) as Resposta
      setResultado(r)
      if (r.ok) {
        setEstado({
          linhas: r.totalNaTabela ?? estado.linhas,
          ultimaCarga: new Date().toISOString(),
          ato: r.ato ?? estado.ato,
        })
      }
    } catch (e) {
      setResultado({ ok: false, erro: e instanceof Error ? e.message : 'Falha na carga' })
    } finally {
      setCarregando(false)
    }
  }

  const vazia = estado.linhas === 0

  return (
    <div className="max-w-2xl space-y-4">
      {/* O ESTADO PRIMEIRO. Tabela vazia nao e detalhe de configuracao: e a
          validacao de NCM inteira sem funcionar, e quem abre esta tela
          precisa ver isso antes do botao. */}
      <div className={`rounded-xl border p-4 ${vazia ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
        {vazia ? (
          <>
            <p className="text-sm font-semibold text-amber-900">A tabela NCM está vazia</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Enquanto ela estiver vazia, a verificação de NCM responde <b>&quot;não verificável&quot;</b> para
              todos os produtos — ou seja, não impede nenhum código inválido de chegar na emissão.
              É metade da Rejeição 778 passando batido.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-gray-900">
              {estado.linhas.toLocaleString('pt-BR')} códigos carregados
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {estado.ultimaCarga
                ? <>Última carga em {new Date(estado.ultimaCarga).toLocaleString('pt-BR')}</>
                : 'Data da última carga desconhecida'}
              {estado.ato && <> · {estado.ato}</>}
            </p>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-700">
          A carga baixa a nomenclatura oficial do <b>Portal Único Siscomex</b> e grava os códigos de
          8 dígitos — os que vão numa nota. Leva até um minuto.
        </p>
        <p className="mt-2 text-xs leading-5 text-gray-500">
          Repita a cada Resolução Gecex. A nomenclatura muda, e um NCM que valia no ano passado e
          foi extinto é exatamente o que a Rejeição 778 recusa.
        </p>

        <button onClick={() => void atualizar()} disabled={carregando}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {carregando ? 'Baixando da fonte oficial…' : vazia ? 'Carregar tabela NCM' : 'Atualizar tabela NCM'}
        </button>
      </div>

      {resultado && (
        <div className={`rounded-xl border p-4 text-xs leading-5 ${
          resultado.ok ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {resultado.ok ? (
            <>
              <p className="text-sm font-semibold">
                ✓ {resultado.gravadas?.toLocaleString('pt-BR')} códigos gravados
              </p>
              <p className="mt-1">
                {resultado.totalNaTabela?.toLocaleString('pt-BR')} na tabela
                {resultado.recebidasDaFonte && <> · {resultado.recebidasDaFonte.toLocaleString('pt-BR')} linhas recebidas da fonte</>}
                {resultado.ato && <> · {resultado.ato}</>}
              </p>
              {/* Explica por que a conta nao fecha: codigo extinto continua
                  gravado, e e o que permite dizer "extinto" em vez de
                  "inexistente" — as duas metades da Rejeicao 778. */}
              {resultado.observacao && <p className="mt-2 text-green-900/70">{resultado.observacao}</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">Nada foi gravado</p>
              <p className="mt-1">{resultado.erro}</p>
              <p className="mt-2 text-red-700/80">
                A tabela que já estava no banco continua intacta — a carga se recusa a substituir
                uma tabela boa por uma resposta que não entendeu.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
