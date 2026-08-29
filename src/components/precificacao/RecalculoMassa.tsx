'use client'

import { useState, useEffect, useRef } from 'react'
import { ROTULO_CLASSIFICACAO } from '@/lib/precificacao/margens'
import { ROTULO_PRIORIDADE } from '@/lib/precificacao/recomendacoes'
import { ROTULO_SAUDE } from '@/lib/precificacao/motor'
import type { SaudePreco } from '@/lib/precificacao/tipos'
import CampoNumero from './CampoNumero'

// Recálculo em massa: primeiro a prévia (não muda nada), depois a aplicação
// só do que o usuário aprovou.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Data de hoje no fuso do navegador. `toISOString()` converte para UTC e, à
// noite no Brasil, devolveria o dia seguinte.
function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function RecalculoMassa() {
  const [canais, setCanais] = useState<any[]>([])
  const [canaisEscolhidos, setCanaisEscolhidos] = useState<Set<string>>(new Set())
  const [apenasAtivos, setApenasAtivos] = useState(true)
  const [enviarAoMarketplace, setEnviarAoMarketplace] = useState(true)
  // Recorte do que entra na conta. Sem isso a varredura é sempre o canal
  // inteiro, e revisar "os ralos que chegaram hoje" vira caça ao tesouro numa
  // lista de centenas.
  const [busca, setBusca] = useState('')
  const [entrada, setEntrada] = useState('')
  const [entradaDe, setEntradaDe] = useState('')
  const [entradaAte, setEntradaAte] = useState('')
  const temRecorte = !!(busca.trim() || entrada.trim() || entradaDe || entradaAte)

  const [calculando, setCalculando] = useState(false)
  const [previa, setPrevia] = useState<any | null>(null)
  const [sincronizandoPromo, setSincronizandoPromo] = useState(false)
  const [resumoPromo, setResumoPromo] = useState<string>('')
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [aplicando, setAplicando] = useState(false)
  const [resultado, setResultado] = useState<any | null>(null)
  const [erro, setErro] = useState('')
  const [verHistorico, setVerHistorico] = useState(false)
  // Ajuste de margem linha a linha: a regra manda 20%, mas tem produto que
  // so fecha com 15%. Aqui o operador muda so aquela linha, sem precisar
  // criar regra nova pra conseguir publicar.
  const [ajustes, setAjustes] = useState<Record<string, any>>({})
  const timers = useRef<Record<string, any>>({})

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
          busca: busca.trim() || undefined,
          entrada: entrada.trim() || undefined,
          entradaDe: entradaDe || undefined,
          entradaAte: entradaAte || undefined,
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

  const precoDe = (i: any) => ajustes[i.anuncioId]?.preco ?? i.precoNovo
  const margemDe = (i: any) => ajustes[i.anuncioId]?.margem ?? i.margemNova
  const saudeDe = (i: any) => ajustes[i.anuncioId]?.saude ?? i.saudeNova
  const foiAjustado = (i: any) => ajustes[i.anuncioId]?.preco != null

  function mudarMargem(i: any, valor: number | null) {
    const id = i.anuncioId
    setAjustes(a => ({ ...a, [id]: { ...a[id], margemAlvo: valor, erro: '', fixada: false } }))
    clearTimeout(timers.current[id])
    if (valor == null || !(valor > 0)) {
      // Campo vazio volta ao preco da regra, em vez de travar num meio-termo.
      setAjustes(a => ({ ...a, [id]: { ...a[id], preco: undefined, margem: undefined, saude: undefined } }))
      return
    }
    setAjustes(a => ({ ...a, [id]: { ...a[id], carregando: true } }))
    timers.current[id] = setTimeout(async () => {
      try {
        const d = await fetch('/api/precificacao/recalcular/ajustar-item', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ anuncioId: id, margem: valor }),
        }).then(r => r.json())
        setAjustes(a => ({
          ...a,
          [id]: d.ok
            ? { ...a[id], carregando: false, preco: d.preco, margem: d.margem, saude: d.saude, erro: d.avisos?.[0] ?? '' }
            : { ...a[id], carregando: false, erro: d.erro ?? 'Erro ao recalcular' },
        }))
      } catch (e: any) {
        setAjustes(a => ({ ...a, [id]: { ...a[id], carregando: false, erro: e.message } }))
      }
    }, 500)
  }

  // Transforma o ajuste numa regra do proprio produto. Sem isso o anuncio
  // volta a aparecer na proxima varredura, porque a regra da categoria
  // continua pedindo a margem antiga.
  /**
   * Sincroniza as campanhas dos canais que aparecem na prévia e recalcula.
   *
   * Existe aqui, e não só na tela de Promoções, porque é aqui que a falta
   * da campanha dói: a margem mostrada na linha pode estar medindo o preço
   * errado. Mandar o operador procurar outra tela no meio de uma decisão de
   * preço é onde ele desiste.
   *
   * SÓ SHOPEE. A rota de sincronização recusa qualquer outra plataforma
   * (`.eq('plataforma', 'shopee')`), e o Mercado Livre não tem leitura de
   * campanha nenhuma — por isso o botão nem aparece quando não há canal
   * Shopee na prévia.
   */
  async function sincronizarPromocoes() {
    const canais = canaisComPromocao()
    if (canais.length === 0) return

    setSincronizandoPromo(true); setResumoPromo(''); setErro('')
    const partes: string[] = []
    try {
      for (const c of canais) {
        try {
          const d = await fetch('/api/marketplace/shopee/promocoes/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ canalId: c.id, situacao: 'all' }),
          }).then(r => r.json())
          partes.push(d?.ok
            ? `${c.nome}: ${d.campanhas ?? 0} campanha(s), ${d.itens ?? 0} item(ns)`
            : `${c.nome}: ${d?.erro ?? 'falhou'}`)
        } catch (e) {
          partes.push(`${c.nome}: ${e instanceof Error ? e.message : 'falhou'}`)
        }
      }
      setResumoPromo(partes.join(' · '))
      // A prévia envelheceu no instante em que o espelho mudou: os preços
      // efetivos e as margens podem ser outros agora.
      await calcularPrevia()
    } finally {
      setSincronizandoPromo(false)
    }
  }

  /** Canais da prévia cujas campanhas o sistema sabe ler. */
  function canaisComPromocao(): { id: string; nome: string }[] {
    const vistos = new Map<string, string>()
    type LinhaDeCanal = { canalId: string; canalNome: string; canalPlataforma: string }
    for (const i of (previa?.itens ?? []) as LinhaDeCanal[]) {
      if (i.canalPlataforma === 'shopee') vistos.set(i.canalId, i.canalNome)
    }
    return [...vistos.entries()].map(([id, nome]) => ({ id, nome }))
  }

  async function fixarParaProduto(i: any) {
    const margem = ajustes[i.anuncioId]?.margemAlvo
    if (!(margem > 0)) return
    setAjustes(a => ({ ...a, [i.anuncioId]: { ...a[i.anuncioId], fixando: true } }))
    const d = await fetch('/api/precificacao/regras', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        regra: {
          nome: `${i.produtoNome} — margem ${String(margem).replace('.', ',')}%`,
          nivel: 'produto', alvo_id: i.produtoId,
          objetivo_tipo: 'margem_liquida', objetivo_valor: margem,
          arredondamento: 'nenhum', prioridade: 0, ativo: true,
        },
      }),
    }).then(r => r.json())
    setAjustes(a => ({
      ...a,
      [i.anuncioId]: { ...a[i.anuncioId], fixando: false, fixada: d.ok, erro: d.ok ? '' : (d.erro ?? 'Erro ao criar a regra') },
    }))
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
            anuncioId: i.anuncioId, precoNovo: precoDe(i), regraId: i.regraId,
            regraNome: i.regraNome,
            // O historico precisa dizer que o preco nao saiu puro da regra —
            // senao, meses depois, ninguem entende a diferenca.
            regraObjetivo: foiAjustado(i)
              ? `${i.regraObjetivo} · margem ajustada para ${margemDe(i)}%`
              : i.regraObjetivo,
            custo: i.custo, margemAtual: i.margemAtual, margemNova: margemDe(i),
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

        {/* Recorte. Fica junto do canal porque é a mesma pergunta: o que entra
            na conta. Vazio = o canal inteiro, como sempre foi. */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Buscar produto ou anúncio
            </label>
            <input value={busca} onChange={e => setBusca(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') calcularPrevia() }}
              placeholder="Ex: ralo onça"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400 mt-1">
              Procura no título do anúncio e no nome, SKU e EAN do produto.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1.5">Entrada de mercadoria</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Nº ou NF</label>
                <input value={entrada} onChange={e => setEntrada(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') calcularPrevia() }}
                  placeholder="Ex: 1879150"
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 w-32" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Entrou de</label>
                <input type="date" value={entradaDe} onChange={e => setEntradaDe(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">até</label>
                <input type="date" value={entradaAte} onChange={e => setEntradaAte(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500" />
              </div>
              <button type="button" onClick={() => { const h = hoje(); setEntradaDe(h); setEntradaAte(h) }}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Entrou hoje
              </button>
              {temRecorte && (
                <button type="button"
                  onClick={() => { setBusca(''); setEntrada(''); setEntradaDe(''); setEntradaAte('') }}
                  className="px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700">
                  limpar recorte
                </button>
              )}
            </div>
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
          {resultado.retidos?.length > 0 && (
            <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="font-medium">
                {resultado.retidos.length} preço(s) retido(s): o anúncio está com promoção vigente, e gravar o
                preço novo não mudaria o que o cliente paga.
              </p>
              {resultado.retidos.slice(0, 5).map((r: any, i: number) => (
                <p key={i} className="mt-0.5">· {r.titulo || r.anuncioId} — {r.motivo}</p>
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
            <p className="text-sm text-gray-900 mb-1">
              Varridos <strong>{r.totalAnuncios.toLocaleString('pt-BR')}</strong> anúncios.
              O preço foi calculado para <strong>{r.calculados.toLocaleString('pt-BR')}</strong> deles.
            </p>

            {/* O recorte precisa aparecer no resultado. Sem isso, "0 anúncios"
                parece falha do sistema em vez de filtro que não casou. */}
            {(previa.entradasCasadas?.length > 0 || previa.produtosDaEntrada != null || busca.trim()) && (
              <p className="text-xs text-gray-500 mb-3">
                Recorte:
                {busca.trim() && <> busca <b>“{busca.trim()}”</b></>}
                {previa.produtosDaEntrada != null && (
                  <>
                    {busca.trim() && ' ·'} entrada de mercadoria
                    {previa.entradasCasadas?.length === 1
                      ? <> <b>{previa.entradasCasadas[0].rotulo}</b>{previa.entradasCasadas[0].origem === 'xml' ? ' (XML)' : ''}</>
                      : previa.entradasCasadas?.length > 1
                        ? <> — <b>{previa.entradasCasadas.length}</b> entradas casaram</>
                        : <> — <b>nenhuma entrada casou</b></>}
                    {' '}(<b>{previa.produtosDaEntrada}</b> produto(s))
                  </>
                )}
              </p>
            )}

            {r.totalAnuncios === 0 && (
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-3">
                Nenhum anúncio bateu com esse recorte no canal escolhido. Confira o termo da busca,
                o número da nota e o canal — ou limpe o recorte para varrer tudo.
              </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <Bloco rotulo="Sobem de preço" valor={r.sobem} cor="text-green-700" />
              <Bloco rotulo="Descem de preço" valor={r.descem} cor="text-blue-700" />
              <Bloco rotulo="Já estão certos" valor={r.iguais} cor="text-gray-600" />
              <Bloco rotulo="Em prejuízo hoje" valor={r.emPrejuizoAgora} cor={r.emPrejuizoAgora > 0 ? 'text-red-700' : 'text-gray-600'} />
            </div>

            {canaisComPromocao().length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <button onClick={sincronizarPromocoes} disabled={sincronizandoPromo || calculando}
                  title="Lê as campanhas na Shopee e recalcula a prévia com os preços que estiverem valendo"
                  className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-medium rounded-lg">
                  {sincronizandoPromo
                    ? '🏷️ sincronizando promoções...'
                    : `🏷️ Sincronizar promoções (${canaisComPromocao().length} canal(is) Shopee)`}
                </button>
                {resumoPromo && <span className="text-xs text-gray-500">{resumoPromo}</span>}
                {!resumoPromo && (
                  <span className="text-[11px] text-gray-400">
                    Só lê — nada é criado nem alterado na plataforma.
                  </span>
                )}
              </div>
            )}

            {(r.emPromocao + r.promocoesTerminando + r.foraDaPoliticaPromocional + r.abaixoDoPiso) > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <Bloco rotulo="Em promoção" valor={r.emPromocao} cor="text-blue-700" />
                <Bloco rotulo="Sem promoção" valor={r.semPromocao} cor="text-gray-600" />
                <Bloco rotulo="Promoção terminando" valor={r.promocoesTerminando} cor={r.promocoesTerminando > 0 ? 'text-amber-700' : 'text-gray-600'} />
                <Bloco rotulo="Fora da política" valor={r.foraDaPoliticaPromocional} cor={r.foraDaPoliticaPromocional > 0 ? 'text-amber-700' : 'text-gray-600'} />
                <Bloco rotulo="Abaixo do piso" valor={r.abaixoDoPiso} cor={r.abaixoDoPiso > 0 ? 'text-red-700' : 'text-gray-600'} />
              </div>
            )}

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
                  {Object.values(ajustes).some((a: any) => a?.preco != null) && (
                    <span className="text-[11px] text-blue-700">
                      margem ajustada em alguma linha — o anúncio volta a aparecer na próxima varredura,
                      a não ser que você fixe a margem para o produto
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
                      <th className="text-right px-3 py-2 text-xs font-medium text-gray-600"
                        title="Frete que saiu do seu bolso nesta conta. 🔵 = valor real buscado no marketplace.">
                        Frete
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-600"
                        title="Margem líquida: quanto do preço de venda sobra de lucro, já descontados comissão, frete e taxas. Embaixo, o mesmo lucro dividido pelo custo — que é a base usada pelas regras.">
                        Margem líquida
                        <span className="block text-[10px] font-normal text-gray-400">lucro ÷ preço · s/ custo abaixo</span>
                      </th>
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-600"
                        title="Margem líquida desejada (sobre o preço de venda). Em branco, vale o que a regra manda.">
                        Margem desejada
                        <span className="block text-[10px] font-normal text-gray-400">líquida, sobre o preço</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itens.map((i: any) => {
                      const aj = ajustes[i.anuncioId]
                      const ajustado = foiAjustado(i)
                      const dif = Number((precoDe(i) - i.precoAtual).toFixed(2))
                      const sa = ROTULO_SAUDE[i.saudeAtual as SaudePreco]
                      const sn = ROTULO_SAUDE[saudeDe(i) as SaudePreco]
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
                            {i.recomendacoes?.length > 0 ? (() => {
                              const r = i.recomendacoes[0]
                              const pr = ROTULO_PRIORIDADE[r.prioridade as keyof typeof ROTULO_PRIORIDADE]
                              // As evidências vão no title: a recomendação não pode
                              // ser caixa-preta, mas também não pode ocupar a linha.
                              const porQue = [r.diagnostico, r.recomendacao,
                                ...r.evidencias.map((e: any) => `${e.rotulo}: ${e.valor}`)].join(' · ')
                              return (
                                <p className="text-[11px] mt-0.5 flex items-baseline gap-1 flex-wrap" title={porQue}>
                                  <span className={`px-1 py-px rounded border text-[9px] ${pr.cor}`}>{pr.texto}</span>
                                  <span className="text-gray-700">{r.recomendacao}</span>
                                  {r.acaoSugerida && (
                                    <span className="text-gray-400">— {r.acaoSugerida}</span>
                                  )}
                                </p>
                              )
                            })() : i.oportunidades?.length > 0 && (
                              <p className="text-[11px] text-blue-700 mt-0.5" title={i.oportunidades[0].detalhe}>
                                {i.oportunidades[0].titulo}
                                {i.precoPromocionalLimite != null && i.oportunidades[0].tipo === 'margem_para_promocao'
                                  ? ` — até ${brl(i.precoPromocionalLimite)}` : ''}
                              </p>
                            )}
                            {aj?.erro && <p className="text-[11px] text-red-600 mt-0.5">{aj.erro}</p>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            <span className="text-gray-500">{brl(i.precoAtual)}</span>
                            {i.origemPrecoAtual === 'campanha' && (
                              <span className="block text-[10px] font-sans text-blue-700"
                                title={i.campanha ? `Campanha "${i.campanha.nome}"${i.campanha.diasRestantes != null ? ` · termina em ${i.campanha.diasRestantes} dia(s)` : ''}` : 'Campanha vigente'}>
                                🏷 campanha{i.campanha?.diasRestantes != null && i.campanha.diasRestantes <= 7 ? ` · ${i.campanha.diasRestantes}d` : ''}
                              </span>
                            )}
                            {i.origemPrecoAtual === 'promocional_local' && (
                              <span className="block text-[10px] font-sans text-blue-600">promoção local</span>
                            )}
                            {i.classificacao && ROTULO_CLASSIFICACAO[i.classificacao as keyof typeof ROTULO_CLASSIFICACAO] && (
                              <span className="block text-[10px] font-sans text-gray-500" title={i.motivoClassificacao}>
                                {ROTULO_CLASSIFICACAO[i.classificacao as keyof typeof ROTULO_CLASSIFICACAO].emoji}{' '}
                                {ROTULO_CLASSIFICACAO[i.classificacao as keyof typeof ROTULO_CLASSIFICACAO].texto}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">
                            {aj?.carregando ? <span className="text-gray-400 text-xs">calculando...</span> : brl(precoDe(i))}
                            {ajustado && <span className="block text-[10px] text-blue-600 font-sans">ajustado</span>}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono ${dif > 0 ? 'text-green-700' : dif < 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                            {dif > 0 ? '+' : ''}{brl(dif)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                            {i.frete > 0 ? (
                              <span className={i.freteImportado ? 'text-blue-700' : 'text-gray-500'}
                                title={i.freteImportado
                                  ? 'Valor real buscado no Mercado Livre para a embalagem deste anúncio'
                                  : 'Custo médio configurado no canal'}>
                                {i.freteImportado && '🔵 '}{brl(i.frete)}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap text-xs">
                            <span title={sa.texto}>{sa.emoji} {i.margemAtual.toFixed(0)}%</span>
                            <span className="text-gray-300 mx-1">→</span>
                            <span title={sn.texto}>{sn.emoji} {margemDe(i).toFixed(0)}%</span>
                            {/* O mesmo lucro na base do CUSTO. É nessa unidade
                                que as regras são escritas ("20% de lucro sobre
                                o custo"), então sem as duas lado a lado parece
                                que o sistema entregou menos do que a regra
                                pediu — quando é só outra forma de dividir. */}
                            {i.lucroSobreCustoNovo != null && (
                              <span className="block text-[10px] text-gray-400 mt-0.5"
                                title="Lucro sobre o custo: o mesmo dinheiro da margem acima, dividido pelo custo em vez de pelo preço. É a base usada pelas regras.">
                                s/ custo {i.lucroSobreCustoAtual.toFixed(0)}% → {i.lucroSobreCustoNovo.toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {/* Placeholder e valor digitado precisam parecer
                                  diferentes: o placeholder é o que a REGRA vai
                                  produzir, não uma escolha de alguém. Iguais,
                                  o número da regra parecia configuração. */}
                              <CampoNumero valor={aj?.margemAlvo ?? null}
                                placeholder={String(i.margemNova.toFixed(0))}
                                onChange={v => mudarMargem(i, v)}
                                title={aj?.margemAlvo != null
                                  ? 'Margem que você definiu para este anúncio'
                                  : `A regra entrega ${i.margemNova.toFixed(0)}% de margem líquida. Digite aqui só se quiser outra.`}
                                className={`w-14 border rounded px-1.5 py-1 text-xs text-center focus:outline-none focus:border-blue-500 ${
                                  aj?.margemAlvo != null
                                    ? 'border-blue-400 text-gray-900 font-medium'
                                    : 'border-gray-200 text-gray-400 italic bg-gray-50'
                                }`} />
                              <span className="text-xs text-gray-400">%</span>
                            </div>
                            {ajustado && !aj?.fixada && (
                              <button onClick={() => fixarParaProduto(i)} disabled={aj?.fixando}
                                title="Cria uma regra só para este produto, para ele não voltar a aparecer aqui"
                                className="text-[10px] text-blue-600 hover:text-blue-800 disabled:opacity-50 mt-0.5">
                                {aj?.fixando ? 'fixando...' : 'fixar p/ este produto'}
                              </button>
                            )}
                            {aj?.fixada && <span className="block text-[10px] text-green-700 mt-0.5">✓ regra criada</span>}
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
