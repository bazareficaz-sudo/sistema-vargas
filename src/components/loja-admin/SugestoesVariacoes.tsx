'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'
import type { SugestaoFamilia } from '@/lib/commerce/variacoes'
import AgruparVariacoesModal, { type FamiliaResumo } from './AgruparVariacoesModal'

// Grupos que o sistema encontrou no catálogo: produtos com o mesmo nome,
// diferindo só na cor ou na medida. Nada é criado sem a pessoa abrir o grupo,
// conferir o nome de cada opção e confirmar.

export default function SugestoesVariacoes({
  lojaId, sugestoes, totalSugestoes, familias,
}: {
  lojaId: string
  sugestoes: SugestaoFamilia[]
  totalSugestoes: number
  familias: FamiliaResumo[]
}) {
  const router = useRouter()
  const [aberta, setAberta] = useState<SugestaoFamilia | null>(null)
  // "Ignorar" vale só até recarregar a página: é para limpar a tela enquanto
  // se revisa, não uma decisão definitiva sobre o grupo.
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)

  const visiveis = sugestoes.filter(s => !ignoradas.has(s.chave))
  if (sugestoes.length === 0 && !aviso) return null

  return (
    <section>
      <h2 className="text-base font-bold text-gray-900">Sugestões de agrupamento</h2>
      <p className="mt-1 text-sm text-gray-600">
        Produtos da loja com nomes quase iguais, que só mudam na cor ou na medida.
        Abra cada grupo, confira o nome das opções e confirme — nada é criado sozinho.
        {totalSugestoes > sugestoes.length && ` Mostrando ${sugestoes.length} de ${totalSugestoes}; ao agrupar, aparecem os próximos.`}
      </p>

      {aviso && (
        <p role="status" className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{aviso}</p>
      )}

      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {visiveis.map(s => (
          <li key={s.chave} className="flex flex-col rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-gray-900">{s.nome || '(sem nome em comum)'}</p>
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                {s.itens.length} · {s.tipo === 'Medida' ? 'medidas' : 'cores'}
              </span>
            </div>
            <p className="mt-1.5 flex-1 text-xs leading-relaxed text-gray-500">
              {s.itens.slice(0, 8).map(i => i.rotulo || '—').join(' · ')}
              {s.itens.length > 8 && ` · +${s.itens.length - 8}`}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button onClick={() => setAberta(s)} className={botao('primario', 'sm')}>Revisar e agrupar</button>
              <button onClick={() => setIgnoradas(x => new Set(x).add(s.chave))} className={botao('sutil', 'sm')}>Agora não</button>
            </div>
          </li>
        ))}
      </ul>

      {visiveis.length === 0 && sugestoes.length > 0 && (
        <p className="mt-3 text-sm text-gray-500">Você dispensou todas as sugestões desta tela. Recarregue a página para vê-las de novo.</p>
      )}

      {aberta && (
        <AgruparVariacoesModal
          lojaId={lojaId}
          produtos={aberta.itens.map(i => ({ id: i.id, nome: i.nome, sku: null, temLinha: true, familiaId: null }))}
          familias={familias}
          tipoInicial={aberta.tipo}
          aoFechar={() => setAberta(null)}
          aoConcluir={msg => {
            setAberta(null)
            setAviso(msg)
            router.refresh()
          }}
        />
      )}
    </section>
  )
}
