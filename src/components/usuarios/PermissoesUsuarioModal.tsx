'use client'

import { useState, useEffect } from 'react'
import { GRUPOS_PERMISSAO, PAPEIS, type PermissaoCodigo } from '@/lib/auth/permissoes'

export default function PermissoesUsuarioModal({ usuarioId, usuarioNome, onClose, onSalvo }: {
  usuarioId: string
  usuarioNome: string
  onClose: () => void
  onSalvo: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [papel, setPapel] = useState<string>('')
  const [padrao, setPadrao] = useState<Set<string>>(new Set())
  const [valores, setValores] = useState<Record<string, boolean>>({})

  useEffect(() => {
    ;(async () => {
      const res = await fetch(`/api/usuarios/${usuarioId}/permissoes`)
      const data = await res.json()
      if (!data.ok) { setErro(data.erro ?? 'Erro ao carregar permissões'); setCarregando(false); return }
      const base = new Set<string>(data.padraoDoPapel ?? [])
      setPapel(data.papel ?? '')
      setPadrao(base)
      // Valor efetivo = padrão do papel com as exceções já aplicadas.
      const efetivo: Record<string, boolean> = {}
      for (const g of GRUPOS_PERMISSAO) for (const i of g.itens) efetivo[i.codigo] = base.has(i.codigo)
      for (const [codigo, permitido] of Object.entries(data.excecoes ?? {})) efetivo[codigo] = permitido as boolean
      setValores(efetivo)
      setCarregando(false)
    })()
  }, [usuarioId])

  async function salvar() {
    setSalvando(true); setErro('')
    const res = await fetch(`/api/usuarios/${usuarioId}/permissoes`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissoes: valores }),
    })
    const data = await res.json()
    setSalvando(false)
    if (!data.ok) { setErro(data.erro ?? 'Erro ao salvar'); return }
    onSalvo()
  }

  const papelLabel = PAPEIS.find(p => p.valor === papel)?.label ?? papel
  const alteradas = Object.entries(valores).filter(([c, v]) => v !== padrao.has(c)).length

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !salvando && onClose()}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Permissões de {usuarioNome}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Papel: <strong>{papelLabel}</strong>. Desmarcar tira o acesso mesmo que o papel dê;
              marcar libera mesmo que o papel não dê.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {carregando ? (
          <p className="p-6 text-sm text-gray-400">Carregando...</p>
        ) : (
          <div className="p-5 space-y-5">
            {GRUPOS_PERMISSAO.map(g => (
              <div key={g.grupo}>
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">{g.grupo}</p>
                <div className="space-y-1.5">
                  {g.itens.map(item => {
                    const ligado = !!valores[item.codigo]
                    const ehPadrao = padrao.has(item.codigo)
                    const mudou = ligado !== ehPadrao
                    return (
                      <label key={item.codigo}
                        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${mudou ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={ligado}
                          onChange={e => setValores(v => ({ ...v, [item.codigo]: e.target.checked }))}
                          className="mt-0.5 w-4 h-4 accent-blue-600 flex-shrink-0" />
                        <span className="flex-1">
                          <span className="text-sm text-gray-900">{item.label}</span>
                          {mudou && (
                            <span className="ml-2 text-[11px] text-blue-700">
                              {ligado ? 'liberado (fora do papel)' : 'bloqueado (o papel dava)'}
                            </span>
                          )}
                          {item.ajuda && <span className="block text-xs text-gray-500 mt-0.5">{item.ajuda}</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-600">
                Isso vale no sistema web <strong>e no aplicativo do celular</strong> — os dois leem a mesma
                configuração. A verificação também acontece no servidor, então bloquear aqui não é só esconder
                o botão da tela.
              </p>
            </div>

            {erro && <p className="text-sm text-red-600">{erro}</p>}

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {alteradas === 0 ? 'Nenhuma exceção — vale o padrão do papel.' : `${alteradas} exceção(ões) em relação ao papel.`}
              </span>
              <div className="flex gap-2">
                <button onClick={onClose} disabled={salvando}
                  className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
                <button onClick={salvar} disabled={salvando}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  {salvando ? 'Salvando...' : 'Salvar permissões'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
