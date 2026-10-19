'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CORES, SUGERIDAS, corValida, emOrdem, nomeCategoria, nomeRepetido, type Categoria, type CorCategoria } from '@/lib/clientes/categorias'

// Categorias de cliente (etiquetas). O RLS limita tudo à empresa; o banco
// confere que a categoria e o cliente são da mesma empresa.

const COR_NOVA: CorCategoria[] = ['azul', 'verde', 'laranja', 'roxo', 'rosa', 'amarelo', 'vermelho', 'cinza']

/** Categorias da empresa, com criar (uma ou as sugeridas). */
export function useCategorias(empresaId: string, inicial?: Categoria[]) {
  const [lista, setLista] = useState<Categoria[]>(inicial ?? [])
  const [carregada, setCarregada] = useState(Boolean(inicial))
  const buscar = useCallback(async () => {
    const { data } = await createClient().from('cliente_categorias').select('id, nome, cor').eq('empresa_id', empresaId)
    return emOrdem((data ?? []).map(c => ({ id: c.id, nome: c.nome, cor: corValida(c.cor) })))
  }, [empresaId])
  const recarregar = useCallback(async () => {
    if (!empresaId) return
    setLista(await buscar()); setCarregada(true)
  }, [empresaId, buscar])
  useEffect(() => {
    if (inicial || !empresaId) return
    let valido = true
    buscar().then(l => { if (valido) { setLista(l); setCarregada(true) } })
    return () => { valido = false }
  }, [inicial, empresaId, buscar])

  async function criar(nomeDigitado: string): Promise<Categoria | string> {
    const nome = nomeCategoria(nomeDigitado)
    if (!nome) return 'Digite o nome da categoria.'
    if (nomeRepetido(lista, nome)) return 'Já existe uma categoria com esse nome.'
    const cor = COR_NOVA[lista.length % COR_NOVA.length]
    const { data, error } = await createClient().from('cliente_categorias').insert({ empresa_id: empresaId, nome, cor }).select('id, nome, cor').single()
    if (error || !data) return 'Não foi possível criar a categoria.'
    const nova = { id: data.id, nome: data.nome, cor: corValida(data.cor) }
    setLista(l => emOrdem([...l, nova]))
    return nova
  }
  async function criarSugeridas(): Promise<string | null> {
    const faltam = SUGERIDAS.filter(s => !nomeRepetido(lista, s.nome))
    if (!faltam.length) return null
    const { error } = await createClient().from('cliente_categorias').insert(faltam.map(s => ({ empresa_id: empresaId, ...s })))
    await recarregar()
    return error ? 'Não foi possível criar todas as sugeridas.' : null
  }
  return { lista, carregada, recarregar, criar, criarSugeridas }
}

export function ChipCategoria({ c, pequeno = false }: { c: Categoria; pequeno?: boolean }) {
  return <span className={`inline-block border rounded-full whitespace-nowrap ${CORES[c.cor].chip} ${pequeno ? 'text-[10px] px-1.5 leading-4' : 'text-xs px-2 py-0.5'}`}>{c.nome}</span>
}

/**
 * Escolher as categorias do cliente: clique liga e desliga. `onMudar` recebe
 * a lista nova (quem chama decide se grava na hora ou ao salvar).
 */
export default function CategoriasCliente({ empresaId, selecionadas, onMudar, categorias, desabilitado = false }: {
  empresaId: string
  selecionadas: string[]
  onMudar: (ids: string[]) => void
  /** Lista já carregada pela página (senão carrega aqui). */
  categorias?: Categoria[]
  desabilitado?: boolean
}) {
  const { lista, carregada, criar, criarSugeridas } = useCategorias(empresaId, categorias)
  const [nova, setNova] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const marcadas = new Set(selecionadas)

  function alternar(id: string) {
    if (desabilitado) return
    onMudar(marcadas.has(id) ? selecionadas.filter(x => x !== id) : [...selecionadas, id])
  }
  async function confirmarNova() {
    if (nova === null) return
    setOcupado(true); setErro('')
    const r = await criar(nova)
    setOcupado(false)
    if (typeof r === 'string') { setErro(r); return }
    setNova(null)
    onMudar([...selecionadas, r.id])
  }
  async function sugeridas() {
    setOcupado(true); setErro('')
    const r = await criarSugeridas()
    setOcupado(false)
    if (r) setErro(r)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5 items-center">
        {lista.map(c => {
          const sim = marcadas.has(c.id)
          return (
            <button key={c.id} type="button" onClick={() => alternar(c.id)} disabled={desabilitado}
              title={sim ? 'Tirar esta categoria' : 'Marcar esta categoria'}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors disabled:cursor-default ${sim ? CORES[c.cor].chip : 'bg-white text-gray-500 border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-700'}`}>
              {sim ? '✓ ' : ''}{c.nome}
            </button>
          )
        })}
        {nova === null
          ? <button type="button" onClick={() => { setNova(''); setErro('') }} disabled={desabilitado}
              className="text-xs px-2.5 py-1 rounded-full text-blue-600 hover:bg-blue-50 disabled:opacity-50">+ Nova</button>
          : (
            <span className="inline-flex items-center gap-1">
              <input autoFocus value={nova} onChange={e => setNova(e.target.value)} maxLength={40} placeholder="Ex.: Eletricista"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNova() } else if (e.key === 'Escape') setNova(null) }}
                className="text-xs border border-gray-300 rounded-full px-2.5 py-1 w-36 focus:outline-none focus:border-blue-500" />
              <button type="button" onClick={confirmarNova} disabled={ocupado} className="text-xs px-2 py-1 rounded-full bg-blue-600 text-white disabled:opacity-50">Criar</button>
              <button type="button" onClick={() => setNova(null)} className="text-xs px-1 text-gray-500">✕</button>
            </span>
          )}
      </div>
      {carregada && lista.length === 0 && nova === null && (
        <p className="text-xs text-gray-500">
          Nenhuma categoria ainda.{' '}
          <button type="button" onClick={sugeridas} disabled={ocupado} className="text-blue-600 hover:underline disabled:opacity-50">
            Criar as sugeridas
          </button>{' '}
          <span className="text-gray-400">({SUGERIDAS.slice(0, 4).map(s => s.nome).join(', ')}…)</span>
        </p>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  )
}
