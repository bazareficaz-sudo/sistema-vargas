'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { botao } from '@/components/ui/botao'

// Formulário genérico das abas de configuração.
//
// Existe para as abas Aparência, Domínio e Configurações não serem três
// cópias do mesmo código de "carregar, editar, salvar, avisar" — que é
// exatamente como surgem as divergências que este projeto já pagou (dez
// paddings diferentes para o mesmo botão, duas buscas de entrada que se
// afastaram).
//
// A validação de verdade está na rota, não aqui. O que a tela faz é reduzir
// o erro: `type=color`, `maxLength`, `inputMode`.

export type Campo = {
  nome: string
  rotulo: string
  tipo?: 'texto' | 'area' | 'cor' | 'bool' | 'select' | 'numero'
  ajuda?: string
  opcoes?: { valor: string; rotulo: string }[]
  max?: number
  placeholder?: string
  prefixo?: string
  sufixo?: string
}

export type Secao = { titulo: string; descricao?: string; campos: Campo[] }

export default function FormularioLoja({ lojaId, secoes, valores }: {
  lojaId: string
  secoes: Secao[]
  valores: Record<string, unknown>
}) {
  const router = useRouter()
  const [form, setForm] = useState<Record<string, unknown>>(valores)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  // Só o que mudou vai para a rota. Mandar o objeto inteiro faria um salvar
  // na aba Aparência reescrever campos da aba Estoque com o que estava na
  // tela quando ela carregou.
  const alterados = Object.keys(form).filter(k => form[k] !== valores[k])
  const sujo = alterados.length > 0

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  async function salvar() {
    if (!sujo) return
    setSalvando(true)
    setAviso(null)
    try {
      const campos = Object.fromEntries(alterados.map(k => [k, form[k]]))
      const r = await fetch('/api/loja-admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, campos }),
      })
      const dados = await r.json()
      if (!r.ok) throw new Error(dados.erro ?? 'Não foi possível salvar')
      setAviso({ tipo: 'ok', texto: 'Salvo. A vitrine já mostra a mudança.' })
      router.refresh()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível salvar' })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-5">
      {secoes.map(s => (
        <section key={s.titulo} className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900">{s.titulo}</h2>
            {s.descricao && <p className="mt-0.5 text-sm text-gray-500">{s.descricao}</p>}
          </div>

          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {s.campos.map(c => {
              const valor = form[c.nome]
              const id = `campo-${c.nome}`

              if (c.tipo === 'bool') {
                return (
                  <label key={c.nome} className="flex cursor-pointer items-start gap-3 sm:col-span-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked={!!valor}
                      onChange={e => set(c.nome, e.target.checked)}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{c.rotulo}</span>
                      {c.ajuda && <span className="block text-xs text-gray-500">{c.ajuda}</span>}
                    </span>
                  </label>
                )
              }

              return (
                <div key={c.nome} className={c.tipo === 'area' ? 'sm:col-span-2' : ''}>
                  <label htmlFor={id} className="block text-sm font-medium text-gray-700">{c.rotulo}</label>

                  {c.tipo === 'select' ? (
                    <select
                      id={id}
                      value={String(valor ?? '')}
                      onChange={e => set(c.nome, e.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
                    >
                      {c.opcoes?.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                    </select>
                  ) : c.tipo === 'area' ? (
                    <textarea
                      id={id}
                      value={String(valor ?? '')}
                      onChange={e => set(c.nome, e.target.value)}
                      maxLength={c.max}
                      rows={3}
                      placeholder={c.placeholder}
                      className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm outline-none focus:border-blue-500"
                    />
                  ) : c.tipo === 'cor' ? (
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id={id}
                        type="color"
                        value={String(valor ?? '#000000')}
                        onChange={e => set(c.nome, e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded border border-gray-300"
                      />
                      <input
                        value={String(valor ?? '')}
                        onChange={e => set(c.nome, e.target.value)}
                        className="h-10 w-28 rounded-lg border border-gray-300 px-2 font-mono text-sm"
                      />
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center">
                      {c.prefixo && (
                        <span className="rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-2 py-2 text-sm text-gray-500">
                          {c.prefixo}
                        </span>
                      )}
                      <input
                        id={id}
                        type={c.tipo === 'numero' ? 'number' : 'text'}
                        inputMode={c.tipo === 'numero' ? 'numeric' : undefined}
                        value={valor == null ? '' : String(valor)}
                        onChange={e => set(c.nome, c.tipo === 'numero'
                          ? (e.target.value === '' ? null : Number(e.target.value))
                          : e.target.value)}
                        maxLength={c.max}
                        placeholder={c.placeholder}
                        className={`h-10 w-full min-w-0 border border-gray-300 px-3 text-sm outline-none focus:border-blue-500 ${
                          c.prefixo ? '' : 'rounded-l-lg'} ${c.sufixo ? '' : 'rounded-r-lg'}`}
                      />
                      {c.sufixo && (
                        <span className="rounded-r-lg border border-l-0 border-gray-300 bg-gray-50 px-2 py-2 text-sm text-gray-500">
                          {c.sufixo}
                        </span>
                      )}
                    </div>
                  )}

                  {c.ajuda && <p className="mt-1 text-xs text-gray-500">{c.ajuda}</p>}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* Barra de salvar fixa no rodapé: em formulário longo no celular, o
          botão no fim da página só é alcançado depois de rolar tudo. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border">
        <button onClick={salvar} disabled={!sujo || salvando} className={botao('primario')}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        {sujo && !salvando && (
          <span className="text-sm text-gray-500">
            {alterados.length} {alterados.length === 1 ? 'alteração' : 'alterações'} não salvas
          </span>
        )}
        {aviso && (
          <span className={`text-sm ${aviso.tipo === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
            {aviso.texto}
          </span>
        )}
      </div>
    </div>
  )
}
