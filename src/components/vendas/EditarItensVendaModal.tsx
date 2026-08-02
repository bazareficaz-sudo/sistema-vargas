'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Correção de uma venda já fechada: trocar produto, mudar quantidade,
// tirar item, mexer no desconto.
//
// O caso que motivou: o cliente pediu um produto e o vendedor bateu outro.
// Até aqui a única saída era cancelar a venda e refazer.
//
// A tela mostra o efeito no estoque ANTES de salvar. Corrigir venda é mexer
// em número de estoque sem ter a mercadoria na mão — quem confirma precisa
// ver o que vai acontecer, não descobrir depois pelo inventário.

type ItemEdit = {
  chave: string
  produtoId: string | null
  produtoNome: string
  produtoSku: string | null
  quantidade: string
  precoUnitario: string
  desconto: string
  quantidadeOriginal: number
}

type ProdutoBusca = { id: string; nome: string; sku: string | null; preco_venda: number; estoque: number }

const brl = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Aceita "12,50" e "12.50" — no balcão se digita com vírgula.
function num(t: string): number {
  const s = (t ?? '').trim().replace(/\s/g, '')
  if (s === '') return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}

export default function EditarItensVendaModal({ venda, empresaId, onFechar, onSalvo }: {
  venda: { id: string; numero: string | number | null; total: number; nfce_status?: string | null; nfce_numero?: string | null }
  empresaId: string
  onFechar: () => void
  onSalvo: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [itens, setItens] = useState<ItemEdit[]>([])
  // Retrato de como a venda estava ao abrir — é contra ele que se calcula o
  // efeito no estoque, inclusive dos itens que o operador remover.
  const [originais, setOriginais] = useState<ItemEdit[]>([])
  const [descontoGeral, setDescontoGeral] = useState('0')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    (async () => {
      const sb = createClient()
      const { data } = await sb.from('venda_itens').select('*').eq('venda_id', venda.id).order('created_at')
      const linhas: ItemEdit[] = (data ?? []).map((i: any, idx: number) => ({
        chave: `${i.id ?? idx}`,
        produtoId: i.produto_id,
        produtoNome: i.produto_nome,
        produtoSku: i.produto_sku,
        quantidade: String(i.quantidade ?? 0),
        precoUnitario: String(i.preco_unitario ?? 0),
        desconto: String(i.desconto ?? 0),
        quantidadeOriginal: Number(i.quantidade ?? 0),
      }))
      setItens(linhas)
      setOriginais(linhas)
      setCarregando(false)
    })()
  }, [venda.id])

  useEffect(() => {
    if (busca.trim().length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      const sb = createClient()
      const termo = busca.trim()
      const { data } = await sb.from('produtos')
        .select('id, nome, sku, preco_venda, estoque')
        .eq('empresa_id', empresaId).eq('ativo', true)
        .or(`nome.ilike.%${termo}%,sku.ilike.%${termo}%,ean.ilike.%${termo}%`)
        .limit(12)
      setResultados(data ?? [])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [busca, empresaId])

  function alterar(chave: string, campo: keyof ItemEdit, valor: string) {
    setItens(prev => prev.map(i => i.chave === chave ? { ...i, [campo]: valor } : i))
  }
  function remover(chave: string) {
    setItens(prev => prev.filter(i => i.chave !== chave))
  }
  function adicionar(p: ProdutoBusca) {
    setItens(prev => [...prev, {
      chave: `novo-${p.id}-${prev.length}`,
      produtoId: p.id, produtoNome: p.nome, produtoSku: p.sku,
      quantidade: '1', precoUnitario: String(p.preco_venda ?? 0), desconto: '0',
      quantidadeOriginal: 0,
    }])
    setBusca(''); setResultados([])
  }

  const subtotal = itens.reduce((s, i) => s + num(i.precoUnitario) * num(i.quantidade), 0)
  const descItens = itens.reduce((s, i) => s + num(i.desconto), 0)
  const total = subtotal - descItens - num(descontoGeral)

  // Efeito no estoque: quantidade de agora menos a que a venda tinha, por
  // produto. Precisa partir da lista ORIGINAL, e não das linhas em tela —
  // item removido some da tela e é justamente o que devolve estoque.
  const efeitoEstoque = (() => {
    const antes = new Map<string, { nome: string; qtd: number }>()
    for (const i of originais) {
      if (!i.produtoId) continue
      const a = antes.get(i.produtoId) ?? { nome: i.produtoNome, qtd: 0 }
      a.qtd += i.quantidadeOriginal
      antes.set(i.produtoId, a)
    }
    const depois = new Map<string, { nome: string; qtd: number }>()
    for (const i of itens) {
      if (!i.produtoId) continue
      const a = depois.get(i.produtoId) ?? { nome: i.produtoNome, qtd: 0 }
      a.qtd += num(i.quantidade)
      depois.set(i.produtoId, a)
    }
    const ids = new Set([...antes.keys(), ...depois.keys()])
    return [...ids].map(id => ({
      id,
      nome: depois.get(id)?.nome ?? antes.get(id)?.nome ?? '',
      delta: (depois.get(id)?.qtd ?? 0) - (antes.get(id)?.qtd ?? 0),
    })).filter(e => Math.abs(e.delta) > 0.0001)
  })()

  const bloqueadoPorNota = venda.nfce_status === 'autorizada'

  async function salvar() {
    if (!motivo.trim()) { setErro('Informe o motivo da correção.'); return }
    if (itens.length === 0) { setErro('A venda precisa ter ao menos um item.'); return }
    if (total < 0) { setErro('O desconto passou do valor da venda.'); return }
    setSalvando(true); setErro('')
    try {
      const d = await fetch(`/api/vendas/${venda.id}/editar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivo: motivo.trim(),
          desconto: num(descontoGeral),
          itens: itens.map(i => ({
            produtoId: i.produtoId, produtoNome: i.produtoNome, produtoSku: i.produtoSku,
            quantidade: num(i.quantidade), precoUnitario: num(i.precoUnitario), desconto: num(i.desconto),
          })),
        }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível salvar'); return }
      onSalvo()
      onFechar()
    } catch {
      setErro('Falha de conexão')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-3xl my-8">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Corrigir venda {venda.numero ?? ''}</h2>
            <p className="text-xs text-gray-500">Trocar produto, mudar quantidade, tirar item ou ajustar desconto.</p>
          </div>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {bloqueadoPorNota && (
          <div className="m-5 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm font-medium text-red-800">Esta venda tem NFC-e autorizada (nº {venda.nfce_numero ?? '—'})</p>
            <p className="text-xs text-red-700 mt-1">
              O documento já foi transmitido à SEFAZ e entregue ao cliente. Alterar os itens aqui deixaria o
              sistema diferente da nota. Cancele a NFC-e primeiro, corrija a venda e emita de novo.
            </p>
          </div>
        )}

        {carregando ? (
          <p className="p-5 text-sm text-gray-400">Carregando itens...</p>
        ) : (
          <div className={`p-5 space-y-4 ${bloqueadoPorNota ? 'opacity-40 pointer-events-none' : ''}`}>
            {/* Itens */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Produto</th>
                    <th className="px-2 py-2 text-xs font-medium text-gray-600 w-20">Qtd</th>
                    <th className="px-2 py-2 text-xs font-medium text-gray-600 w-28">Unitário</th>
                    <th className="px-2 py-2 text-xs font-medium text-gray-600 w-24">Desc.</th>
                    <th className="px-2 py-2 text-xs font-medium text-gray-600 w-24 text-right">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {itens.map(i => (
                    <tr key={i.chave}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <p className="text-gray-900">{i.produtoNome}</p>
                          {/* Falta de NCM/CEST só aparece na hora de emitir a
                              nota. Daqui se resolve sem fechar a correção. */}
                          {i.produtoId && (
                            <a href={`/dashboard/produtos?editar=${i.produtoId}&abaProduto=fiscal`}
                              target="_blank" rel="noreferrer"
                              title="Abrir o cadastro deste produto na aba Fiscal (nova aba)"
                              className="text-[11px] text-blue-600 hover:underline whitespace-nowrap">
                              cadastro ↗
                            </a>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400">
                          {i.produtoSku ? `SKU ${i.produtoSku}` : 'sem SKU'}
                          {i.quantidadeOriginal > 0 && Number(i.quantidade) !== i.quantidadeOriginal &&
                            <span className="text-amber-700"> · era {i.quantidadeOriginal}</span>}
                          {i.quantidadeOriginal === 0 && <span className="text-blue-700"> · item novo</span>}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <input value={i.quantidade} onChange={e => alterar(i.chave, 'quantidade', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right" />
                      </td>
                      <td className="px-2 py-2">
                        <input value={i.precoUnitario} onChange={e => alterar(i.chave, 'precoUnitario', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right" />
                      </td>
                      <td className="px-2 py-2">
                        <input value={i.desconto} onChange={e => alterar(i.chave, 'desconto', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm text-right" />
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-gray-900">
                        {brl(num(i.precoUnitario) * num(i.quantidade) - num(i.desconto))}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => remover(i.chave)} title="Tirar da venda"
                          className="text-gray-300 hover:text-red-600">×</button>
                      </td>
                    </tr>
                  ))}
                  {itens.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-6 text-sm text-red-600">
                      A venda ficou sem itens — adicione ao menos um.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Adicionar produto */}
            <div>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Adicionar produto — busque por nome, SKU ou código de barras"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              {buscando && <p className="text-xs text-gray-400 mt-1">buscando...</p>}
              {resultados.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto">
                  {resultados.map(p => (
                    <button key={p.id} onClick={() => adicionar(p)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex justify-between gap-3">
                      <span className="text-sm text-gray-900 truncate">
                        {p.nome}
                        <span className="text-xs text-gray-400"> · {p.sku ?? 'sem SKU'} · estoque {p.estoque}</span>
                      </span>
                      <span className="text-sm font-mono text-gray-700">{brl(p.preco_venda)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Totais */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-mono">{brl(subtotal)}</span></div>
              {descItens > 0 && <div className="flex justify-between"><span className="text-gray-600">Descontos por item</span><span className="font-mono text-green-700">− {brl(descItens)}</span></div>}
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Desconto geral</span>
                <input value={descontoGeral} onChange={e => setDescontoGeral(e.target.value)}
                  className="w-28 border border-gray-300 rounded px-2 py-1 text-sm text-right" />
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5">
                <span className="font-medium text-gray-900">Total</span>
                <span className="font-mono font-semibold text-gray-900">{brl(total)}</span>
              </div>
              {Math.abs(total - Number(venda.total ?? 0)) > 0.005 && (
                <p className="text-xs text-amber-700">
                  Era {brl(Number(venda.total ?? 0))} — diferença de {brl(total - Number(venda.total ?? 0))}.
                </p>
              )}
            </div>

            {/* O que vai acontecer com o estoque */}
            {efeitoEstoque.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-medium text-blue-900 mb-1">O que muda no estoque ao salvar</p>
                <ul className="space-y-0.5">
                  {efeitoEstoque.map(e => (
                    <li key={e.id} className="text-xs text-blue-800">
                      {e.nome}:{' '}
                      {e.delta > 0
                        ? <span className="font-medium">saem {e.delta} do estoque</span>
                        : <span className="font-medium">voltam {Math.abs(e.delta)} para o estoque</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-blue-700 mt-1">
                  Itens retirados da venda também voltam ao estoque — o acerto é feito pela diferença real no servidor.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Motivo da correção *</label>
              <input value={motivo} onChange={e => setMotivo(e.target.value)}
                placeholder="Ex.: vendedor bateu o produto errado; cliente levou o modelo azul"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              <p className="text-[11px] text-gray-400 mt-1">
                Fica na observação da venda, no extrato de estoque e na auditoria.
              </p>
            </div>

            {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          </div>
        )}

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onFechar} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando || carregando || bloqueadoPorNota || !motivo.trim() || itens.length === 0}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            {salvando ? 'Salvando...' : 'Salvar correção'}
          </button>
        </div>
      </div>
    </div>
  )
}
