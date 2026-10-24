'use client'

import { useMemo, useState } from 'react'
import { botao } from '@/components/ui/botao'
import {
  compararRotulos, normalizarCor, sugerirFamilia, TIPOS_OPCAO,
} from '@/lib/commerce/variacoes'

type Produto = { id: string; nome: string; sku: string | null; temLinha: boolean; familiaId: string | null }
export type FamiliaResumo = { id: string; nome: string; tipoOpcao: string }

type ItemForm = { produtoId: string; nome: string; rotulo: string; cor: string }

// Agrupar produtos já cadastrados como opções uns dos outros (cor, medida).
// Nada do produto muda — SKU, estoque e preço seguem como estão.

export default function AgruparVariacoesModal({
  lojaId, produtos, familias, aoFechar, aoConcluir,
}: {
  lojaId: string
  produtos: Produto[]
  familias: FamiliaResumo[]
  aoFechar: () => void
  aoConcluir: (mensagem: string) => void
}) {
  const sugestao = useMemo(() => sugerirFamilia(produtos.map(p => p.nome)), [produtos])

  // Se todos os produtos marcados já estão na mesma família, o caminho natural
  // é acrescentar a ela; senão, criar uma nova.
  const [destino, setDestino] = useState<string>('nova')
  const [nome, setNome] = useState(sugestao.nome)
  const [tipo, setTipo] = useState<string>('Cor')
  const [itens, setItens] = useState<ItemForm[]>(() =>
    produtos
      .map((p, i) => ({ produtoId: p.id, nome: p.nome, rotulo: sugestao.rotulos[i] ?? '', cor: '' }))
      .sort((a, b) => compararRotulos(a.rotulo, b.rotulo)),
  )
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const semLinha = produtos.filter(p => !p.temLinha)
  const jaEmFamilia = produtos.filter(p => p.familiaId)
  const comCor = tipo === 'Cor'

  function mudar(i: number, campo: 'rotulo' | 'cor', valor: string) {
    setItens(s => s.map((x, k) => (k === i ? { ...x, [campo]: valor } : x)))
  }

  async function salvar() {
    setErro(null)
    if (itens.some(i => !i.rotulo.trim())) return setErro('Preencha o nome da opção de cada produto.')
    if (itens.some(i => normalizarCor(i.cor) === undefined)) return setErro('Cor inválida. Use o formato #RRGGBB (ex.: #1e90ff).')
    if (destino === 'nova' && !nome.trim()) return setErro('Dê um nome para a família.')

    setSalvando(true)
    try {
      const r = await fetch('/api/loja-admin/familias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lojaId,
          ...(destino === 'nova' ? { nome, tipoOpcao: tipo } : { familiaId: destino }),
          itens: itens.map(i => ({ produtoId: i.produtoId, rotulo: i.rotulo, cor: comCor ? i.cor : '' })),
        }),
      })
      const dados = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(dados.erro ?? 'Não foi possível salvar')
      aoConcluir(destino === 'nova'
        ? `Família "${nome.trim()}" criada com ${itens.length} produtos.`
        : `${itens.length} ${itens.length === 1 ? 'produto adicionado' : 'produtos adicionados'} à família.`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar')
    } finally {
      setSalvando(false)
    }
  }

  const bloqueado = semLinha.length > 0 || jaEmFamilia.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Agrupar como variações">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <div className="border-b border-gray-200 p-4">
          <h2 className="text-base font-bold text-gray-900">Agrupar como variações</h2>
          <p className="mt-1 text-sm text-gray-600">
            Cada produto continua separado na listagem. Na página de qualquer um deles, o cliente
            vê os outros como opções (cores, medidas...).
          </p>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {semLinha.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {semLinha.length === 1 ? '1 produto ainda não está' : `${semLinha.length} produtos ainda não estão`} na
              loja ({semLinha.slice(0, 3).map(p => p.nome).join('; ')}{semLinha.length > 3 ? '…' : ''}).
              Publique ou salve como rascunho antes de agrupar.
            </p>
          )}
          {jaEmFamilia.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {jaEmFamilia.length === 1 ? '1 produto já faz' : `${jaEmFamilia.length} produtos já fazem`} parte
              de uma família. Tire-{jaEmFamilia.length === 1 ? 'o' : 'os'} dela na aba Variações antes de agrupar de novo.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Grupo</span>
              <select value={destino} onChange={e => setDestino(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm">
                <option value="nova">Criar uma família nova</option>
                {familias.map(f => <option key={f.id} value={f.id}>Acrescentar a: {f.nome}</option>)}
              </select>
            </label>

            {destino === 'nova' && (
              <label className="block text-sm">
                <span className="font-medium text-gray-700">As opções são…</span>
                <select value={tipo} onChange={e => setTipo(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm">
                  {TIPOS_OPCAO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
          </div>

          {destino === 'nova' && (
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Nome da família</span>
              <input
                value={nome}
                onChange={e => setNome(e.target.value)}
                maxLength={120}
                placeholder="Ex.: Tinta Coralar Desempenho 18L"
                className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700">
              Nome de cada opção <span className="font-normal text-gray-500">(sugerido pelo nome do produto — confira)</span>
            </p>
            <ul className="mt-2 space-y-2">
              {itens.map((it, i) => (
                <li key={it.produtoId} className="rounded-lg border border-gray-200 p-2.5">
                  <p className="truncate text-xs text-gray-500" title={it.nome}>{it.nome}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <input
                      value={it.rotulo}
                      onChange={e => mudar(i, 'rotulo', e.target.value)}
                      maxLength={60}
                      aria-label={`Nome da opção de ${it.nome}`}
                      placeholder="Ex.: Branco Neve"
                      className="h-9 min-w-[140px] flex-1 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
                    />
                    {comCor && destino === 'nova' && (
                      <CampoCor valor={it.cor} aoMudar={v => mudar(i, 'cor', v)} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {comCor && destino === 'nova' && (
              <p className="mt-2 text-xs text-gray-500">
                A cor é opcional: sem ela, a opção aparece como um botão com o nome.
              </p>
            )}
          </div>

          {erro && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 p-3">
          <button onClick={aoFechar} disabled={salvando} className={botao('secundario')}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || bloqueado} className={botao('primario')}>
            {salvando ? 'Salvando…' : 'Agrupar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Seletor de cor + campo de texto: o seletor nativo não aceita "vazio". */
export function CampoCor({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  const valida = normalizarCor(valor)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={valida ?? '#ffffff'}
        onChange={e => aoMudar(e.target.value)}
        aria-label="Escolher cor"
        className="h-9 w-9 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5"
      />
      <input
        value={valor}
        onChange={e => aoMudar(e.target.value)}
        placeholder="#RRGGBB"
        maxLength={7}
        aria-label="Código da cor"
        className={`h-9 w-24 rounded-lg border px-2 text-sm outline-none focus:border-blue-500 ${valida === undefined ? 'border-red-400' : 'border-gray-300'}`}
      />
    </div>
  )
}
