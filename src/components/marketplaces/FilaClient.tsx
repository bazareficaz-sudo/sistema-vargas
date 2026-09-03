'use client'

import { useState } from 'react'
import { decidirSimulacao } from '@/lib/marketplace/simulacao'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Fila de atualização de anúncios — modo simulação.
//
// A tela existe para responder uma pergunta antes de qualquer envio real:
// "o que este mecanismo mandaria para os meus anúncios, e isso está certo?".

type Config = {
  empresa_id: string; ativo: boolean; simulacao: boolean
  intervalo_min: number; max_produtos_rodada: number; estoque_urgente: number
  ultima_execucao: string | null
}

type Pendente = {
  id: string; produto_id: string; sujo_em: string; motivo: string | null; prioridade: number
  produtos: { nome: string; sku: string | null; estoque: number } | null
}

type Simulacao = {
  id: string; rodada_em: string; acao: string
  estoque_sistema: number | null; estoque_canal: number | null; estoque_enviaria: number | null
  preco_canal: number | null; preco_enviaria: number | null; detalhe: string | null
  produtos: { nome: string; sku: string | null } | null
  marketplace_canais: { nome: string; plataforma: string } | null
}

const ROTULO_ACAO: Record<string, { txt: string; cls: string }> = {
  enviaria:        { txt: 'Enviaria',       cls: 'bg-blue-100 text-blue-700' },
  enviado:         { txt: 'Enviado',        cls: 'bg-green-100 text-green-700' },
  sem_mudanca:     { txt: 'Já igual',       cls: 'bg-gray-100 text-gray-500' },
  sem_anuncio:     { txt: 'Sem anúncio',    cls: 'bg-amber-100 text-amber-700' },
  com_variacao:    { txt: 'Com variação',   cls: 'bg-purple-100 text-purple-700' },
  canal_desligado: { txt: 'Canal desligado', cls: 'bg-gray-100 text-gray-500' },
  erro:            { txt: 'Erro',           cls: 'bg-red-100 text-red-600' },
}

function quando(iso: string) {
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 1440) return `há ${Math.round(min / 60)}h`
  return d.toLocaleDateString('pt-BR')
}

type CanalFila = {
  id: string
  nome: string
  plataforma: string
  /** NULL = herda da empresa. Ver src/lib/marketplace/simulacao.ts. */
  fila_simulacao: boolean | null
  atualizar_estoque_canal: boolean | null
}

export default function FilaClient({
  empresaId, config: cfgInicial, pendentes, totalPendentes, simulacoes, canais = [],
}: {
  empresaId: string; config: Config | null
  pendentes: Pendente[]; totalPendentes: number; simulacoes: Simulacao[]
  canais?: CanalFila[]
}) {
  const router = useRouter()
  const [cfg, setCfg] = useState<Config>(cfgInicial ?? {
    empresa_id: empresaId, ativo: false, simulacao: true,
    intervalo_min: 15, max_produtos_rodada: 100, estoque_urgente: 3, ultima_execucao: null,
  })
  const [canaisEstado, setCanaisEstado] = useState(canais)
  const [canalOcupado, setCanalOcupado] = useState<string | null>(null)

  // A ESCOLHA DO CANAL GRAVA NA HORA, sem botao de salvar: sao tres estados
  // num seletor, e um "salvar" separado so criaria a chance de alguem trocar
  // e sair sem gravar, achando que ligou o envio real.
  async function mudarSimulacaoCanal(canalId: string, valor: boolean | null) {
    setCanalOcupado(canalId)
    try {
      const sb = createClient()
      const { error } = await sb.from('marketplace_canais')
        .update({ fila_simulacao: valor }).eq('id', canalId)
      if (error) { setAviso(`Nao foi possivel salvar: ${error.message}`); return }
      setCanaisEstado(cs => cs.map(c => c.id === canalId ? { ...c, fila_simulacao: valor } : c))
    } finally {
      setCanalOcupado(null)
    }
  }

  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [aba, setAba] = useState<'fila' | 'simulacao'>('simulacao')
  const [filtroAcao, setFiltroAcao] = useState('')
  const [pedindoConfirmacao, setPedindoConfirmacao] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')

  async function salvar() {
    setSalvando(true); setAviso('')
    const sb = createClient()
    const { error } = await sb.from('marketplace_fila_config').upsert({
      empresa_id: empresaId,
      ativo: cfg.ativo, simulacao: cfg.simulacao,
      intervalo_min: cfg.intervalo_min, max_produtos_rodada: cfg.max_produtos_rodada,
      estoque_urgente: cfg.estoque_urgente, updated_at: new Date().toISOString(),
    }, { onConflict: 'empresa_id' })
    setSalvando(false)
    setAviso(error ? error.message : 'Configuração salva.')
    router.refresh()
  }

  const simsFiltradas = simulacoes.filter(s => !filtroAcao || s.acao === filtroAcao)
  const contagem = simulacoes.reduce<Record<string, number>>((acc, s) => {
    acc[s.acao] = (acc[s.acao] ?? 0) + 1; return acc
  }, {})
  const ultimaRodada = simulacoes[0]?.rodada_em

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>Marketplaces</span><span>›</span>
        <span className="text-gray-600">Fila de atualização</span>
      </div>

      <h1 className="text-xl font-semibold text-gray-900">Fila de atualização de anúncios</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Produto que se movimenta no sistema entra na fila; a fila leva o número novo para os anúncios.
      </p>

      {/* O estado mais importante da tela fica no topo, escrito, não em ícone. */}
      <div className={`rounded-xl px-4 py-3 mb-5 border ${
        !cfg.ativo ? 'bg-gray-50 border-gray-200'
        : cfg.simulacao ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'
      }`}>
        {!cfg.ativo ? (
          <p className="text-sm text-gray-600">
            <b>A fila está desligada.</b> Nada é calculado nem enviado. Os produtos continuam entrando
            na fila conforme se movimentam — quando você ligar, ela já começa com o que se acumulou.
          </p>
        ) : cfg.simulacao ? (
          <>
            <p className="text-sm text-blue-900">
              <b>Modo simulação.</b> A fila calcula tudo e grava o que enviaria, mas
              <b> não envia nada</b> para nenhum marketplace.
            </p>
            <p className="text-xs text-blue-800 mt-1">
              Confira alguns dias de simulação contra o que está de fato nos canais antes de ligar o
              envio real. Um erro aqui não é um número errado numa tela: é anúncio vendendo o que não existe.
            </p>
          </>
        ) : (
          <p className="text-sm text-green-900">
            <b>Envio real ligado.</b> A fila altera os anúncios nos marketplaces.
          </p>
        )}
      </div>

      {/* Configuração */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Configuração</h2>

        <label className="flex items-start gap-2 cursor-pointer mb-3">
          <input type="checkbox" checked={cfg.ativo} onChange={e => setCfg(c => ({ ...c, ativo: e.target.checked }))}
            className="w-4 h-4 accent-blue-600 mt-0.5" />
          <span className="text-sm text-gray-900">
            <b>Fila ligada</b>
            <span className="block text-xs text-gray-500">Processa os produtos movimentados no intervalo abaixo.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer mb-1">
          <input type="checkbox" checked={cfg.simulacao}
            onChange={e => {
              if (e.target.checked) { setCfg(c => ({ ...c, simulacao: true })); setConfirmacao(''); return }
              // Desligar a simulação é a decisão mais séria desta tela: a
              // partir daí a fila altera anúncios de verdade. Um clique
              // distraído não pode bastar.
              setPedindoConfirmacao(true)
            }}
            className="w-4 h-4 accent-blue-600 mt-0.5" />
          <span className="text-sm text-gray-900">
            <b>Somente simular (não enviar)</b>
            <span className="block text-xs text-gray-500">
              Desmarcado, a fila passa a alterar os anúncios nos marketplaces.
            </span>
          </span>
        </label>

        {/* ── SIMULAÇÃO POR CANAL ──────────────────────────────────
            A configuração acima é da EMPRESA. Aqui cada canal pode
            discordar dela — é o que permite testar o envio real em um
            canal só, mantendo os outros parados. */}
        {canaisEstado.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-900">Por canal</p>
            <p className="text-xs text-gray-500 mt-0.5 mb-3">
              Cada canal pode seguir a empresa ou decidir por conta própria. É assim que se liga o
              envio real em um canal só.
            </p>

            <div className="space-y-2">
              {canaisEstado.map(c => {
                const d = decidirSimulacao(c, { simulacaoDaEmpresa: cfg.simulacao })
                const valor = c.fila_simulacao === null || c.fila_simulacao === undefined
                  ? 'herda' : c.fila_simulacao ? 'simula' : 'envia'
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                    <span className="text-sm text-gray-800 min-w-[9rem]">{c.nome}</span>

                    <select
                      value={valor}
                      disabled={canalOcupado === c.id}
                      onChange={e => {
                        const v = e.target.value
                        void mudarSimulacaoCanal(c.id, v === 'herda' ? null : v === 'simula')
                      }}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                      <option value="herda">Seguir a empresa</option>
                      <option value="simula">Somente simular</option>
                      <option value="envia">Enviar de verdade</option>
                    </select>

                    {/* O RESULTADO EFETIVO, e não só a escolha. "Seguir a
                        empresa" não diz se está enviando — depende do que a
                        empresa está fazendo, e é isso que decide. */}
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      d.simula
                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'bg-green-50 border-green-200 text-green-700'
                    }`}>
                      {d.simula ? 'simulando' : 'ENVIANDO'}
                    </span>

                    {/* O outro interruptor que também precisa estar ligado.
                        Sem ele o canal recusa o envio, e a pessoa ficaria
                        procurando por que "ENVIANDO" não envia. */}
                    {!d.simula && c.atualizar_estoque_canal === false && (
                      <span className="text-[11px] text-amber-700">
                        mas &quot;atualizar estoque do canal&quot; está desligado em Configurar → canal
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {pedindoConfirmacao && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 mt-2">
            <p className="text-sm text-amber-900">
              <b>Isto liga o envio real.</b> A partir da próxima rodada, a fila vai alterar estoque e preço
              dos seus anúncios no Mercado Livre e na Shopee automaticamente, sem pedir confirmação por anúncio.
            </p>
            <p className="text-xs text-amber-800 mt-1.5">
              Só os canais com <b>&quot;atualizar estoque do canal&quot;</b> ligado recebem — é assim que se começa
              por um canal só. Confira em Configurar → canal antes de seguir.
            </p>
            <p className="text-xs text-amber-800 mt-1.5">
              Para confirmar, digite <b>ENVIAR</b> abaixo.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <input value={confirmacao} onChange={e => setConfirmacao(e.target.value.toUpperCase())}
                placeholder="ENVIAR"
                className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-amber-500" />
              <button onClick={() => { setCfg(c => ({ ...c, simulacao: false })); setPedindoConfirmacao(false) }}
                disabled={confirmacao !== 'ENVIAR'}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
                Ligar envio real
              </button>
              <button onClick={() => { setPedindoConfirmacao(false); setConfirmacao('') }}
                className="text-xs text-gray-500 hover:text-gray-700">cancelar</button>
            </div>
            <p className="text-[11px] text-amber-700 mt-2">
              Nada muda até você clicar em <b>Salvar</b>.
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Intervalo (minutos)</label>
            <input type="number" min={5} max={240} value={cfg.intervalo_min}
              onChange={e => setCfg(c => ({ ...c, intervalo_min: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400 mt-1">De quanto em quanto tempo a fila é processada.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Máx. produtos por rodada</label>
            <input type="number" min={10} max={1000} value={cfg.max_produtos_rodada}
              onChange={e => setCfg(c => ({ ...c, max_produtos_rodada: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400 mt-1">
              O intervalo controla o atraso; este teto controla o estrago. Uma entrada de XML com 200 itens
              suja 200 produtos de uma vez.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Estoque urgente (≤)</label>
            <input type="number" min={0} max={50} value={cfg.estoque_urgente}
              onChange={e => setCfg(c => ({ ...c, estoque_urgente: Number(e.target.value) }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
            <p className="text-[11px] text-gray-400 mt-1">
              Produto que cai a este nível fura a fila — é o caso em que esperar custa venda do que não existe.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={salvar} disabled={salvando}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          {cfg.ultima_execucao && (
            <span className="text-xs text-gray-400">Última rodada {quando(cfg.ultima_execucao)}</span>
          )}
          {aviso && <span className="text-xs text-gray-600">{aviso}</span>}
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4">
        {([['simulacao', `O que enviaria (${simulacoes.length})`], ['fila', `Na fila agora (${totalPendentes})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              aba === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}>{l}</button>
        ))}
      </div>

      {aba === 'simulacao' ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700">
              O que a fila enviaria {ultimaRodada && <span className="font-normal text-gray-400">· última rodada {quando(ultimaRodada)}</span>}
            </h2>
            <div className="flex gap-1 ml-auto flex-wrap">
              <button onClick={() => setFiltroAcao('')}
                className={`px-2 py-1 text-xs rounded-md border ${!filtroAcao ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
                todos ({simulacoes.length})
              </button>
              {Object.entries(contagem).map(([acao, n]) => (
                <button key={acao} onClick={() => setFiltroAcao(acao)}
                  className={`px-2 py-1 text-xs rounded-md border ${filtroAcao === acao ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
                  {ROTULO_ACAO[acao]?.txt ?? acao} ({n})
                </button>
              ))}
            </div>
          </div>

          {simsFiltradas.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">
              Nenhuma simulação ainda. Ela aparece depois da primeira rodada com a fila ligada e algum
              produto movimentado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Produto</th>
                    <th className="px-3 py-2 text-left font-medium">Canal</th>
                    <th className="px-3 py-2 text-center font-medium">Situação</th>
                    <th className="px-3 py-2 text-right font-medium">Sistema</th>
                    <th className="px-3 py-2 text-right font-medium">No canal</th>
                    <th className="px-3 py-2 text-right font-medium">Enviaria</th>
                    <th className="px-4 py-2 text-left font-medium">Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {simsFiltradas.map(s => {
                    const r = ROTULO_ACAO[s.acao] ?? { txt: s.acao, cls: 'bg-gray-100 text-gray-500' }
                    const mudou = s.acao === 'enviaria'
                    return (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <p className="text-xs text-gray-900">{s.produtos?.nome ?? '—'}</p>
                          <p className="text-[11px] text-gray-400">{s.produtos?.sku ?? ''}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">
                          {s.marketplace_canais?.nome ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${r.cls}`}>{r.txt}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-600">{s.estoque_sistema ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-600">{s.estoque_canal ?? '—'}</td>
                        <td className={`px-3 py-2.5 text-right text-xs font-medium ${mudou ? 'text-blue-700' : 'text-gray-400'}`}>
                          {s.estoque_enviaria ?? '—'}
                          {s.preco_enviaria != null && (
                            <span className="block text-[11px] text-gray-400">
                              R$ {Number(s.preco_enviaria).toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-gray-500 max-w-xs">{s.detalhe}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              Produtos esperando processamento ({totalPendentes})
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Um produto aparece uma vez só, por mais que tenha se movimentado várias.
            </p>
          </div>
          {pendentes.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">
              Fila vazia — nenhum produto movimentado desde a última rodada.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Produto</th>
                  <th className="px-3 py-2 text-left font-medium">Motivo</th>
                  <th className="px-3 py-2 text-right font-medium">Estoque</th>
                  <th className="px-3 py-2 text-left font-medium">Na fila desde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendentes.map(p => (
                  <tr key={p.id} className={p.prioridade > 0 ? 'bg-red-50/40' : ''}>
                    <td className="px-4 py-2.5">
                      <p className="text-xs text-gray-900">
                        {p.prioridade > 0 && <span className="text-red-600 mr-1">urgente</span>}
                        {p.produtos?.nome ?? '—'}
                      </p>
                      <p className="text-[11px] text-gray-400">{p.produtos?.sku ?? ''}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{p.motivo ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-gray-600">{p.produtos?.estoque ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-400">{quando(p.sujo_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {totalPendentes > pendentes.length && (
            <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
              Mostrando {pendentes.length} de {totalPendentes}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
