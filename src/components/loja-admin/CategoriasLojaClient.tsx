'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

type Cat = {
  id: string; nome: string; slug: string; paiId: string | null
  ativo: boolean; destaque: boolean; ordem: number; produtos: number
}

export default function CategoriasLojaClient({ lojaId, categorias, semCategoria }: {
  lojaId: string; categorias: Cat[]; semCategoria: number
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [nome, setNome] = useState('')

  async function chamar(corpo: Record<string, unknown>, mensagem: string) {
    setOcupado(true)
    setAviso(null)
    try {
      const r = await fetch('/api/loja-admin/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, ...corpo }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.erro ?? 'falhou')
      setAviso(typeof d.criadas === 'number' ? `${d.criadas} categorias criadas.` : mensagem)
      setEditando(null)
      router.refresh()
    } catch (e) {
      setAviso(e instanceof Error ? `Não deu certo: ${e.message}` : 'Não deu certo.')
    } finally {
      setOcupado(false)
    }
  }

  const raizes = categorias.filter(c => !c.paiId)
  const filhosDe = (id: string) => categorias.filter(c => c.paiId === id)

  function Linha({ c, nivel }: { c: Cat; nivel: number }) {
    return (
      <>
        <tr className={c.ativo ? '' : 'opacity-50'}>
          <td className="p-3" style={{ paddingLeft: 12 + nivel * 20 }}>
            {editando === c.id ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') chamar({ acao: 'renomear', id: c.id, nome }, 'Renomeada.') }}
                  className="h-9 rounded-lg border border-gray-300 px-2 text-sm"
                />
                <button onClick={() => chamar({ acao: 'renomear', id: c.id, nome }, 'Renomeada.')}
                        disabled={ocupado} className={botao('primario', 'sm')}>Salvar</button>
                <button onClick={() => setEditando(null)} className={botao('sutil', 'sm')}>Cancelar</button>
              </div>
            ) : (
              <div>
                <span className="font-medium text-gray-900">{c.nome}</span>
                <span className="ml-2 font-mono text-xs text-gray-400">/{c.slug}</span>
              </div>
            )}
          </td>
          <td className="p-3 text-sm text-gray-600">{c.produtos}</td>
          <td className="p-3">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => { setEditando(c.id); setNome(c.nome) }}
                className={botao('sutil', 'sm')}
              >
                Renomear
              </button>
              <button
                onClick={() => chamar({ acao: 'alternar_ativo', id: c.id, valor: !c.ativo },
                                      c.ativo ? 'Escondida da vitrine.' : 'Visível na vitrine.')}
                disabled={ocupado}
                className={botao('sutil', 'sm')}
              >
                {c.ativo ? 'Esconder' : 'Mostrar'}
              </button>
            </div>
          </td>
        </tr>
        {filhosDe(c.id).map(f => <Linha key={f.id} c={f} nivel={nivel + 1} />)}
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Árvore da vitrine</h2>
        <p className="mt-1 text-sm text-gray-500">
          Independente da categoria do cadastro. Renomear aqui muda só a loja — o
          produto no ERP continua igual.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => chamar({ acao: 'semear' }, 'Categorias atualizadas.')}
            disabled={ocupado}
            className={botao('secundario')}
          >
            Gerar a partir do catálogo
          </button>
          <button
            onClick={() => chamar({ acao: 'reindexar' }, 'Produtos reclassificados.')}
            disabled={ocupado}
            className={botao('secundario')}
          >
            Reclassificar produtos
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          &quot;Gerar&quot; agrupa as grafias duplicadas do cadastro — MATERIAL HIDRÁULICO,
          Material Hidráulico e MATERIAL HIDRAULICO viram uma categoria só. Rodar
          de novo só acrescenta o que falta; não desfaz o que você renomeou.
        </p>
      </div>

      {aviso && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{aviso}</p>
      )}

      {semCategoria > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>{semCategoria}</strong> produtos publicados não caíram em nenhuma categoria
          — normalmente porque o cadastro está sem categoria. Eles aparecem na busca, mas
          não ao navegar.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="p-3">Categoria</th>
              <th className="p-3">Produtos</th>
              <th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {raizes.map(c => <Linha key={c.id} c={c} nivel={0} />)}
            {raizes.length === 0 && (
              <tr><td colSpan={3} className="p-8 text-center text-sm text-gray-500">
                Nenhuma categoria ainda. Use &quot;Gerar a partir do catálogo&quot;.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
