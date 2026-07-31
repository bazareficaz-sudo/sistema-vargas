'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { NIVEIS, descreverObjetivo, type NivelRegra } from '@/lib/precificacao/regras'

// CRUD das regras. A ordem da lista é a ordem em que elas disputam: produto
// primeiro, regra geral por último — a mesma hierarquia que o motor aplica.

const inputCls = 'border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-500'

const OBJETIVOS = [
  { valor: 'margem_liquida', label: 'Margem líquida (%)' },
  { valor: 'sobre_custo', label: 'Lucro sobre o custo (%)' },
  { valor: 'markup', label: 'Markup (×)' },
  { valor: 'lucro_fixo', label: 'Lucro fixo (R$)' },
]

const CORES_NIVEL: Record<string, string> = {
  produto: 'bg-purple-50 text-purple-700 border-purple-200',
  categoria: 'bg-blue-50 text-blue-700 border-blue-200',
  marca: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  canal: 'bg-amber-50 text-amber-700 border-amber-200',
  plataforma: 'bg-orange-50 text-orange-700 border-orange-200',
  empresa: 'bg-gray-100 text-gray-600 border-gray-200',
}

const ORDEM_NIVEL: NivelRegra[] = ['produto', 'categoria', 'marca', 'canal', 'plataforma', 'empresa']

export default function RegrasPrecificacao({ empresaId }: { empresaId: string }) {
  const [dados, setDados] = useState<any | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState<any | null>(null)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    const d = await fetch('/api/precificacao/regras').then(r => r.json())
    if (d.ok) setDados(d); else setErro(d.erro ?? 'Erro ao carregar regras')
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function excluir(id: string) {
    if (!confirm('Excluir esta regra? Os anúncios voltam a valer pela regra menos específica que se aplicar.')) return
    const d = await fetch('/api/precificacao/regras', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    }).then(r => r.json())
    if (!d.ok) { setErro(d.erro); return }
    carregar()
  }

  if (carregando) return <p className="text-sm text-gray-400">Carregando...</p>

  const regras = dados?.regras ?? []
  const porNivel = ORDEM_NIVEL.map(n => ({ nivel: n, itens: regras.filter((r: any) => r.nivel === n) })).filter(g => g.itens.length > 0)
  const temGeral = regras.some((r: any) => r.nivel === 'empresa' && r.ativo)

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4">
        <p className="text-sm text-gray-600">
          A regra mais específica vence: <strong>produto</strong> ganha de <strong>categoria</strong>, que ganha de{' '}
          <strong>marca</strong>, que ganha de <strong>canal</strong>, que ganha de <strong>marketplace</strong>,
          que ganha da <strong>regra geral</strong>. Qualquer regra pode ainda ser presa a um canal específico.
        </p>
        {!temGeral && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Você ainda não tem uma regra geral. Sem ela, produto que não se encaixar em nenhuma regra fica sem preço calculado.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={() => setEditando({ nivel: 'empresa', objetivo_tipo: 'margem_liquida', objetivo_valor: 20, arredondamento: 'nenhum', prioridade: 0 })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
          + Nova regra
        </button>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

      {regras.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">Nenhuma regra cadastrada ainda.</p>
      )}

      {porNivel.map(grupo => (
        <div key={grupo.nivel}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {NIVEIS.find(n => n.valor === grupo.nivel)?.label}
          </p>
          <div className="space-y-1.5">
            {grupo.itens.map((r: any) => {
              const canal = dados.canais.find((c: any) => c.id === r.canal_id)
              return (
                <div key={r.id} className={`bg-white border rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${r.ativo ? 'border-gray-200' : 'border-gray-200 opacity-50'}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${CORES_NIVEL[r.nivel]}`}>
                        {NIVEIS.find(n => n.valor === r.nivel)?.label}
                      </span>
                      <p className="text-sm font-medium text-gray-900 truncate">{r.nome}</p>
                      {!r.ativo && <span className="text-[11px] text-gray-400">inativa</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.alvo_texto && <>alvo: {r.alvo_texto} · </>}
                      {descreverObjetivo(r.objetivo_tipo, Number(r.objetivo_valor))}
                      {r.margem_minima != null && <> · nunca abaixo de {r.margem_minima}%</>}
                      {canal && <> · só no canal {canal.nome}</>}
                      {r.arredondamento !== 'nenhum' && <> · arredonda {r.arredondamento === 'cima_inteiro' ? 'p/ inteiro' : `terminando em ${r.arredondamento === 'terminar_90' ? ',90' : ',99'}`}</>}
                    </p>
                  </div>
                  <div className="flex gap-3 flex-shrink-0">
                    <button onClick={() => setEditando(r)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                    <button onClick={() => excluir(r.id)} className="text-xs text-red-500 hover:text-red-700">Excluir</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editando && (
        <FormRegra regra={editando} dados={dados} empresaId={empresaId}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function FormRegra({ regra: inicial, dados, empresaId, onFechar, onSalvo }: {
  regra: any; dados: any; empresaId: string; onFechar: () => void; onSalvo: () => void
}) {
  const [r, setR] = useState<any>({ ...inicial })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [buscaProd, setBuscaProd] = useState('')
  const [achados, setAchados] = useState<any[]>([])
  const [produtoNome, setProdutoNome] = useState('')

  function set(campo: string, valor: any) { setR((x: any) => ({ ...x, [campo]: valor })); setErro('') }

  // Nome do produto quando a regra já existe e é de nível produto.
  useEffect(() => {
    if (r.nivel !== 'produto' || !r.alvo_id || produtoNome) return
    createClient().from('produtos').select('nome').eq('id', r.alvo_id).maybeSingle()
      .then(({ data }) => { if (data) setProdutoNome(data.nome) })
  }, [r.nivel, r.alvo_id, produtoNome])

  useEffect(() => {
    if (r.nivel !== 'produto' || buscaProd.trim().length < 2) { setAchados([]); return }
    let ativo = true
    const t = setTimeout(async () => {
      const sb = createClient()
      let q = sb.from('produtos').select('id, nome, sku').eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(8)
      for (const p of buscaProd.trim().split(/\s+/).filter(x => x.length >= 2)) q = q.or(`nome.ilike.%${p}%,sku.ilike.%${p}%`)
      const { data } = await q
      if (ativo) setAchados(data ?? [])
    }, 300)
    return () => { ativo = false; clearTimeout(t) }
  }, [buscaProd, r.nivel, empresaId])

  async function salvar() {
    setSalvando(true); setErro('')
    const d = await fetch('/api/precificacao/regras', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regra: r }),
    }).then(x => x.json())
    setSalvando(false)
    if (!d.ok) { setErro(d.erro ?? 'Erro ao salvar'); return }
    onSalvo()
  }

  const nivelInfo = NIVEIS.find(n => n.valor === r.nivel)
  const plataformas = [...new Set((dados.canais ?? []).map((c: any) => c.plataforma))] as string[]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 sticky top-0 bg-white flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{r.id ? 'Editar regra' : 'Nova regra'}</h2>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome da regra</label>
            <input value={r.nome ?? ''} onChange={e => set('nome', e.target.value)}
              placeholder="Ex.: Ferramentas com 25% de margem" className={`${inputCls} w-full`} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Vale para</label>
            <div className="flex flex-wrap gap-1.5">
              {NIVEIS.map(n => (
                <button key={n.valor} onClick={() => { set('nivel', n.valor); set('alvo_id', null); set('alvo_texto', null) }}
                  className={`px-3 py-1.5 text-xs rounded-lg border ${r.nivel === n.valor ? 'border-blue-400 bg-blue-50 text-blue-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {n.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{nivelInfo?.ajuda}</p>
          </div>

          {r.nivel === 'produto' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Produto</label>
              {r.alvo_id ? (
                <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-900">{produtoNome || 'Produto selecionado'}</span>
                  <button onClick={() => { set('alvo_id', null); setProdutoNome('') }} className="text-xs text-gray-400 hover:text-gray-700">trocar</button>
                </div>
              ) : (
                <>
                  <input value={buscaProd} onChange={e => setBuscaProd(e.target.value)}
                    placeholder="Buscar por nome ou SKU..." className={`${inputCls} w-full`} />
                  {achados.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded-lg divide-y max-h-48 overflow-y-auto">
                      {achados.map(p => (
                        <button key={p.id} onClick={() => { set('alvo_id', p.id); setProdutoNome(p.nome); setAchados([]); setBuscaProd('') }}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50">
                          <p className="text-sm text-gray-900">{p.nome}</p>
                          {p.sku && <p className="text-xs text-gray-500">SKU {p.sku}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {r.nivel === 'categoria' && (
            <Seletor rotulo="Categoria" valor={r.alvo_texto} opcoes={dados.categorias} onChange={v => set('alvo_texto', v)} />
          )}
          {r.nivel === 'marca' && (
            <Seletor rotulo="Marca" valor={r.alvo_texto} opcoes={dados.marcas} onChange={v => set('alvo_texto', v)} />
          )}
          {r.nivel === 'plataforma' && (
            <Seletor rotulo="Marketplace" valor={r.alvo_texto} opcoes={plataformas} onChange={v => set('alvo_texto', v)} />
          )}
          {r.nivel === 'canal' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Canal</label>
              <select value={r.alvo_id ?? ''} onChange={e => set('alvo_id', e.target.value || null)} className={`${inputCls} w-full`}>
                <option value="">Escolha...</option>
                {dados.canais.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          )}

          {r.nivel !== 'canal' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Restringir a um canal (opcional)</label>
              <select value={r.canal_id ?? ''} onChange={e => set('canal_id', e.target.value || null)} className={`${inputCls} w-full`}>
                <option value="">Vale em todos os canais</option>
                {dados.canais.map((c: any) => <option key={c.id} value={c.id}>só no {c.nome}</option>)}
              </select>
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Quanto quero ganhar</label>
            <div className="flex gap-2">
              <select value={r.objetivo_tipo} onChange={e => set('objetivo_tipo', e.target.value)} className={`${inputCls} flex-1`}>
                {OBJETIVOS.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
              <input value={r.objetivo_valor ?? ''} onChange={e => set('objetivo_valor', e.target.value)}
                inputMode="decimal" className={`${inputCls} w-24`} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Margem mínima (opcional)</label>
            <div className="flex items-center gap-2">
              <input value={r.margem_minima ?? ''} onChange={e => set('margem_minima', e.target.value)}
                placeholder="sem piso" inputMode="decimal" className={`${inputCls} w-24`} />
              <span className="text-xs text-gray-400">
                % — se o objetivo acima der menos que isso, o preço sobe até respeitar o piso (e o sistema avisa).
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Arredondamento</label>
              <select value={r.arredondamento ?? 'nenhum'} onChange={e => set('arredondamento', e.target.value)} className={`${inputCls} w-full`}>
                <option value="nenhum">Sem arredondar</option>
                <option value="terminar_90">Terminar em ,90</option>
                <option value="terminar_99">Terminar em ,99</option>
                <option value="cima_inteiro">Inteiro para cima</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prioridade</label>
              <input value={r.prioridade ?? 0} onChange={e => set('prioridade', e.target.value)}
                inputMode="numeric" className={`${inputCls} w-full`} />
              <p className="text-[11px] text-gray-400 mt-0.5">Desempata entre regras do mesmo nível.</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={r.ativo !== false} onChange={e => set('ativo', e.target.checked)}
              className="w-4 h-4 accent-blue-600" />
            Regra ativa
          </label>

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onFechar} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar regra'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Seletor({ rotulo, valor, opcoes, onChange }: {
  rotulo: string; valor: string | null; opcoes: string[]; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{rotulo}</label>
      <select value={valor ?? ''} onChange={e => onChange(e.target.value)} className={`${inputCls} w-full`}>
        <option value="">Escolha...</option>
        {opcoes.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <p className="text-[11px] text-gray-400 mt-0.5">Lista montada a partir do que os seus produtos realmente usam.</p>
    </div>
  )
}
