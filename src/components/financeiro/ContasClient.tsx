'use client'

import { useEffect, useState } from 'react'

// BANCOS, CONTAS E MAQUININHAS.
//
// No banco de dados são a mesma tabela dos caixas de balcão (`caixa`), que é
// o que o ledger referencia. Por isso esta tela mostra os quatro tipos, mas
// só cria dois: caixa de PDV nasce amarrado a um terminal, e tesouraria é
// única.
//
// O tipo separa 'banco' de 'adquirente' de propósito: em banco o dinheiro é
// meu e está disponível; em adquirente ele existe e ainda não chegou. Somar
// os dois faria o saldo total mentir sobre o que dá para gastar hoje.

type Conta = {
  id: string
  tipo: string
  nome: string
  ativo: boolean
  instituicao: string | null
  agencia: string | null
  conta: string | null
  chave_pix: string | null
  terminal_id: string | null
  usada_por: string[]
}

const TIPO_LABEL: Record<string, string> = {
  banco: 'Conta bancária',
  adquirente: 'Adquirente (maquininha)',
  pdv: 'Caixa de balcão',
  tesouraria: 'Tesouraria',
}

const TIPO_AJUDA: Record<string, string> = {
  banco: 'O dinheiro está disponível.',
  adquirente: 'O saldo é o que a maquininha ainda deve.',
  pdv: 'A gaveta de um terminal. Criada junto com o terminal.',
  tesouraria: 'O cofre da loja. Uma por empresa.',
}

export default function ContasClient() {
  const [contas, setContas] = useState<Conta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  async function carregar() {
    setCarregando(true)
    try {
      const r = await fetch('/api/financeiro/contas')
      const d = await r.json()
      if (!d.ok) throw new Error(d.erro ?? 'Não foi possível carregar.')
      setContas(d.contas)
    } catch (e: any) { setErro(e?.message ?? 'Erro ao carregar.') }
    finally { setCarregando(false) }
  }

  useEffect(() => { carregar() }, [])

  function avisar(m: string) { setOk(m); setErro(''); setTimeout(() => setOk(''), 4000) }

  if (carregando) return <p className="text-sm text-slate-400">Carregando as contas…</p>

  const grupos = ['banco', 'adquirente', 'tesouraria', 'pdv']

  return (
    <div className="space-y-6">
      <div>
        {criando
          ? <FormularioConta
              onSalvo={(m) => { avisar(m); setCriando(false); carregar() }}
              onErro={setErro}
              onCancelar={() => setCriando(false)} />
          : <button onClick={() => setCriando(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl">
              + Nova conta ou adquirente
            </button>}
      </div>

      {grupos.map(tipo => {
        const doTipo = contas.filter(c => c.tipo === tipo)
        if (doTipo.length === 0) return null
        return (
          <div key={tipo}>
            <h2 className="text-sm font-semibold text-slate-700">{TIPO_LABEL[tipo] ?? tipo}</h2>
            <p className="text-xs text-slate-400 mb-2">{TIPO_AJUDA[tipo]}</p>
            <div className="space-y-2">
              {doTipo.map(c => (
                <div key={c.id} className={`bg-white border rounded-xl p-4 ${
                  c.ativo ? 'border-slate-100' : 'border-slate-200 bg-slate-50'
                }`}>
                  {editando === c.id
                    ? <FormularioConta
                        conta={c}
                        onSalvo={(m) => { avisar(m); setEditando(null); carregar() }}
                        onErro={setErro}
                        onCancelar={() => setEditando(null)} />
                    : <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">
                            {c.nome}
                            {!c.ativo && (
                              <span className="ml-2 text-xs text-slate-500 bg-slate-200 rounded-full px-2 py-0.5">
                                desligada
                              </span>
                            )}
                          </p>
                          {(c.instituicao || c.agencia || c.conta) && (
                            <p className="text-sm text-slate-500 mt-0.5">
                              {[c.instituicao, c.agencia && `ag. ${c.agencia}`, c.conta && `c/c ${c.conta}`]
                                .filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {c.chave_pix && (
                            <p className="text-sm text-slate-500">pix: {c.chave_pix}</p>
                          )}
                          {c.usada_por.length > 0 && (
                            // O aviso que impede desligar a conta do pix sem
                            // perceber que o pix vai para lá.
                            <p className="text-xs text-slate-400 mt-1">
                              recebe: {c.usada_por.join(', ')}
                            </p>
                          )}
                        </div>
                        {(c.tipo === 'banco' || c.tipo === 'adquirente') && (
                          <button onClick={() => setEditando(c.id)}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex-shrink-0">
                            Alterar
                          </button>
                        )}
                      </div>}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {ok && <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg">{ok}</div>}
      {erro && <div className="fixed bottom-6 right-6 bg-red-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg max-w-md">{erro}</div>}
    </div>
  )
}

function FormularioConta({ conta, onSalvo, onErro, onCancelar }: {
  conta?: Conta
  onSalvo: (m: string) => void
  onErro: (e: string) => void
  onCancelar: () => void
}) {
  const novo = !conta
  const [tipo, setTipo] = useState(conta?.tipo ?? 'banco')
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [ativo, setAtivo] = useState(conta?.ativo ?? true)
  const [instituicao, setInstituicao] = useState(conta?.instituicao ?? '')
  const [agencia, setAgencia] = useState(conta?.agencia ?? '')
  const [cc, setCc] = useState(conta?.conta ?? '')
  const [pix, setPix] = useState(conta?.chave_pix ?? '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const r = await fetch('/api/financeiro/contas', {
        method: novo ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: conta?.id, tipo, nome, ativo,
          instituicao, agencia, conta: cc, chave_pix: pix,
        }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.erro)
      onSalvo(novo ? `${nome} cadastrada.` : `${nome} salva.`)
    } catch (e: any) { onErro(e?.message ?? 'Erro ao salvar.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {novo && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="banco">Conta bancária — o dinheiro está disponível</option>
              <option value="adquirente">Adquirente — o saldo é o que a maquininha deve</option>
            </select>
            {/* O tipo não muda depois: virá-lo reescreveria o significado do
                histórico, e saldo de maquininha passaria a contar como
                dinheiro em conta. */}
            <p className="text-xs text-slate-400 mt-1">Escolha com cuidado: o tipo não muda depois.</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Nome</label>
          <input value={nome} onChange={e => setNome(e.target.value)}
            placeholder="MP Ouro"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Instituição</label>
          <input value={instituicao} onChange={e => setInstituicao(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>

        {tipo === 'banco' && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Agência</label>
              <input value={agencia} onChange={e => setAgencia(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Conta</label>
              <input value={cc} onChange={e => setCc(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Chave pix</label>
              <input value={pix} onChange={e => setPix(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </>
        )}
      </div>

      {!novo && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} />
          Disponível para escolha
        </label>
      )}

      <div className="flex gap-2">
        <button onClick={salvar} disabled={salvando}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
          {salvando ? 'Salvando…' : novo ? 'Cadastrar' : 'Salvar'}
        </button>
        <button onClick={onCancelar}
          className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm">Cancelar</button>
      </div>
    </div>
  )
}
