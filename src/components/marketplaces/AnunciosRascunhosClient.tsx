'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Rascunho = {
  id: string
  titulo: string | null
  origem: string
  origem_marketplace: string | null
  origem_url: string | null
  origem_vendedor: string | null
  preco_origem: number | null
  imagem_principal: string | null
  qtd_imagens: number
  tem_variacao: boolean
  produto_id: string | null
  status: string
  colecao: string | null
  capturado_em: string
  produtos: { id: string; nome: string; sku: string | null } | null
}

type TokenExtensao = {
  id: string
  nome_dispositivo: string
  token_prefixo: string
  expira_em: string
  ultimo_uso_em: string | null
  total_capturas: number
  revogado_em: string | null
}

const brl = (v: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  capturado: { rotulo: 'Capturado', cor: 'bg-slate-100 text-slate-700' },
  aguardando_mapeamento: { rotulo: 'Aguardando mapeamento', cor: 'bg-amber-100 text-amber-800' },
  aguardando_revisao: { rotulo: 'Aguardando revisão', cor: 'bg-blue-100 text-blue-700' },
  pronto: { rotulo: 'Pronto para publicar', cor: 'bg-emerald-100 text-emerald-700' },
  publicado: { rotulo: 'Publicado', cor: 'bg-purple-100 text-purple-700' },
}

export default function AnunciosRascunhosClient({
  rascunhos, erro, statusFiltro, buscaFiltro,
}: {
  rascunhos: Rascunho[]
  erro: string
  statusFiltro: string
  buscaFiltro: string
}) {
  const router = useRouter()
  const [busca, setBusca] = useState(buscaFiltro)
  const [painelExtensao, setPainelExtensao] = useState(false)
  const [painelLink, setPainelLink] = useState(false)

  function navegar(mudancas: Record<string, string>) {
    const p = new URLSearchParams()
    const atual: Record<string, string> = { status: statusFiltro, busca: buscaFiltro, ...mudancas }
    for (const [k, v] of Object.entries(atual)) if (v) p.set(k, v)
    router.push(`/dashboard/anuncios-rascunhos${p.toString() ? `?${p}` : ''}`)
  }

  const semProduto = rascunhos.filter(r => !r.produto_id).length

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="flex items-start gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Anúncios Rascunhos</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Anúncios capturados como <b>referência</b>. Nada aqui está publicado — cada um passa por
            mapeamento e revisão antes de virar anúncio seu.
          </p>
        </div>
        <button
          onClick={() => { setPainelLink(v => !v); setPainelExtensao(false) }}
          className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
          🔗 Importar por link
        </button>
        <button
          onClick={() => { setPainelExtensao(v => !v); setPainelLink(false) }}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-700 text-white">
          🧩 Extensão do Chrome
        </button>
      </div>

      {painelLink && <PainelImportarLink onImportado={() => router.refresh()} />}
      {painelExtensao && <PainelExtensao />}

      {erro && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700">Não foi possível carregar os rascunhos</p>
          <p className="text-xs text-red-600 mt-0.5">{erro}</p>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { r: 'Total', v: String(rascunhos.length) },
          { r: 'Sem produto vinculado', v: String(semProduto), alerta: semProduto > 0 },
          { r: 'Com variações', v: String(rascunhos.filter(x => x.tem_variacao).length) },
          { r: 'Capturados hoje', v: String(rascunhos.filter(x => new Date(x.capturado_em).toDateString() === new Date().toDateString()).length) },
        ].map(c => (
          <div key={c.r} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{c.r}</p>
            <p className={`text-lg font-bold mt-0.5 ${c.alerta ? 'text-amber-600' : 'text-slate-800'}`}>{c.v}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navegar({ busca: busca.trim() }) }}
          onBlur={() => navegar({ busca: busca.trim() })}
          placeholder="Buscar por título..."
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg min-w-[220px]"
        />
        <button onClick={() => navegar({ status: '' })}
          className={`px-3 py-1.5 text-xs rounded-lg border ${!statusFiltro ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600'}`}>
          Todos
        </button>
        {Object.entries(STATUS).map(([chave, s]) => (
          <button key={chave} onClick={() => navegar({ status: statusFiltro === chave ? '' : chave })}
            className={`px-3 py-1.5 text-xs rounded-lg border ${statusFiltro === chave ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600'}`}>
            {s.rotulo}
          </button>
        ))}
      </div>

      {/* Lista */}
      {rascunhos.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-16 text-center">
          <span className="text-4xl block mb-2">🧩</span>
          <p className="text-sm text-slate-500">Nenhum rascunho ainda.</p>
          <p className="text-xs text-slate-400 mt-1">
            Instale a extensão do Chrome e capture um anúncio do Mercado Livre.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
          {rascunhos.map(r => {
            const s = STATUS[r.status] ?? STATUS.capturado
            return (
              // A linha inteira abre o editor. O link "ver original" e o
              // preço ficam dentro, então o clique neles não pode subir e
              // navegar junto — daí o stopPropagation no <a>.
              <div key={r.id}
                onClick={() => router.push(`/dashboard/anuncios-rascunhos/${r.id}`)}
                className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 cursor-pointer">
                {r.imagem_principal
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.imagem_principal} alt="" className="w-12 h-12 rounded object-cover border border-slate-200 shrink-0" />
                  : <div className="w-12 h-12 rounded bg-slate-100 shrink-0" />}

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 font-medium truncate" title={r.titulo ?? ''}>{r.titulo}</p>
                  <p className="text-[11px] text-slate-400">
                    {r.origem_marketplace === 'mercadolivre' ? 'Mercado Livre' : r.origem_marketplace}
                    {r.origem_vendedor && ` · ${r.origem_vendedor}`}
                    {' · '}{r.qtd_imagens} imagem(ns)
                    {r.tem_variacao && ' · variações'}
                    {r.colecao && ` · ${r.colecao}`}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Capturado em {dataBr(r.capturado_em)}
                    {r.origem_url && (
                      <> · <a href={r.origem_url} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-blue-500 hover:underline">ver original</a></>
                    )}
                  </p>
                </div>

                <div className="text-right shrink-0 min-w-[150px]">
                  <p className="text-sm text-slate-700">{brl(r.preco_origem)}</p>
                  <p className="text-[10px] text-slate-400">preço do anúncio de origem</p>
                </div>

                <div className="shrink-0 min-w-[190px]">
                  {r.produtos ? (
                    <>
                      <p className="text-xs text-slate-700 truncate" title={r.produtos.nome}>{r.produtos.nome}</p>
                      <p className="text-[10px] text-slate-400">{r.produtos.sku ?? 'sem SKU'}</p>
                    </>
                  ) : (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
                      sem produto vinculado
                    </span>
                  )}
                </div>

                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.cor}`}>
                  {s.rotulo}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Painel da extensão ───────────────────────────────────────────────────────

/**
 * Capturar rascunho colando o endereco do anuncio.
 *
 * A extensao le a PAGINA; isto le a API do Mercado Livre com o token da
 * propria empresa. Sao dois caminhos para a mesma coisa, e o motivo de existir
 * o segundo e simples: quem recebeu um link no WhatsApp, esta no celular, ou
 * esta numa maquina sem a extensao instalada, nao tinha como capturar.
 *
 * A DIFERENCA DE COMPLETUDE E DITA NA TELA, e nao escondida. A API nao devolve
 * preco riscado, quantidade vendida nem o vendedor do momento — coisas que so
 * existem na pagina renderizada. Um rascunho que nasce com esses campos vazios
 * e um rascunho legitimo; um operador que descobre isso na hora de publicar,
 * nao.
 */
function PainelImportarLink({ onImportado }: { onImportado: () => void }) {
  const [url, setUrl] = useState('')
  const [importando, setImportando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{
    duplicado: boolean; titulo?: string; qtdImagens?: number; temVariacao?: boolean; mensagem?: string
  } | null>(null)

  async function importar() {
    const limpo = url.trim()
    if (!limpo) return
    setImportando(true); setErro(''); setResultado(null)
    try {
      const d = await fetch('/api/marketplaces/rascunhos/importar-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: limpo }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Nao foi possivel importar'); return }
      setResultado(d)
      setUrl('')
      onImportado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao importar')
    } finally {
      setImportando(false)
    }
  }

  return (
    <div className="mb-5 bg-white border border-blue-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Importar por link</h2>
      <p className="text-xs text-slate-500 mb-3">
        Cole o endereço de um anúncio do Mercado Livre. A leitura usa a API com a conta conectada
        da sua empresa — não é preciso ter a extensão nesta máquina.
      </p>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !importando) void importar() }}
          placeholder="https://produto.mercadolivre.com.br/MLB-..."
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 placeholder-slate-400" />
        <button
          onClick={() => void importar()}
          disabled={importando || !url.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 flex-shrink-0">
          {importando ? 'Lendo...' : 'Importar'}
        </button>
      </div>

      {erro && <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</p>}

      {resultado && (
        <div className={`mt-3 text-xs rounded px-3 py-2 border ${
          resultado.duplicado
            ? 'text-amber-800 bg-amber-50 border-amber-200'
            : 'text-green-800 bg-green-50 border-green-200'}`}>
          {resultado.duplicado ? (
            <p>{resultado.mensagem}</p>
          ) : (
            <>
              <p className="font-medium">✓ {resultado.titulo}</p>
              <p className="mt-0.5">
                {resultado.qtdImagens} imagem(ns) capturada(s)
                {resultado.temVariacao ? ' · o anúncio tem variações' : ''}
              </p>
              {/* O que esta origem nao traz. Dito agora, nao na publicacao. */}
              <p className="mt-1.5 text-[11px] text-green-900/70">
                Lido pela API: preço riscado, quantidade vendida e vendedor não vêm por este
                caminho — só pela extensão, que lê a página. Confira na revisão.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PainelExtensao() {
  const [tokens, setTokens] = useState<TokenExtensao[]>([])
  const [nome, setNome] = useState('')
  const [gerando, setGerando] = useState(false)
  const [tokenNovo, setTokenNovo] = useState('')
  const [erro, setErro] = useState('')

  async function carregar() {
    const res = await fetch('/api/extensao/tokens')
    const d = await res.json().catch(() => ({}))
    if (d.ok) setTokens(d.tokens)
    else setErro(d.erro ?? 'Erro ao carregar')
  }
  useEffect(() => { carregar() }, [])

  async function gerar() {
    if (!nome.trim()) { setErro('Dê um nome ao dispositivo.'); return }
    setGerando(true); setErro('')
    try {
      const res = await fetch('/api/extensao/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeDispositivo: nome.trim() }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.erro)
      setTokenNovo(d.token)
      setNome('')
      carregar()
    } catch (e: any) { setErro(e?.message ?? 'Erro ao gerar') } finally { setGerando(false) }
  }

  async function revogar(id: string) {
    await fetch(`/api/extensao/tokens?id=${id}`, { method: 'DELETE' })
    carregar()
  }

  return (
    <div className="mb-5 bg-white border border-purple-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Extensão do Chrome</h2>
      <p className="text-xs text-slate-500 mb-3">
        Gere um código para cada computador onde a extensão for usada. Ele vale 90 dias e pode ser
        cancelado a qualquer momento — sem passar sua senha para a extensão.
      </p>

      {tokenNovo && (
        <div className="mb-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <p className="text-xs font-semibold text-emerald-800 mb-1.5">
            Copie agora — este código não será mostrado de novo:
          </p>
          <div className="flex gap-2">
            <input readOnly value={tokenNovo} onFocus={e => e.target.select()}
              className="flex-1 px-2 py-1.5 text-xs font-mono border border-emerald-300 rounded bg-white" />
            <button onClick={() => navigator.clipboard.writeText(tokenNovo)}
              className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white">Copiar</button>
            <button onClick={() => setTokenNovo('')}
              className="px-3 py-1.5 text-xs text-emerald-700">Já copiei</button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <input value={nome} onChange={e => setNome(e.target.value)}
          placeholder="Nome do computador (ex: Notebook da loja)"
          className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg" />
        <button onClick={gerar} disabled={gerando}
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white">
          {gerando ? 'Gerando...' : 'Gerar código'}
        </button>
      </div>

      {erro && <p className="text-xs text-red-600 mb-2">{erro}</p>}

      {tokens.length > 0 && (
        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100">
          {tokens.map(t => {
            const expirado = new Date(t.expira_em).getTime() < Date.now()
            const inativo = !!t.revogado_em || expirado
            return (
              <div key={t.id} className={`px-3 py-2 flex items-center gap-3 ${inativo ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-700">{t.nome_dispositivo}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{t.token_prefixo}…</p>
                </div>
                <div className="text-[10px] text-slate-500 text-right">
                  <p>{t.total_capturas} captura(s)</p>
                  <p>{t.ultimo_uso_em ? `último uso ${dataBr(t.ultimo_uso_em)}` : 'nunca usado'}</p>
                </div>
                {t.revogado_em ? <span className="text-[10px] text-red-600 font-medium">cancelado</span>
                  : expirado ? <span className="text-[10px] text-amber-600 font-medium">expirado</span>
                  : <button onClick={() => revogar(t.id)} className="text-[10px] text-red-600 hover:underline">cancelar</button>}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-3">
        A pasta da extensão fica em <code className="bg-slate-100 px-1 rounded">extensao-chrome</code>, no projeto.
        No Chrome: <b>Extensões → Modo desenvolvedor → Carregar sem compactação</b>.
      </p>
    </div>
  )
}
