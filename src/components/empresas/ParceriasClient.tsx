'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Parceria = {
  id: string; status: string; createdAt: string
  empresaParceiraId: string; empresaParceiraNome: string
}
type EmpresaOpcao = { id: string; nome: string }

export default function ParceriasClient({ empresaId, empresasDisponiveis }: {
  empresaId: string
  empresasDisponiveis: EmpresaOpcao[]
}) {
  const [parcerias, setParcerias] = useState<Parceria[]>([])
  const [carregando, setCarregando] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [criando, setCriando] = useState(false)
  const [empresaEscolhida, setEmpresaEscolhida] = useState('')
  const [salvando, setSalvando] = useState(false)

  function avisar(msg: string) { setMensagem(msg); setTimeout(() => setMensagem(''), 4000) }

  async function carregar() {
    setCarregando(true)
    const res = await fetch('/api/empresas/parcerias')
    const data = await res.json()
    setCarregando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao carregar parcerias'); return }
    setParcerias(data.parcerias)
  }

  useEffect(() => { carregar() }, [])

  async function criarParceria() {
    if (!empresaEscolhida) return
    setSalvando(true)
    const res = await fetch('/api/empresas/parcerias', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresaParceiraId: empresaEscolhida }),
    })
    const data = await res.json()
    setSalvando(false)
    if (!data.ok) { avisar(data.erro ?? 'Erro ao criar parceria'); return }
    setCriando(false); setEmpresaEscolhida('')
    avisar('Parceria criada com sucesso.')
    await carregar()
  }

  async function alternarStatus(p: Parceria) {
    const novoStatus = p.status === 'ativa' ? 'inativa' : 'ativa'
    const res = await fetch(`/api/empresas/parcerias/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: novoStatus }),
    })
    const data = await res.json()
    if (!data.ok) { avisar(data.erro ?? 'Erro ao atualizar parceria'); return }
    setParcerias(prev => prev.map(x => x.id === p.id ? { ...x, status: novoStatus } : x))
  }

  const empresasSemParceria = empresasDisponiveis.filter(e => !parcerias.some(p => p.empresaParceiraId === e.id))

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Parcerias entre Empresas</h1>
          <p className="text-sm text-gray-500">Compartilhe o cadastro de produtos com outra empresa do seu grupo — editar num lado propaga pro outro. Estoque continua sempre separado.</p>
        </div>
        {!criando && empresasSemParceria.length > 0 && (
          <button onClick={() => setCriando(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
            + Nova parceria
          </button>
        )}
      </div>

      {mensagem && <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg">{mensagem}</div>}

      {criando && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-medium text-gray-700">Criar parceria com:</p>
          <select value={empresaEscolhida} onChange={e => setEmpresaEscolhida(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white">
            <option value="">Selecione uma empresa do seu grupo...</option>
            {empresasSemParceria.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setCriando(false); setEmpresaEscolhida('') }} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={criarParceria} disabled={!empresaEscolhida || salvando}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {salvando ? 'Criando...' : 'Criar parceria'}
            </button>
          </div>
        </div>
      )}

      {empresasDisponiveis.length === 0 && (
        <p className="text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-xl p-5">
          Não há outra empresa no seu grupo ainda — parcerias só podem ser criadas entre empresas do mesmo grupo/dono.
        </p>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {carregando ? (
          <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>
        ) : parcerias.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Nenhuma parceria criada ainda.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Empresa parceira</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {parcerias.map(p => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{p.empresaParceiraNome}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.status === 'ativa' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                      {p.status === 'ativa' ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    {p.status === 'ativa' && (
                      <Link href={`/dashboard/empresas/parcerias/${p.id}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        Vínculos de produto →
                      </Link>
                    )}
                    <button onClick={() => alternarStatus(p)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                      {p.status === 'ativa' ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
