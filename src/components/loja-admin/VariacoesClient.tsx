'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'
import { normalizarCor, TIPOS_OPCAO } from '@/lib/commerce/variacoes'
import { CampoCor } from './AgruparVariacoesModal'

type Item = {
  lojaProdutoId: string; nomeProduto: string; sku: string | null
  rotulo: string; cor: string; status: string; slug: string | null
}
type Familia = { id: string; nome: string; tipoOpcao: string; itens: Item[] }

export default function VariacoesClient({ lojaId, familias }: { lojaId: string; familias: Familia[] }) {
  if (familias.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
        <p className="font-medium text-gray-900">Nenhuma família de variações ainda</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
          Na aba <Link href="/dashboard/loja-online/produtos" className="font-medium text-blue-700 underline">Produtos</Link>,
          marque os itens que são opções uns dos outros (as cores de uma tinta, as medidas de uma conexão) e clique em
          “Agrupar como variações”.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Cada produto continua separado na listagem da loja. Na página de qualquer um deles, o cliente vê os outros como opções.
      </p>
      {familias.map(f => <CartaoFamilia key={f.id} lojaId={lojaId} familia={f} />)}
    </div>
  )
}

function CartaoFamilia({ lojaId, familia }: { lojaId: string; familia: Familia }) {
  const router = useRouter()
  const [nome, setNome] = useState(familia.nome)
  const [tipo, setTipo] = useState(familia.tipoOpcao)
  const [itens, setItens] = useState<Item[]>(familia.itens)
  // O que está salvo, para saber se há algo a salvar. Atualizado ao salvar —
  // o card não remonta no refresh, então a confirmação "Salvo." não some.
  const [base, setBase] = useState({ nome: familia.nome, tipo: familia.tipoOpcao, itens: familia.itens })
  const [removidos, setRemovidos] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const comCor = tipo === 'Cor'
  const sujo =
    nome !== base.nome || tipo !== base.tipo || removidos.length > 0 ||
    itens.some((it, i) => {
      const o = base.itens[i]
      return !o || o.lojaProdutoId !== it.lojaProdutoId || o.rotulo !== it.rotulo || o.cor !== it.cor
    })

  function mudar(i: number, campo: 'rotulo' | 'cor', valor: string) {
    setItens(s => s.map((x, k) => (k === i ? { ...x, [campo]: valor } : x)))
  }
  function mover(i: number, d: -1 | 1) {
    setItens(s => {
      const j = i + d
      if (j < 0 || j >= s.length) return s
      const c = [...s]; [c[i], c[j]] = [c[j], c[i]]
      return c
    })
  }
  function tirar(id: string) {
    setItens(s => s.filter(x => x.lojaProdutoId !== id))
    setRemovidos(s => [...s, id])
  }

  async function salvar() {
    setAviso(null)
    if (itens.some(i => !i.rotulo.trim())) return setAviso({ tipo: 'erro', texto: 'Preencha o nome de cada opção.' })
    if (itens.some(i => normalizarCor(i.cor) === undefined)) return setAviso({ tipo: 'erro', texto: 'Cor inválida. Use o formato #RRGGBB.' })

    setSalvando(true)
    try {
      const r = await fetch(`/api/loja-admin/familias/${familia.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lojaId, nome, tipoOpcao: tipo, remover: removidos,
          itens: itens.map((it, ordem) => ({
            lojaProdutoId: it.lojaProdutoId, rotulo: it.rotulo, cor: comCor ? it.cor : '', ordem,
          })),
        }),
      })
      const dados = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(dados.erro ?? 'Não foi possível salvar')
      setRemovidos([])
      setBase({ nome, tipo, itens })
      setAviso({
        tipo: 'ok',
        texto: dados.desfeita ? 'Salvo. A família ficou com menos de 2 produtos e foi desfeita.' : 'Salvo.',
      })
      router.refresh()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível salvar' })
    } finally {
      setSalvando(false)
    }
  }

  async function desfazer() {
    if (!window.confirm(`Desfazer a família "${familia.nome}"? Os produtos continuam na loja, só deixam de aparecer como opções uns dos outros.`)) return
    setSalvando(true)
    try {
      const r = await fetch(`/api/loja-admin/familias/${familia.id}?lojaId=${lojaId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Não foi possível desfazer')
      router.refresh()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível desfazer' })
      setSalvando(false)
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 p-3">
        <label className="block min-w-[220px] flex-1 text-sm">
          <span className="font-medium text-gray-700">Nome da família</span>
          <input
            value={nome} onChange={e => setNome(e.target.value)} maxLength={120}
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">As opções são</span>
          <select value={tipo} onChange={e => setTipo(e.target.value)} className="mt-1 h-10 rounded-lg border border-gray-300 px-2 text-sm">
            {[...new Set([...TIPOS_OPCAO, familia.tipoOpcao])].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <ul className="divide-y divide-gray-100">
        {itens.map((it, i) => (
          <li key={it.lojaProdutoId} className="flex flex-wrap items-center gap-2 p-3">
            <div className="flex flex-col">
              <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir" className="h-5 w-6 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30">▲</button>
              <button type="button" onClick={() => mover(i, 1)} disabled={i === itens.length - 1} aria-label="Descer" className="h-5 w-6 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30">▼</button>
            </div>

            <div className="min-w-[200px] flex-1">
              <input
                value={it.rotulo} onChange={e => mudar(i, 'rotulo', e.target.value)} maxLength={60}
                aria-label={`Nome da opção de ${it.nomeProduto}`}
                className="h-9 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
              />
              <p className="mt-1 truncate text-xs text-gray-500" title={it.nomeProduto}>
                {it.sku ? `Cód. ${it.sku} · ` : ''}{it.nomeProduto}
                {it.status !== 'publicado' && <span className="ml-1 text-amber-700">({it.status === 'pausado' ? 'pausado' : 'fora da loja'})</span>}
              </p>
            </div>

            {comCor && <CampoCor valor={it.cor} aoMudar={v => mudar(i, 'cor', v)} />}

            <button type="button" onClick={() => tirar(it.lojaProdutoId)} className={botao('sutil', 'sm')}>Tirar</button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 p-3">
        <button onClick={salvar} disabled={salvando || !sujo} className={botao('primario')}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={desfazer} disabled={salvando} className={botao('perigo')}>Desfazer família</button>
        {aviso && (
          <span role="status" className={`text-sm ${aviso.tipo === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{aviso.texto}</span>
        )}
      </div>
    </section>
  )
}
