'use client'

import { useEffect, useState } from 'react'

// Estoque unificado entre empresas do grupo: liga, escolhe quem participa e,
// de cada participante, de qual depósito o saldo é contabilizado.

type Candidata = { id: string; nome: string }
type Deposito = { id: string; empresa_id: string; nome: string }
type Participante = { empresaId: string; depositoId: string | null }

export default function EstoqueUnificadoClient() {
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const [ativo, setAtivo] = useState(false)
  const [empresaId, setEmpresaId] = useState('')
  const [depositoProprioId, setDepositoProprioId] = useState<string | null>(null)
  const [candidatas, setCandidatas] = useState<Candidata[]>([])
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [participantes, setParticipantes] = useState<Participante[]>([])

  useEffect(() => {
    fetch('/api/estoque/unificacao').then(r => r.json()).then(d => {
      if (!d.ok) { setErro(d.erro ?? 'Erro ao carregar'); return }
      setAtivo(d.config.ativo)
      setEmpresaId(d.empresaId)
      setDepositoProprioId(d.config.depositoProprioId)
      setCandidatas(d.candidatas ?? [])
      setDepositos(d.depositos ?? [])
      setParticipantes((d.config.participantes ?? []).map((p: any) => ({ empresaId: p.empresaId, depositoId: p.depositoId })))
    }).catch(e => setErro(e.message)).finally(() => setCarregando(false))
  }, [])

  const depositosDe = (id: string) => depositos.filter(d => d.empresa_id === id)
  const participa = (id: string) => participantes.some(p => p.empresaId === id)

  function alternar(id: string, on: boolean) {
    setParticipantes(ps => on
      ? [...ps, { empresaId: id, depositoId: null }]
      : ps.filter(p => p.empresaId !== id))
  }
  function mudarDeposito(id: string, dep: string) {
    setParticipantes(ps => ps.map(p => p.empresaId === id ? { ...p, depositoId: dep || null } : p))
  }

  async function salvar() {
    setSalvando(true); setErro(''); setAviso('')
    try {
      const d = await fetch('/api/estoque/unificacao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo, depositoProprioId, participantes }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Erro ao salvar'); return }
      setAviso(ativo
        ? `Salvo. ${d.participantes} empresa(s) somando estoque com a sua.`
        : 'Salvo. A unificação está desligada — cada empresa volta a contar só o próprio estoque.')
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return <p className="text-sm text-gray-400">Carregando...</p>

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
            className="w-4 h-4 accent-blue-600 mt-0.5" />
          <span className="text-sm text-gray-900">
            <b>Somar o estoque das empresas do grupo</b>
            <span className="block text-xs text-gray-500 mt-1">
              O estoque enviado aos anúncios passa a ser a soma das empresas escolhidas abaixo, em vez de
              só o desta empresa.
            </span>
          </span>
        </label>

        {ativo && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Desta empresa, contabilizar o depósito
            </label>
            <select value={depositoProprioId ?? ''} onChange={e => setDepositoProprioId(e.target.value || null)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-blue-500 bg-white">
              <option value="">Todos os depósitos (estoque total)</option>
              {depositosDe(empresaId).map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
            </select>
          </div>
        )}
      </div>

      {ativo && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Empresas do grupo</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Marque quem entra na soma e escolha o depósito de cada uma.
            </p>
          </div>

          {candidatas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              Nenhuma outra empresa no grupo. A unificação só vale entre empresas do mesmo grupo.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {candidatas.map(c => {
                const on = participa(c.id)
                const p = participantes.find(x => x.empresaId === c.id)
                const deps = depositosDe(c.id)
                return (
                  <div key={c.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={on} onChange={e => alternar(c.id, e.target.checked)}
                        className="w-4 h-4 accent-blue-600" />
                      <span className="text-sm text-gray-900">{c.nome}</span>
                    </label>
                    {on && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">Depósito:</span>
                        <select value={p?.depositoId ?? ''} onChange={e => mudarDeposito(c.id, e.target.value)}
                          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-blue-500 bg-white min-w-[180px]">
                          <option value="">Todos os depósitos (estoque total)</option>
                          {deps.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                        </select>
                        {deps.length === 0 && (
                          <span className="text-[11px] text-amber-700">sem depósito cadastrado</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* O que a unificação NÃO faz precisa estar na tela, não só na cabeça de
          quem programou — senão vira surpresa no balcão. */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <p className="text-xs text-amber-900">
          <b>Onde este número vale:</b> no estoque enviado aos anúncios dos marketplaces.
        </p>
        <p className="text-xs text-amber-800 mt-1">
          O PDV continua vendendo do estoque da própria empresa. É de propósito: deixar o balcão vender o
          que está fisicamente na outra loja criaria promessa que a operação não cumpre.
        </p>
        <p className="text-xs text-amber-800 mt-1">
          A soma só acontece em produtos <b>vinculados</b> entre as empresas (Empresas → Parcerias). Produto
          sem vínculo continua contando só o estoque desta empresa. Kits ficam de fora — somar kit de duas
          empresas contaria o mesmo componente duas vezes.
        </p>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
      {aviso && <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{aviso}</p>}

      <button onClick={salvar} disabled={salvando}
        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
        {salvando ? 'Salvando...' : 'Salvar'}
      </button>
    </div>
  )
}
