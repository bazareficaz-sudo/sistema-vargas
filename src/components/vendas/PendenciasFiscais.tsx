'use client'

import { useEffect, useState } from 'react'

// RESOLVER AS PENDÊNCIAS FISCAIS DA VENDA, SEM ABRIR CADASTRO POR CADASTRO.
//
// A mensagem de bloqueio já dizia o que estava errado e qual era o par certo.
// O operador tinha que ler, sair da venda, abrir o produto, achar a aba Fiscal,
// traduzir a frase em três campos e voltar — por produto.
//
// Esta tela mostra a mesma decisão com a evidência ao lado e aplica em um
// clique. O que ela NÃO faz é decidir sozinha: constar na tabela do Convênio
// 142/2018 diz que a mercadoria PODE ter substituição tributária, não que o
// imposto foi retido nesta compra. Por isso os dois caminhos aparecem sempre,
// com o provável marcado — e quem confirma é gente.

type Mudanca = { campo: string; de: string | null; para: string | null }
type Caminho = { id: 'com_st' | 'sem_st'; titulo: string; fundamento: string; mudancas: Mudanca[]; faltaEscolherCest: boolean }
type Candidato = { cest: string; ncmPrefixo: string; descricao: string }
type Pendencia = {
  produtoId: string | null
  nome: string
  sku: string | null
  problemas: string[]
  recomendado: 'com_st' | 'sem_st' | null
  evidencia: string
  caminhos: Caminho[]
  candidatosCest: Candidato[]
  impedimento?: string
}

const ROTULO_CAMPO: Record<string, string> = {
  cfop: 'CFOP', csosn: 'CSOSN', icms_cst: 'CST ICMS', cest: 'CEST',
}

function Vazio() { return <span className="text-gray-400 italic">vazio</span> }

export default function PendenciasFiscais({ vendaId, onResolvido }: {
  vendaId: string
  onResolvido: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [bloqueios, setBloqueios] = useState<string[]>([])
  const [avisoCest, setAvisoCest] = useState<string | null>(null)
  const [escolha, setEscolha] = useState<Record<string, 'com_st' | 'sem_st'>>({})
  const [cestEscolhido, setCestEscolhido] = useState<Record<string, string>>({})
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<{ aplicados: number; restantes: string[] } | null>(null)

  /** Só busca. Não toca em estado — quem chama decide o que fazer com o resultado. */
  async function buscarDiagnostico(decisoes?: unknown[]) {
    const r = await fetch('/api/fiscal/pendencias', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendaId, acao: 'diagnosticar', decisoes }),
    })
    return r.json()
  }

  function aplicarDiagnostico(d: {
    ok?: boolean; erro?: string; pendencias?: Pendencia[]; bloqueios?: string[]; cestIndisponivel?: string | null
  }) {
    if (!d.ok) { setErro(d.erro ?? 'Não foi possível conferir os dados fiscais'); return }
    setErro('')
    setPendencias(d.pendencias ?? [])
    setBloqueios(d.bloqueios ?? [])
    setAvisoCest(d.cestIndisponivel ?? null)
    // A recomendação da tabela entra pré-marcada; trocar é um clique.
    setEscolha(prev => {
      const novo = { ...prev }
      for (const p of d.pendencias ?? []) {
        if (p.produtoId && !novo[p.produtoId] && p.recomendado) novo[p.produtoId] = p.recomendado
      }
      return novo
    })
  }

  // `vivo` não é cerimônia: o painel vive dentro de um modal que o operador
  // fecha a qualquer momento, e a conferência faz uma consulta à tabela CEST
  // por item. Sem isto, fechar antes da resposta gravava estado num componente
  // que não existe mais.
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const d = await buscarDiagnostico()
        if (vivo) aplicarDiagnostico(d)
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : 'Erro ao conferir')
      } finally {
        if (vivo) setCarregando(false)
      }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendaId])

  // Escolher um CEST muda o que a proposta vai gravar, então o diagnóstico é
  // refeito no servidor — não recalculado aqui. Duas contas do mesmo número em
  // lugares diferentes é como um deles fica errado sem ninguém ver.
  async function escolherCest(produtoId: string, cest: string) {
    const novo = { ...cestEscolhido, [produtoId]: cest }
    setCestEscolhido(novo)
    try {
      aplicarDiagnostico(await buscarDiagnostico(
        Object.entries(novo).map(([pid, c]) => ({ produtoId: pid, caminho: escolha[pid] ?? 'com_st', cest: c })),
      ))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao conferir')
    }
  }

  async function aplicar() {
    const decisoes = pendencias
      .filter(p => p.produtoId && !p.impedimento && escolha[p.produtoId])
      .map(p => ({ produtoId: p.produtoId!, caminho: escolha[p.produtoId!], cest: cestEscolhido[p.produtoId!] ?? null }))
    if (!decisoes.length) return

    setAplicando(true); setErro('')
    try {
      const d = await fetch('/api/fiscal/pendencias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendaId, acao: 'aplicar', decisoes }),
      }).then(r => r.json())
      if (d.erro) { setErro(d.erro); return }
      setResultado({ aplicados: d.aplicados?.length ?? 0, restantes: d.bloqueios ?? [] })
      if (d.recusados?.length) {
        setErro(d.recusados.map((r: { motivo: string }) => r.motivo).join(' · '))
      }
      if (d.prontaParaEmitir) onResolvido()
      else aplicarDiagnostico(await buscarDiagnostico())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao aplicar')
    } finally {
      setAplicando(false)
    }
  }

  if (carregando) {
    return <p className="text-xs text-gray-500 px-3 py-2">Conferindo os dados fiscais dos itens...</p>
  }

  const prontos = pendencias.filter(p => p.produtoId && !p.impedimento && escolha[p.produtoId!])
  const travados = pendencias.filter(p => p.impedimento)

  return (
    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
      <div className="px-3 py-2 bg-gray-50 rounded-t-lg">
        <p className="text-xs font-semibold text-gray-700">Resolver pendências fiscais</p>
        <p className="text-[11px] text-gray-500 mt-0.5">
          CFOP e CST/CSOSN saem do regime de quem emite a nota. O CEST e a indicação de
          substituição tributária saem da tabela oficial do Convênio ICMS 142/2018, consultada
          pelo NCM — não são palpite.
        </p>
      </div>

      {avisoCest && (
        <p className="px-3 py-2 text-[11px] text-amber-700 bg-amber-50">
          ⚠ A tabela oficial não pôde ser consultada ({avisoCest}). Sem ela não há evidência de
          substituição tributária — as recomendações abaixo ficam sem base.
        </p>
      )}

      {resultado && (
        <p className={`px-3 py-2 text-xs ${resultado.restantes.length === 0 ? 'text-green-800 bg-green-50' : 'text-amber-800 bg-amber-50'}`}>
          {resultado.aplicados > 0 ? `✓ ${resultado.aplicados} produto(s) corrigido(s). ` : ''}
          {resultado.restantes.length === 0
            ? 'Nenhum bloqueio restante — a nota pode ser emitida.'
            : `Ainda falta: ${resultado.restantes.join(' · ')}`}
        </p>
      )}

      {pendencias.length === 0 && (
        <p className="px-3 py-3 text-xs text-gray-600">
          {bloqueios.length === 0
            ? 'Nenhuma pendência fiscal nos itens desta venda.'
            : `Os itens estão coerentes, mas a emissão segue bloqueada: ${bloqueios.join(' · ')}`}
        </p>
      )}

      {pendencias.map(p => {
        const id = p.produtoId ?? p.nome
        const escolhido = p.produtoId ? escolha[p.produtoId] : undefined
        return (
          <div key={id} className="px-3 py-3 space-y-2">
            <div>
              <p className="text-xs font-semibold text-gray-800">
                {p.nome}{p.sku ? <span className="font-normal text-gray-400"> · {p.sku}</span> : null}
              </p>
              {p.problemas.map((problema, i) => (
                <p key={i} className="text-[11px] text-red-700 mt-0.5">{problema}</p>
              ))}
            </div>

            {p.impedimento ? (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                {p.impedimento}
              </p>
            ) : (
              <>
                <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                  <span className="font-medium">Evidência:</span> {p.evidencia}
                </p>

                {/* Mais de um CEST possível: a tabela não decide sozinha, e um
                    código errado aqui vira recusa ou recolhimento errado. */}
                {p.candidatosCest.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] text-gray-600">A tabela devolveu mais de um CEST — escolha o que descreve o produto:</p>
                    {p.candidatosCest.map(c => (
                      <label key={c.cest} className="flex items-start gap-2 text-[11px] text-gray-700 cursor-pointer">
                        <input type="radio" name={`cest-${id}`} className="mt-0.5"
                          checked={cestEscolhido[p.produtoId!] === c.cest}
                          onChange={() => void escolherCest(p.produtoId!, c.cest)} />
                        <span><b>{c.cest}</b> — {c.descricao}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  {p.caminhos.map(c => {
                    const marcado = escolhido === c.id
                    const indisponivel = c.faltaEscolherCest
                    return (
                      <label key={c.id}
                        className={`block rounded border px-2 py-1.5 cursor-pointer ${
                          indisponivel ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                          : marcado ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <div className="flex items-start gap-2">
                          <input type="radio" name={`caminho-${id}`} className="mt-0.5"
                            disabled={indisponivel} checked={marcado}
                            onChange={() => p.produtoId && setEscolha(e => ({ ...e, [p.produtoId!]: c.id }))} />
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-gray-800">
                              {c.titulo}
                              {p.recomendado === c.id && (
                                <span className="ml-1.5 text-[10px] text-blue-700 font-normal">· indicado pela tabela</span>
                              )}
                            </p>
                            <p className="text-[10px] text-gray-500 mt-0.5">{c.fundamento}</p>
                            {indisponivel && (
                              <p className="text-[10px] text-amber-700 mt-0.5">Escolha o CEST acima para poder usar este caminho.</p>
                            )}
                            {/* O que vai mudar no cadastro, campo a campo. Sem
                                isto, "aplicar correção" é um botão que mexe em
                                dado fiscal sem dizer no quê. */}
                            {c.mudancas.length > 0 ? (
                              <ul className="mt-1 space-y-0.5">
                                {c.mudancas.map(m => (
                                  <li key={m.campo} className="text-[10px] font-mono text-gray-600">
                                    {ROTULO_CAMPO[m.campo] ?? m.campo}: {m.de ?? <Vazio />} → <b className="text-gray-900">{m.para ?? <Vazio />}</b>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[10px] text-gray-400 mt-1">Nada a mudar — o cadastro já está assim.</p>
                            )}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )
      })}

      {erro && <p className="px-3 py-2 text-xs text-red-700 bg-red-50">{erro}</p>}

      {pendencias.length > 0 && (
        <div className="px-3 py-2 flex items-center justify-between gap-3 bg-gray-50 rounded-b-lg">
          <p className="text-[11px] text-gray-500">
            {travados.length > 0 && `${travados.length} item(ns) precisam de NCM antes. `}
            A correção grava no cadastro do produto e vale para as próximas vendas.
          </p>
          <button onClick={aplicar} disabled={aplicando || prontos.length === 0}
            className="text-xs bg-blue-600 text-white rounded px-3 py-1.5 font-medium disabled:opacity-40 flex-shrink-0">
            {aplicando ? 'Aplicando...' : `Aplicar em ${prontos.length} produto(s)`}
          </button>
        </div>
      )}
    </div>
  )
}
