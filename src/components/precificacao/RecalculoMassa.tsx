'use client'

import { useState, useEffect } from 'react'
import { ROTULO_SAUDE } from '@/lib/precificacao/motor'
import type { SaudePreco } from '@/lib/precificacao/tipos'

// Recálculo em massa: primeiro a prévia (não muda nada), depois a aplicação
// só do que o usuário aprovou.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function RecalculoMassa() {
  const [canais, setCanais] = useState<any[]>([])
  const [canaisEscolhidos, setCanaisEscolhidos] = useState<Set<string>>(new Set())
  const [apenasAtivos, setApenasAtivos] = useState(true)
  const [enviarAoMarketplace, setEnviarAoMarketplace] = useState(true)

  const [calculando, setCalculando] = useState(false)
  const [previa, setPrevia] = useState<any | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<any | null>(null)
  const [erro, setErro] = useState('')
  const [verHistorico, setVerHistorico] = useState(false)

  useEffect(() => {
    fetch('/api/precificacao/config').then(r => r.json()).then(d => {
      if (d.ok) setCanais(d.itens.map((i: any) => i.canal))
    })
  }, [])

  async function calcularPrevia() {
    setCalculando(true); setErro(''); setPrevia(null); setResultado(null); setSelecionados(new Set())
    try {
      const d = await fetch('/api/precificacao/recalcular/previa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canaisIds: canaisEscolhidos.size > 0 ? [...canaisEscolhidos] : undefined,
          apenasAtivos,
        }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Erro ao calcular a prévia'); return }
      setPrevia(d)
      // Nada vem pré-marcado: mexer em preço de produção é decisão
      // deliberada, não o caminho de menor resistência.
      setSelecionados(new Set())
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao calcular a prévia')
    } finally {
      setCalculando(false)
    }
  }

  async function aplicar() {
    const escolhidos = previa.itens.filter((i: any) => selecionados.has(i.anuncioId))
    if (escolhidos.length === 0) return
    const texto = enviarAoMarketplace
      ? `Aplicar o novo preço em ${escolhidos.length} anúncio(s) e enviar para o marketplace?`
      : `Aplicar o novo preço em ${escolhidos.length} anúncio(s) apenas no sistema (sem enviar ao marketplace)?`
    if (!confirm(texto)) return

    setAplicando(true); setErro('')
    try {
      const d = await fetch('/api/precificacao/recalcular/aplicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enviarAoMarketplace,
          itens: escolhidos.map((i: any) => ({
            anuncioId: i.anuncioId, precoNovo: i.precoNovo, regraId: i.regraId,
            regraNome: i.regraNome, regraObjetivo: i.regraObjetivo,
            custo: i.custo, margemAtual: i.margemAtual, margemNova: i.margemNova,
          })),
        }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Erro ao aplicar'); return }
      setResultado(d)
      // A prévia envelheceu no instante em que os preços mudaram.
      setPrevia(null); setSelecionados(new Set())
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao aplicar')
    } finally {
      setAplicando(false)
    }
  }

  const r = previa?.resumo
  const itens = previa?.itens ?? []
  const todosMarcados = itens.length > 0 && itens.every((i: any) => selecionados.has(i.anuncioId))

  return (
    <div className="space-y-5">
      {/* Escopo */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">Canais</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setCanaisEscolhidos(new Set())}
              className={`px-3 py-1.5 text-xs rounded-lg border ${canaisEscolhidos.size === 0 ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              Todos
            </button>
            {canais.map(c => {
              const on = canaisEscolhidos.has(c.id)
              return (
                <button key={c.id} onClick={() => setCanaisEscolhidos(s => {
                  const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n
                })}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${on ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {c.nome}
                </button>
              )
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={apenasAtivos} onChange={e => setApenasAtivos(e.target.checked)}
            className="w-4 h-4 accent-blue-600" />
          Somente anúncios ativos
        </label>

        <button onClick={calcularPrevia} disabled={calculando}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
          {calculando ? 'Calculando... isso pode levar um minuto' : 'Calcular impacto (não altera nada)'}
        </button>

        {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
      </div>

      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-sm text-green-900">
            <strong>{resultado.aplicados}</strong> preço(s) atualizado(s)
            {resultado.enviados > 0 && <> · <strong>{resultado.enviados}</strong> enviado(s) ao marketplace</>}
            {resultado.naoProcessados > 0 && <> · {resultado.naoProcessados} ficaram fora do lote (limite de 200 por vez)</>}
          </p>
          {resultado.errosEnvio?.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-amber-800">
                {resultado.errosEnvio.length} preço(s) foram gravados no sistema mas o marketplace recusou:
              </p>
              {resultado.errosEnvio.slice(0, 5).map((e: any, i: number) => (
                <p key={i} className="text-[11px] text-amber-700 ml-2">· {e.erro}</p>
              ))}
            </div>
          )}
          {resultado.falhas?.length > 0 && (
            <p className="text-xs text-red-700 mt-1">{resultado.falhas.length} falharam ao gravar.</p>
          )}
        </div>
      )}

      {/* Resumo do impacto */}
      {r && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-sm text-gray-900 mb-3">
              Varridos <strong>{r.totalAnuncios.toLocaleString('pt-BR')}</strong> anúncios.
              O preço foi calculado para <strong>{r.calculados.toLocaleString('pt-BR')}</strong> deles.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <Bloco rotulo="Sobem de preço" valor={r.sobem} cor="text-green-700" />
              <Bloco rotulo="Descem de preço" valor={r.descem} cor="text-blue-700" />
              <Bloco rotulo="Já estão certos" valor={r.iguais} cor="text-gray-600" />
              <Bloco rotulo="Em prejuízo hoje" valor={r.emPrejuizoAgora} cor={r.emPrejuizoAgora > 0 ? 'text-red-700' : 'text-gray-600'} />
            </div>

            {(r.semProduto + r.semCusto + r.semRegra + r.semPrecoAtual) > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <p className="text-xs text-amber-900 font-medium mb-1">
                  {(r.semProduto + r.semCusto + r.semRegra + r.semPrecoAtual).toLocaleString('pt-BR')} anúncios ficaram de fora:
                </p>
                <ul className="text-xs text-amber-800 space-y-0.5">
                  {r.semProduto > 0 && <li>· {r.semProduto.toLocaleString('pt-BR')} sem produto vinculado — vincule pelo Mapa de Anúncios</li>}
                  {r.semCusto > 0 && <li>· {r.semCusto.toLocaleString('pt-BR')} com produto sem custo cadastrado</li>}
                  {r.semRegra > 0 && <li>· {r.semRegra.toLocaleString('pt-BR')} sem nenhuma regra aplicável — crie uma regra geral</li>}
                  {r.semPrecoAtual > 0 && <li>· {r.semPrecoAtual.toLocaleString('pt-BR')} sem preço atual para comparar</li>}
                </ul>
              </div>
            )}

            {r.emPrejuizoDepois > 0 && (
              <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
                Atenção: mesmo depois do recálculo, {r.emPrejuizoDepois} anúncio(s) continuariam dando prejuízo —
                sinal de que a regra ou as taxas desses casos precisam de revisão.
              </p>
            )}
          </div>

          {/* Lista */}
          {itens.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={todosMarcados}
                      onChange={e => setSelecionados(e.target.checked ? new Set(itens.map((i: any) => i.anuncioId)) : new Set())}
                      className="w-4 h-4 accent-blue-600" />
                    {selecionados.size > 0 ? `${selecionados.size} selecionado(s)` : 'Selecionar todos'}
                  </label>
                  {previa.truncado && (
                    <span className="text-[11px] text-gray-400">
                      mostrando os {itens.length} de maior impacto
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={enviarAoMarketplace} onChange={e => setEnviarAoMarketplace(e.target.checked)}
                      className="w-4 h-4 accent-blue-600" />
                    Enviar ao marketplace
                  </label>
                  <button onClick={aplicar} disabled={selecionados.size === 0 || aplicando}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
                    {aplicando ? 'Aplicando...' : `Aplicar ${selecionados.size || ''}`}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-10 px-3 py-2" />
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Anúncio</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Hoje</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Novo</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Diferença</th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-600">Margem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itens.map((i: any) => {
                      const sa = ROTULO_SAUDE[i.saudeAtual as SaudePreco]
                      const sn = ROTULO_SAUDE[i.saudeNova as SaudePreco]
                      return (
                        <tr key={i.anuncioId} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={selecionados.has(i.anuncioId)}
                              onChange={e => setSelecionados(s => {
                                const n = new Set(s); e.target.checked ? n.add(i.anuncioId) : n.delete(i.anuncioId); return n
                              })}
                              className="w-4 h-4 accent-blue-600" />
                          </td>
                          <td className="px-3 py-2">
                            <p className="text-gray-900 truncate max-w-md">{i.titulo || i.produtoNome}</p>
                            <p className="text-xs text-gray-400">
                              {i.canalNome} · regra {i.regraNome} ({i.regraObjetivo})
                            </p>
                            {i.avisos?.length > 0 && (
                              <p className="text-[11px] text-amber-700 mt-0.5">{i.avisos[0]}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500 font-mono">{brl(i.precoAtual)}</td>
                          <td className="px-3 py-2 text-right text-gray-900 font-mono font-medium">{brl(i.precoNovo)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${i.diferenca > 0 ? 'text-green-700' : 'text-blue-700'}`}>
                            {i.diferenca > 0 ? '+' : ''}{brl(i.diferenca)}
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap text-xs">
                            <span title={sa.texto}>{sa.emoji} {i.margemAtual.toFixed(0)}%</span>
                            <span className="text-gray-300 mx-1">→</span>
                            <span title={sn.texto}>{sn.emoji} {i.margemNova.toFixed(0)}%</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {itens.length === 0 && r.calculados > 0 && (
            <p className="text-sm text-gray-500 text-center py-6">
              Todos os {r.calculados} anúncios calculados já estão no preço que a regra manda. Nada a alterar.
            </p>
          )}
        </>
      )}

      <div className="border-t border-gray-200 pt-4">
        <button onClick={() => setVerHistorico(v => !v)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          {verHistorico ? 'Ocultar histórico' : 'Ver histórico de alterações de preço'}
        </button>
        {verHistorico && <Historico />}
      </div>
    </div>
  )
}

function Bloco({ rotulo, valor, cor }: { rotulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <p className="text-[11px] text-gray-500">{rotulo}</p>
      <p className={`text-lg font-semibold ${cor}`}>{valor.toLocaleString('pt-BR')}</p>
    </div>
  )
}

function Historico() {
  const [dados, setDados] = useState<any | null>(null)
  const [pagina, setPagina] = useState(0)

  useEffect(() => {
    fetch(`/api/precificacao/historico?pagina=${pagina}`).then(r => r.json()).then(d => { if (d.ok) setDados(d) })
  }, [pagina])

  if (!dados) return <p className="text-sm text-gray-400 mt-3">Carregando...</p>
  if (dados.itens.length === 0) return <p className="text-sm text-gray-400 mt-3">Nenhuma alteração de preço registrada ainda.</p>

  const totalPaginas = Math.ceil(dados.total / dados.tamanho)

  return (
    <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Quando</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Anúncio</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">De</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">Para</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Regra</th>
              <th className="text-center px-3 py-2 text-xs font-medium text-gray-600">Marketplace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dados.itens.map((h: any) => (
              <tr key={h.id}>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {new Date(h.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {h.usuario_nome && <span className="block text-gray-400">{h.usuario_nome}</span>}
                </td>
                <td className="px-3 py-2">
                  <p className="text-gray-900 truncate max-w-xs">{h.marketplace_anuncios?.titulo ?? '—'}</p>
                  <p className="text-xs text-gray-400">{h.marketplace_canais?.nome}</p>
                </td>
                <td className="px-3 py-2 text-right text-gray-500 font-mono">{h.preco_anterior != null ? brl(Number(h.preco_anterior)) : '—'}</td>
                <td className="px-3 py-2 text-right text-gray-900 font-mono">{brl(Number(h.preco_novo))}</td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {h.regra_nome ?? '—'}
                  {h.regra_objetivo && <span className="block text-gray-400">{h.regra_objetivo}</span>}
                </td>
                <td className="px-3 py-2 text-center text-xs">
                  {h.enviado_marketplace
                    ? <span className="text-green-700">enviado</span>
                    : <span className="text-amber-700" title={h.erro_envio ?? ''}>só no sistema</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPaginas > 1 && (
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>{dados.total.toLocaleString('pt-BR')} alterações</span>
          <div className="flex gap-2">
            <button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}
              className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">anterior</button>
            <span className="py-1">{pagina + 1} de {totalPaginas}</span>
            <button disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina(p => p + 1)}
              className="px-2 py-1 border border-gray-200 rounded disabled:opacity-30">próxima</button>
          </div>
        </div>
      )}
    </div>
  )
}
