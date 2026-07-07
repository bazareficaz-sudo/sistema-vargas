'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Vendedor { id: string; codigo?: string; nome: string; apelido?: string }

interface Regra {
  _id: string
  tipo: string
  alvo_tipo: string
  alvo_nomes: string[]
  valor: number
  configuracao: {
    tiers?: { ate: number | null; valor: number }[]
    min_margem?: number
    max_margem?: number
    canais?: string[]
    forma_pagamento?: string[]
  }
  condicoes: Record<string, any>
  ativo: boolean
}

interface MetaForm {
  _id: string
  nome: string
  tipo: string
  valor_meta: number
  periodo: string
}

interface BonusForm {
  _id: string
  nome: string
  tipo: string
  valor: number
  criterio: string
}

interface Props {
  plano: any | null
  vendedores: Vendedor[]
  empresaId: string
  onSalvar: (p: any) => void
  onFechar: () => void
}

type Tab = 'basico' | 'regras' | 'metas' | 'participantes'

const TIPO_REGRA: Record<string, { label: string; sufixo: string; descricao: string }> = {
  percentual:   { label: '% sobre venda',       sufixo: '%',  descricao: 'Percentual aplicado sobre o valor vendido' },
  fixo_unidade: { label: 'R$ por unidade',       sufixo: 'R$', descricao: 'Valor fixo por cada unidade vendida' },
  fixo_venda:   { label: 'R$ por venda',         sufixo: 'R$', descricao: 'Valor fixo por operação de venda' },
  progressivo:  { label: 'Progressivo (faixas)', sufixo: '',   descricao: 'Percentual aumenta conforme faturamento' },
  por_lucro:    { label: '% sobre lucro',        sufixo: '%',  descricao: 'Percentual aplicado sobre o lucro bruto' },
  por_margem:   { label: 'Por margem mínima',    sufixo: '%',  descricao: 'Comissão condicionada à margem do produto' },
  pontos:       { label: 'Pontos (gamificação)', sufixo: 'pts',descricao: 'Cada unidade vendida gera pontos' },
  cliente_novo: { label: 'R$ cliente novo',      sufixo: 'R$', descricao: 'Bônus por trazer novo cliente' },
  cliente_recup:{ label: 'R$ cliente recuperado',sufixo: 'R$', descricao: 'Bônus por reativar cliente inativo' },
}

const ALVO_TIPO: Record<string, string> = {
  geral:           'Todos os produtos',
  categoria:       'Por categoria',
  subcategoria:    'Por subcategoria',
  marca:           'Por marca',
  fornecedor:      'Por fornecedor',
  tag:             'Por TAG do produto',
  canal:           'Por canal de venda',
  forma_pagamento: 'Por forma de pagamento',
  produto:         'Produtos específicos',
}

const CANAIS = ['PDV', 'WhatsApp', 'Mercado Livre', 'Shopee', 'TikTok', 'Nuvemshop', 'Site', 'Televendas']
const FORMAS_PAG = ['dinheiro', 'pix', 'debito', 'credito', 'carteira', 'fiado']
const PERIODOS = [
  { v: 'diario', l: 'Diária' }, { v: 'semanal', l: 'Semanal' }, { v: 'mensal', l: 'Mensal' },
  { v: 'trimestral', l: 'Trimestral' }, { v: 'semestral', l: 'Semestral' },
  { v: 'anual', l: 'Anual' }, { v: 'campanha', l: 'Campanha' },
]
const TIPOS_META = [
  { v: 'valor', l: 'Valor vendido (R$)' }, { v: 'quantidade', l: 'Qtd vendida' },
  { v: 'lucro', l: 'Lucro' }, { v: 'margem', l: 'Margem %' },
  { v: 'clientes', l: 'Clientes atendidos' }, { v: 'novos_clientes', l: 'Novos clientes' },
  { v: 'ticket_medio', l: 'Ticket médio' }, { v: 'conversao', l: 'Orçamentos convertidos' },
]
const CRITERIOS_BONUS = [
  { v: 'meta_80', l: 'Ao atingir 80% da meta' },
  { v: 'meta_100', l: 'Ao atingir 100% da meta' },
  { v: 'meta_120', l: 'Ao superar 120% da meta' },
  { v: 'top1', l: '1º lugar do ranking' },
  { v: 'top3', l: 'Top 3 do ranking' },
  { v: 'top10', l: 'Top 10 do ranking' },
  { v: 'todos', l: 'Todos os participantes' },
]

function uid() { return Math.random().toString(36).slice(2, 9) }

function novaRegra(): Regra {
  return { _id: uid(), tipo: 'percentual', alvo_tipo: 'geral', alvo_nomes: [], valor: 0, configuracao: { tiers: [{ ate: null, valor: 0 }] }, condicoes: {}, ativo: true }
}

function novaMeta(): MetaForm {
  return { _id: uid(), nome: '', tipo: 'valor', valor_meta: 0, periodo: 'mensal' }
}

function novoBonus(): BonusForm {
  return { _id: uid(), nome: '', tipo: 'fixo', valor: 0, criterio: 'meta_100' }
}

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  function add() {
    const v = input.trim()
    if (v && !tags.includes(v)) onChange([...tags, v])
    setInput('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map(t => (
          <span key={t} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
            {t}
            <button onClick={() => onChange(tags.filter(x => x !== t))} className="hover:text-red-600 text-base leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder ?? 'Digite e pressione Enter ou + Add…'}
          className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400" />
        <button onClick={add} type="button"
          className="text-xs text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
          + Add
        </button>
      </div>
    </div>
  )
}

function ProdutoSearch({ empresaId, selecionados, onChange }: {
  empresaId: string
  selecionados: string[]   // array de "SKU — Nome"
  onChange: (s: string[]) => void
}) {
  const sb = createClient()
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<{ id: string; sku: string; nome: string }[]>([])
  const [carregando, setCarregando] = useState(false)

  async function pesquisar(q: string) {
    setBusca(q)
    if (q.length < 2) { setResultados([]); return }
    setCarregando(true)
    const { data } = await sb.from('produtos')
      .select('id, sku, nome')
      .eq('empresa_id', empresaId)
      .or(`sku.ilike.%${q}%,nome.ilike.%${q}%`)
      .limit(10)
    setResultados(data ?? [])
    setCarregando(false)
  }

  function selecionar(p: { id: string; sku: string; nome: string }) {
    const label = `${p.sku} — ${p.nome}`
    if (!selecionados.includes(label)) onChange([...selecionados, label])
    setBusca('')
    setResultados([])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {selecionados.map(s => (
          <span key={s} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
            {s}
            <button onClick={() => onChange(selecionados.filter(x => x !== s))} className="hover:text-red-600 text-base leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          value={busca}
          onChange={e => pesquisar(e.target.value)}
          placeholder="Buscar por SKU ou nome do produto…"
          className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400"
        />
        {carregando && (
          <span className="absolute right-3 top-1.5 text-xs text-slate-400">buscando…</span>
        )}
        {resultados.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
            {resultados.map(p => (
              <button key={p.id} type="button"
                onClick={() => selecionar(p)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                <span className="font-mono text-slate-500 flex-shrink-0 w-16 truncate">{p.sku}</span>
                <span className="text-slate-700 truncate">{p.nome}</span>
              </button>
            ))}
          </div>
        )}
        {busca.length >= 2 && !carregando && resultados.length === 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2">
            <p className="text-xs text-slate-400">Nenhum produto encontrado para "{busca}"</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlanoModal({ plano, vendedores, empresaId, onSalvar, onFechar }: Props) {
  const sb = createClient()
  const isNovo = !plano

  const [tab, setTab] = useState<Tab>('basico')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  // ── Step 1 — Básico ──────────────────────────────────────────
  const [nome, setNome]         = useState(plano?.nome ?? '')
  const [descricao, setDescricao] = useState(plano?.descricao ?? '')
  const [tipo, setTipo]         = useState(plano?.tipo ?? 'comissao')
  const [status, setStatus]     = useState(plano?.status ?? 'rascunho')
  const [prioridade, setPrioridade] = useState(String(plano?.prioridade ?? 0))
  const [abrangencia, setAbrangencia] = useState(plano?.abrangencia ?? 'empresa')
  const [recorrencia, setRecorrencia] = useState(plano?.recorrencia ?? 'nenhuma')
  const [vigIni, setVigIni]     = useState(plano?.vigencia_inicio ?? '')
  const [vigFim, setVigFim]     = useState(plano?.vigencia_fim ?? '')
  const [icone, setIcone]       = useState(plano?.icone ?? '')
  const [obs, setObs]           = useState(plano?.observacoes ?? '')

  // ── Step 2 — Regras ──────────────────────────────────────────
  const initRegras: Regra[] = (plano?.incentivo_regras ?? []).map((r: any) => ({
    _id: r.id ?? uid(), tipo: r.tipo, alvo_tipo: r.alvo_tipo ?? 'geral',
    alvo_nomes: r.alvo_nomes ?? [], valor: r.valor ?? 0,
    configuracao: r.configuracao ?? { tiers: [{ ate: null, valor: 0 }] },
    condicoes: r.condicoes ?? {}, ativo: r.ativo ?? true,
  }))
  const [regras, setRegras] = useState<Regra[]>(initRegras.length ? initRegras : [novaRegra()])

  // ── Step 3 — Metas & Bônus ───────────────────────────────────
  const initMetas: MetaForm[] = (plano?.incentivo_metas ?? []).map((m: any) => ({
    _id: m.id ?? uid(), nome: m.nome, tipo: m.tipo, valor_meta: m.valor_meta ?? 0, periodo: m.periodo ?? 'mensal',
  }))
  const [metas, setMetas] = useState<MetaForm[]>(initMetas)

  const initBonus: BonusForm[] = (plano?.incentivo_bonus ?? []).map((b: any) => ({
    _id: b.id ?? uid(), nome: b.nome, tipo: b.tipo, valor: b.valor ?? 0, criterio: b.criterio ?? 'meta_100',
  }))
  const [bonusArr, setBonusArr] = useState<BonusForm[]>(initBonus)

  // ── Step 4 — Participantes ────────────────────────────────────
  const initTodos = plano?.incentivo_participantes?.some((p: any) => p.todos_vendedores) ?? false
  const initPart  = new Set<string>((plano?.incentivo_participantes ?? []).filter((p: any) => !p.todos_vendedores).map((p: any) => p.vendedor_id as string))
  const [todosVendedores, setTodosVendedores] = useState(initTodos)
  const [partSelecionados, setPartSelecionados] = useState<Set<string>>(initPart)

  // ── Helpers regras ───────────────────────────────────────────
  function updateRegra(id: string, patch: Partial<Regra>) {
    setRegras(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r))
  }
  function addTier(rId: string) {
    setRegras(prev => prev.map(r => r._id !== rId ? r : {
      ...r, configuracao: { ...r.configuracao, tiers: [...(r.configuracao.tiers ?? []), { ate: null, valor: 0 }] }
    }))
  }
  function updateTier(rId: string, i: number, patch: Partial<{ ate: number | null; valor: number }>) {
    setRegras(prev => prev.map(r => {
      if (r._id !== rId) return r
      const tiers = [...(r.configuracao.tiers ?? [])]
      tiers[i] = { ...tiers[i], ...patch }
      return { ...r, configuracao: { ...r.configuracao, tiers } }
    }))
  }
  function removeTier(rId: string, i: number) {
    setRegras(prev => prev.map(r => {
      if (r._id !== rId) return r
      const tiers = (r.configuracao.tiers ?? []).filter((_, ix) => ix !== i)
      return { ...r, configuracao: { ...r.configuracao, tiers } }
    }))
  }

  // ── Salvar ────────────────────────────────────────────────────
  async function salvar() {
    setErro('')
    if (!nome.trim()) { setErro('O nome do plano é obrigatório.'); setTab('basico'); return }
    if (regras.length === 0) { setErro('Adicione ao menos uma regra de incentivo.'); setTab('regras'); return }

    setSalvando(true)
    try {
      const payload = {
        empresa_id: empresaId,
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        tipo, status,
        prioridade: parseInt(prioridade) || 0,
        abrangencia, recorrencia,
        vigencia_inicio: vigIni || null,
        vigencia_fim: vigFim || null,
        icone: icone.trim() || null,
        observacoes: obs.trim() || null,
        updated_at: new Date().toISOString(),
      }

      let planoId = plano?.id
      if (isNovo) {
        const { data, error } = await sb.from('incentivo_planos').insert({ ...payload, created_at: new Date().toISOString() }).select().single()
        if (error) throw error
        planoId = data.id
      } else {
        const { error } = await sb.from('incentivo_planos').update(payload).eq('id', planoId)
        if (error) throw error
        // Limpar filhos para re-inserir
        await sb.from('incentivo_regras').delete().eq('plano_id', planoId)
        await sb.from('incentivo_metas').delete().eq('plano_id', planoId)
        await sb.from('incentivo_bonus').delete().eq('plano_id', planoId)
        await sb.from('incentivo_participantes').delete().eq('plano_id', planoId)
      }

      // Inserir regras
      if (regras.length > 0) {
        await sb.from('incentivo_regras').insert(regras.map((r, idx) => ({
          plano_id: planoId, tipo: r.tipo, alvo_tipo: r.alvo_tipo,
          alvo_nomes: r.alvo_nomes, valor: r.valor,
          configuracao: r.configuracao, condicoes: r.condicoes,
          ordem: idx, ativo: r.ativo,
        })))
      }

      // Inserir metas
      if (metas.length > 0) {
        await sb.from('incentivo_metas').insert(metas.map(m => ({
          plano_id: planoId, nome: m.nome || 'Meta', tipo: m.tipo,
          valor_meta: m.valor_meta, periodo: m.periodo,
        })))
      }

      // Inserir bônus
      if (bonusArr.length > 0) {
        await sb.from('incentivo_bonus').insert(bonusArr.map(b => ({
          plano_id: planoId, nome: b.nome || 'Bônus', tipo: b.tipo,
          valor: b.valor, criterio: b.criterio,
        })))
      }

      // Inserir participantes
      if (todosVendedores) {
        await sb.from('incentivo_participantes').insert({ plano_id: planoId, todos_vendedores: true, empresa_id: empresaId })
      } else if (partSelecionados.size > 0) {
        await sb.from('incentivo_participantes').insert(
          [...partSelecionados].map(vid => ({ plano_id: planoId, vendedor_id: vid, todos_vendedores: false }))
        )
      }

      onSalvar({ ...payload, id: planoId,
        incentivo_regras: regras, incentivo_metas: metas,
        incentivo_bonus: bonusArr,
        incentivo_participantes: todosVendedores
          ? [{ todos_vendedores: true }]
          : [...partSelecionados].map(v => ({ vendedor_id: v, todos_vendedores: false })),
      })
    } catch (e: any) {
      setErro(e?.message ?? 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'basico',        label: '1. Básico' },
    { key: 'regras',        label: '2. Regras', badge: regras.length },
    { key: 'metas',         label: '3. Metas & Bônus', badge: metas.length + bonusArr.length },
    { key: 'participantes', label: '4. Participantes', badge: todosVendedores ? undefined : partSelecionados.size },
  ]

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onFechar} />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col h-screen overflow-hidden">

        {/* Cabeçalho */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-slate-900 text-xl font-bold">{isNovo ? 'Novo Plano de Incentivo' : 'Editar Plano'}</h2>
            {!isNovo && <p className="text-slate-400 text-xs mt-0.5">{plano.nome}</p>}
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-2xl leading-none p-1">×</button>
        </div>

        {/* Tabs */}
        <div className="px-6 flex gap-0 border-b border-slate-100 bg-slate-50 flex-shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${tab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── TAB BÁSICO ─────────────────────────────────────── */}
          {tab === 'basico' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Nome do plano *</label>
                <input value={nome} onChange={e => setNome(e.target.value)}
                  placeholder="Ex: Campanha Julho, Comissão Base, Meta Trimestral…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo</label>
                  <select value={tipo} onChange={e => setTipo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                    {[
                      ['comissao','💰 Comissão'],['meta','🎯 Meta'],['bonus','🎁 Bônus'],
                      ['premiacao','🏆 Premiação'],['cashback','🔄 Cashback'],
                      ['campanha','🔥 Campanha'],['gamificacao','🎮 Gamificação'],
                    ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                    <option value="rascunho">Rascunho</option>
                    <option value="ativo">Ativo</option>
                    <option value="pausado">Pausado</option>
                    <option value="encerrado">Encerrado</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Vigência início</label>
                  <input type="date" value={vigIni} onChange={e => setVigIni(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Vigência fim</label>
                  <input type="date" value={vigFim} onChange={e => setVigFim(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Prioridade</label>
                  <input type="number" value={prioridade} onChange={e => setPrioridade(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Abrangência</label>
                  <select value={abrangencia} onChange={e => setAbrangencia(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                    <option value="empresa">Empresa</option>
                    <option value="grupo">Grupo</option>
                    <option value="global">Global</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Recorrência</label>
                  <select value={recorrencia} onChange={e => setRecorrencia(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                    <option value="nenhuma">Nenhuma</option>
                    <option value="mensal">Mensal</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="semestral">Semestral</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ícone (emoji)</label>
                  <input value={icone} onChange={e => setIcone(e.target.value)} placeholder="🏆"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-2xl text-center focus:outline-none focus:border-blue-400" />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Descrição</label>
                  <input value={descricao} onChange={e => setDescricao(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Observações</label>
                <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-400 resize-none" />
              </div>
            </div>
          )}

          {/* ── TAB REGRAS ─────────────────────────────────────── */}
          {tab === 'regras' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Configure as regras de cálculo do incentivo. Múltiplas regras são aplicadas em conjunto.</p>
                <button onClick={() => setRegras(p => [...p, novaRegra()])}
                  className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-colors font-medium">
                  + Nova Regra
                </button>
              </div>

              {regras.map((r, ri) => (
                <div key={r._id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Regra {ri + 1}</span>
                    <div className="flex items-center gap-2">
                      <button type="button"
                        onClick={() => updateRegra(r._id, { ativo: !r.ativo })}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${r.ativo ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                        {r.ativo ? 'Ativa' : 'Inativa'}
                      </button>
                      {regras.length > 1 && (
                        <button onClick={() => setRegras(p => p.filter(x => x._id !== r._id))}
                          className="text-slate-300 hover:text-red-500 text-lg leading-none transition-colors">×</button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Tipo de cálculo</label>
                      <select value={r.tipo} onChange={e => updateRegra(r._id, { tipo: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                        {Object.entries(TIPO_REGRA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <p className="text-[11px] text-slate-400 mt-1">{TIPO_REGRA[r.tipo]?.descricao}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Aplicar sobre</label>
                      <select value={r.alvo_tipo} onChange={e => updateRegra(r._id, { alvo_tipo: e.target.value, alvo_nomes: [] })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400">
                        {Object.entries(ALVO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Valor simples */}
                  {r.tipo !== 'progressivo' && r.tipo !== 'por_margem' && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          {r.tipo === 'pontos' ? 'Pontos por unidade' : r.tipo === 'percentual' || r.tipo === 'por_lucro' ? 'Percentual (%)' : 'Valor (R$)'}
                        </label>
                        <div className="relative">
                          <input type="number" step="0.01" value={r.valor}
                            onChange={e => updateRegra(r._id, { valor: parseFloat(e.target.value) || 0 })}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-blue-400" />
                          <span className="absolute right-3 top-2 text-xs text-slate-400">{TIPO_REGRA[r.tipo]?.sufixo}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Faixas progressivas */}
                  {r.tipo === 'progressivo' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-500">Faixas de faturamento</label>
                      {(r.configuracao.tiers ?? []).map((t, ti) => (
                        <div key={ti} className="flex items-center gap-2">
                          <span className="text-xs text-slate-400 w-20 text-right flex-shrink-0">
                            {ti === 0 ? 'Até R$' : ti === (r.configuracao.tiers?.length ?? 0) - 1 ? 'Acima' : 'Até R$'}
                          </span>
                          {ti < (r.configuracao.tiers?.length ?? 0) - 1 ? (
                            <input type="number" value={t.ate ?? ''} placeholder="20000"
                              onChange={e => updateTier(r._id, ti, { ate: parseFloat(e.target.value) || null })}
                              className="w-28 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                          ) : (
                            <span className="w-28 text-slate-400 text-sm px-2">de qualquer valor</span>
                          )}
                          <span className="text-xs text-slate-400">→</span>
                          <input type="number" step="0.01" value={t.valor} placeholder="2"
                            onChange={e => updateTier(r._id, ti, { valor: parseFloat(e.target.value) || 0 })}
                            className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                          <span className="text-xs text-slate-400">%</span>
                          {(r.configuracao.tiers?.length ?? 0) > 1 && (
                            <button onClick={() => removeTier(r._id, ti)} className="text-slate-300 hover:text-red-400 text-lg leading-none">×</button>
                          )}
                        </div>
                      ))}
                      <button onClick={() => addTier(r._id)}
                        className="text-xs text-blue-600 hover:text-blue-800 mt-1">+ Adicionar faixa</button>
                      <p className="text-[11px] text-slate-400">A última faixa é aplicada para valores acima do limite anterior.</p>
                    </div>
                  )}

                  {/* Margem mínima */}
                  {r.tipo === 'por_margem' && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Margem mínima (%)</label>
                        <input type="number" value={r.configuracao.min_margem ?? ''}
                          onChange={e => updateRegra(r._id, { configuracao: { ...r.configuracao, min_margem: parseFloat(e.target.value) || 0 } })}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Margem máxima (%)</label>
                        <input type="number" value={r.configuracao.max_margem ?? ''}
                          onChange={e => updateRegra(r._id, { configuracao: { ...r.configuracao, max_margem: parseFloat(e.target.value) || undefined } })}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Comissão (%)</label>
                        <input type="number" step="0.01" value={r.valor}
                          onChange={e => updateRegra(r._id, { valor: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                      </div>
                    </div>
                  )}

                  {/* Alvos específicos */}
                  {r.alvo_tipo !== 'geral' && r.alvo_tipo !== 'canal' && r.alvo_tipo !== 'forma_pagamento' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {r.alvo_tipo === 'tag' ? 'TAGs' : r.alvo_tipo === 'categoria' ? 'Categorias' : r.alvo_tipo === 'marca' ? 'Marcas' : r.alvo_tipo === 'produto' ? 'Produtos' : 'Itens'}
                      </label>
                      {r.alvo_tipo === 'produto' ? (
                        <ProdutoSearch
                          empresaId={empresaId}
                          selecionados={r.alvo_nomes}
                          onChange={n => updateRegra(r._id, { alvo_nomes: n })}
                        />
                      ) : (
                        <TagInput
                          tags={r.alvo_nomes}
                          onChange={n => updateRegra(r._id, { alvo_nomes: n })}
                          placeholder={r.alvo_tipo === 'categoria' ? 'Ex: Ferramentas, Elétrico…' : r.alvo_tipo === 'marca' ? 'Ex: Bosch, Tramontina…' : r.alvo_tipo === 'tag' ? 'Ex: Alta Margem, Campanha…' : 'Digite e pressione Enter…'}
                        />
                      )}
                    </div>
                  )}

                  {/* Canal */}
                  {r.alvo_tipo === 'canal' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Canais de venda</label>
                      <div className="flex flex-wrap gap-2">
                        {CANAIS.map(c => {
                          const sel = (r.configuracao.canais ?? []).includes(c)
                          return (
                            <button key={c} type="button"
                              onClick={() => {
                                const curr = r.configuracao.canais ?? []
                                updateRegra(r._id, { configuracao: { ...r.configuracao, canais: sel ? curr.filter(x => x !== c) : [...curr, c] } })
                              }}
                              className={`text-xs px-3 py-1.5 rounded-xl border transition-colors ${sel ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                              {c}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Forma de pagamento */}
                  {r.alvo_tipo === 'forma_pagamento' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Formas de pagamento</label>
                      <div className="flex flex-wrap gap-2">
                        {FORMAS_PAG.map(f => {
                          const labels: Record<string, string> = { dinheiro: '💵 Dinheiro', pix: '📱 PIX', debito: '💳 Débito', credito: '💳 Crédito', carteira: '👛 Carteira', fiado: '📒 Fiado' }
                          const sel = (r.configuracao.forma_pagamento ?? []).includes(f)
                          return (
                            <button key={f} type="button"
                              onClick={() => {
                                const curr: string[] = (r.configuracao.forma_pagamento as string[] | undefined) ?? []
                                updateRegra(r._id, { configuracao: { ...r.configuracao, forma_pagamento: sel ? curr.filter(x => x !== f) : [...curr, f] } })
                              }}
                              className={`text-xs px-3 py-1.5 rounded-xl border transition-colors ${sel ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                              {labels[f] ?? f}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── TAB METAS & BÔNUS ──────────────────────────────── */}
          {tab === 'metas' && (
            <div className="space-y-6">
              {/* Metas */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700">🎯 Metas</p>
                  <button onClick={() => setMetas(p => [...p, novaMeta()])}
                    className="text-xs text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-xl hover:bg-emerald-50 transition-colors">
                    + Adicionar Meta
                  </button>
                </div>
                {metas.length === 0 ? (
                  <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center">
                    Sem metas configuradas — o incentivo é aplicado sobre toda venda sem condição de atingimento.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {metas.map(m => (
                      <div key={m._id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <input value={m.nome} onChange={e => setMetas(p => p.map(x => x._id === m._id ? { ...x, nome: e.target.value } : x))}
                            placeholder="Nome da meta (ex: Meta mensal de vendas)"
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400" />
                          <button onClick={() => setMetas(p => p.filter(x => x._id !== m._id))}
                            className="text-slate-300 hover:text-red-400 text-lg leading-none">×</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Tipo</label>
                            <select value={m.tipo} onChange={e => setMetas(p => p.map(x => x._id === m._id ? { ...x, tipo: e.target.value } : x))}
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-400">
                              {TIPOS_META.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Valor da meta</label>
                            <input type="number" step="0.01" value={m.valor_meta}
                              onChange={e => setMetas(p => p.map(x => x._id === m._id ? { ...x, valor_meta: parseFloat(e.target.value) || 0 } : x))}
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-400" />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Período</label>
                            <select value={m.periodo} onChange={e => setMetas(p => p.map(x => x._id === m._id ? { ...x, periodo: e.target.value } : x))}
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-400">
                              {PERIODOS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <hr className="border-slate-100" />

              {/* Bônus */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700">🎁 Bônus</p>
                  <button onClick={() => setBonusArr(p => [...p, novoBonus()])}
                    className="text-xs text-purple-600 border border-purple-200 px-3 py-1.5 rounded-xl hover:bg-purple-50 transition-colors">
                    + Adicionar Bônus
                  </button>
                </div>
                {bonusArr.length === 0 ? (
                  <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center">
                    Sem bônus configurados — adicione premiações por atingimento de meta ou ranking.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {bonusArr.map(b => (
                      <div key={b._id} className="bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <input value={b.nome} onChange={e => setBonusArr(p => p.map(x => x._id === b._id ? { ...x, nome: e.target.value } : x))}
                            placeholder="Nome do bônus (ex: Super bônus meta 100%)"
                            className="flex-1 bg-white border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400" />
                          <button onClick={() => setBonusArr(p => p.filter(x => x._id !== b._id))}
                            className="text-slate-300 hover:text-red-400 text-lg leading-none">×</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Tipo</label>
                            <select value={b.tipo} onChange={e => setBonusArr(p => p.map(x => x._id === b._id ? { ...x, tipo: e.target.value } : x))}
                              className="w-full bg-white border border-purple-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-purple-400">
                              <option value="fixo">R$ Fixo</option>
                              <option value="percentual">% sobre comissão</option>
                              <option value="voucher">Voucher</option>
                              <option value="folga">Folga</option>
                              <option value="premio_fisico">Prêmio físico</option>
                              <option value="pontos">Pontos extras</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Valor</label>
                            <input type="number" step="0.01" value={b.valor}
                              onChange={e => setBonusArr(p => p.map(x => x._id === b._id ? { ...x, valor: parseFloat(e.target.value) || 0 } : x))}
                              className="w-full bg-white border border-purple-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-purple-400" />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-500 mb-1">Critério</label>
                            <select value={b.criterio} onChange={e => setBonusArr(p => p.map(x => x._id === b._id ? { ...x, criterio: e.target.value } : x))}
                              className="w-full bg-white border border-purple-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-purple-400">
                              {CRITERIOS_BONUS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB PARTICIPANTES ──────────────────────────────── */}
          {tab === 'participantes' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <button type="button" onClick={() => setTodosVendedores(!todosVendedores)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${todosVendedores ? 'bg-blue-500' : 'bg-slate-300'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${todosVendedores ? 'left-5' : 'left-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-medium text-slate-700">Incluir todos os vendedores ativos</p>
                  <p className="text-xs text-slate-400">Novos vendedores cadastrados serão incluídos automaticamente</p>
                </div>
              </div>

              {!todosVendedores && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">Selecione os vendedores que participarão deste plano:</p>
                    <button onClick={() => setPartSelecionados(new Set(vendedores.map(v => v.id)))}
                      className="text-xs text-blue-600 hover:text-blue-800">Selecionar todos</button>
                  </div>
                  {vendedores.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">Nenhum vendedor ativo cadastrado</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {vendedores.map(v => {
                        const sel = partSelecionados.has(v.id)
                        return (
                          <div key={v.id}
                            onClick={() => setPartSelecionados(prev => {
                              const n = new Set(prev)
                              sel ? n.delete(v.id) : n.add(v.id)
                              return n
                            })}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${sel ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}>
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                              {sel && <span className="text-white text-xs font-bold">✓</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${sel ? 'text-blue-800' : 'text-slate-700'}`}>{v.nome}</p>
                              {v.apelido && <p className="text-xs text-slate-400">{v.apelido}</p>}
                            </div>
                            {v.codigo && (
                              <span className="text-xs text-slate-400 font-mono">{v.codigo}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {partSelecionados.size > 0 && (
                    <p className="text-xs text-blue-600 text-center font-medium">
                      {partSelecionados.size} vendedor{partSelecionados.size !== 1 ? 'es' : ''} selecionado{partSelecionados.size !== 1 ? 's' : ''}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Rodapé */}
        {erro && (
          <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{erro}</div>
        )}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 flex-shrink-0">
          <button onClick={onFechar}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors">
            {salvando ? 'Salvando…' : isNovo ? 'Criar Plano' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </div>
  )
}
