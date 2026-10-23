'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { botao } from '@/components/ui/botao'
import { MAX_COMPONENTES } from '@/lib/imagens/layoutKit'

// Cria a foto do kit juntando as fotos dos componentes (ver
// src/lib/imagens/montagemKit.ts). A prévia é refeita a cada mudança; nada
// é gravado até "Salvar como foto principal".

type Componente = { produto_id: string; nome: string; quantidade: number }
type Img = { id: string; produto_id: string; url: string; principal: boolean | null }

export default function ImagemDoKitModal({ kitId, componentes, onClose, onSalvo }: {
  kitId: string
  componentes: Componente[]
  onClose: () => void
  onSalvo: () => void
}) {
  const [imagens, setImagens] = useState<Img[] | null>(null)
  const [escolha, setEscolha] = useState<Record<string, string>>({})
  const [selo, setSelo] = useState(false)
  const [previa, setPrevia] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [avisos, setAvisos] = useState<string[]>([])
  const pedido = useRef(0)

  useEffect(() => {
    const ids = componentes.map(c => c.produto_id)
    createClient().from('produto_imagens').select('id, produto_id, url, principal')
      .in('produto_id', ids).order('ordem', { ascending: true })
      .then(({ data }) => {
        const lista = (data ?? []) as Img[]
        setImagens(lista)
        const inicial: Record<string, string> = {}
        for (const id of ids) {
          const doProduto = lista.filter(i => i.produto_id === id)
          const img = doProduto.find(i => i.principal) ?? doProduto[0]
          if (img) inicial[id] = img.id
        }
        setEscolha(inicial)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function corpo(salvar: boolean) {
    return JSON.stringify({
      kitId, selo, salvar,
      componentes: componentes.map(c => ({ produtoId: c.produto_id, quantidade: c.quantidade, imagemId: escolha[c.produto_id] ?? null })),
    })
  }

  function lerAvisos(r: { semFoto?: string[]; falharam?: string[] }) {
    const a: string[] = []
    if (r.semFoto?.length) a.push(`Sem foto, ficaram de fora: ${r.semFoto.join(', ')}.`)
    if (r.falharam?.length) a.push(`Não deu para baixar a foto de: ${r.falharam.join(', ')}.`)
    setAvisos(a)
  }

  // Prévia ao vivo: a cada troca de foto ou do selo. O contador descarta a
  // resposta de um pedido antigo que chegue depois de um mais novo.
  useEffect(() => {
    if (imagens === null) return
    const meu = ++pedido.current
    const t = setTimeout(async () => {
      setGerando(true); setErro('')
      const r = await fetch('/api/produtos/imagens/kit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo(false),
      }).then(r => r.json()).catch(() => ({ ok: false, erro: 'Falha de conexão.' }))
      if (meu !== pedido.current) return
      setGerando(false)
      lerAvisos(r)
      if (!r.ok) { setPrevia(null); setErro(r.erro ?? 'Não foi possível montar a imagem.'); return }
      setPrevia(r.previa)
    }, 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagens, escolha, selo])

  async function salvar() {
    setSalvando(true); setErro('')
    const r = await fetch('/api/produtos/imagens/kit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo(true),
    }).then(r => r.json()).catch(() => ({ ok: false, erro: 'Falha de conexão.' }))
    setSalvando(false)
    if (!r.ok) { setErro(r.erro ?? 'Não foi possível salvar.'); return }
    onSalvo()
  }

  const temQuantidade = componentes.some(c => c.quantidade > 1)

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Criar imagem do kit</h2>
            <p className="text-xs text-gray-500 mt-0.5">As fotos dos componentes juntas, com fundo branco.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-5 grid gap-5 md:grid-cols-[1fr_minmax(0,360px)]">
          <div className="space-y-4 min-w-0">
            {imagens === null && <p className="text-sm text-gray-400">Carregando fotos dos componentes...</p>}
            {imagens !== null && componentes.map(c => {
              const doProduto = imagens.filter(i => i.produto_id === c.produto_id)
              return (
                <div key={c.produto_id}>
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {c.quantidade > 1 && <span className="text-blue-700">{c.quantidade}× </span>}{c.nome}
                  </p>
                  {doProduto.length === 0 ? (
                    <p className="text-xs text-amber-700 mt-1">Sem foto — fica de fora da imagem.</p>
                  ) : (
                    <div className="flex gap-2 mt-1.5 overflow-x-auto pb-1">
                      {doProduto.map(img => (
                        <button key={img.id} onClick={() => setEscolha(prev => ({ ...prev, [c.produto_id]: img.id }))}
                          title="Usar esta foto"
                          className={`shrink-0 w-16 h-16 rounded-lg border-2 overflow-hidden bg-white ${escolha[c.produto_id] === img.id ? 'border-blue-600' : 'border-gray-200 hover:border-gray-400'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="" className="w-full h-full object-contain" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {componentes.length > MAX_COMPONENTES && (
              <p className="text-xs text-amber-700">Cabem até {MAX_COMPONENTES} fotos; os componentes seguintes ficam de fora.</p>
            )}

            {temQuantidade && (
              <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3 cursor-pointer">
                <input type="checkbox" checked={selo} onChange={e => setSelo(e.target.checked)} className="mt-0.5" />
                <span>
                  Mostrar a quantidade na foto (ex.: <b>2x</b>)
                  <span className="block text-xs text-gray-500 mt-0.5">O Mercado Livre não aceita texto na foto principal — deixe desligado se o kit vai para lá.</span>
                </span>
              </label>
            )}
          </div>

          <div className="space-y-3">
            <div className="relative aspect-square w-full border border-gray-200 rounded-xl bg-white overflow-hidden flex items-center justify-center">
              {previa
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={previa} alt="Prévia da imagem do kit" className={`w-full h-full object-contain ${gerando ? 'opacity-50' : ''}`} />
                : <p className="text-sm text-gray-400 px-6 text-center">{gerando ? 'Montando a prévia...' : 'A prévia aparece aqui.'}</p>}
              {gerando && previa && <span className="absolute w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
            </div>
            {avisos.map(a => <p key={a} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{a}</p>)}
            {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            <button onClick={salvar} disabled={!previa || gerando || salvando} className={`${botao('primario')} w-full justify-center`}>
              {salvando ? 'Salvando...' : 'Salvar como foto principal'}
            </button>
            <p className="text-xs text-gray-400 text-center">As outras fotos do kit continuam, uma posição abaixo.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
