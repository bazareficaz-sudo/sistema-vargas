'use client'

import { useState, useEffect } from 'react'

// Terminais de PDV — ferramenta administrativa, não módulo.
//
// Ela existe para responder três perguntas e permitir duas ações:
//   quais terminais estão autorizados nesta empresa
//   qual deles já usa a identidade nova, e qual ainda é legado
//   quando cada um apareceu pela última vez
//   autorizar um novo · revogar um existente

type Terminal = {
  id: string
  nome: string
  status: 'aguardando_ativacao' | 'ativo' | 'revogado'
  versao_pdv: string | null
  terminal_id_legado: string | null
  metodo_ultima_auth: string | null
  ativado_em: string | null
  ultima_autenticacao_em: string | null
  ultima_atividade_em: string | null
  revogado_em: string | null
  motivo_revogacao: string | null
  created_at: string
}

const ROTULO: Record<Terminal['status'], { txt: string; cls: string }> = {
  aguardando_ativacao: { txt: 'aguardando ativação', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  ativo:               { txt: 'ativo',               cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  revogado:            { txt: 'revogado',            cls: 'bg-gray-100 text-gray-500 border-gray-300' },
}

function quando(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

export default function TerminaisPdvClient() {
  const [terminais, setTerminais] = useState<Terminal[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState('')
  const [novoCodigo, setNovoCodigo] = useState<{ codigo: string; nome: string; minutos: number } | null>(null)

  async function carregar() {
    const d = await fetch('/api/pdv/terminais').then(r => r.json()).catch(() => null)
    if (d?.ok) setTerminais(d.terminais)
    setCarregando(false)
  }

  // A carga inicial fica dentro do efeito, e nao numa funcao chamada por ele:
  // o `set` acontece depois do await, e nao de forma sincrona na montagem.
  useEffect(() => {
    let vivo = true
    fetch('/api/pdv/terminais')
      .then(r => r.json())
      .then(d => { if (!vivo) return; if (d?.ok) setTerminais(d.terminais); setCarregando(false) })
      .catch(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  async function autorizar() {
    if (!nome.trim()) { setErro('Dê um nome ao terminal.'); return }
    setCriando(true); setErro('')
    try {
      const d = await fetch('/api/pdv/terminais', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim() }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Falha ao autorizar'); return }
      setNovoCodigo({ codigo: d.codigo, nome: d.terminal.nome, minutos: d.expira_em_minutos })
      setNome('')
      carregar()
    } finally {
      setCriando(false)
    }
  }

  async function revogar(t: Terminal) {
    const motivo = prompt(`Revogar "${t.nome}"?\n\nO terminal para de renovar o token e precisará de nova autorização para voltar.\n\nMotivo:`)
    if (!motivo?.trim()) return
    const d = await fetch(`/api/pdv/terminais/${t.id}/revogar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: motivo.trim() }),
    }).then(r => r.json())
    if (!d.ok) { setErro(d.erro ?? 'Falha ao revogar'); return }
    carregar()
  }

  const ativos = terminais.filter(t => t.status === 'ativo').length
  const esperando = terminais.filter(t => t.status === 'aguardando_ativacao').length

  if (carregando) return <p className="text-sm text-gray-400">Carregando...</p>

  return (
    <div className="max-w-4xl space-y-6">
      {/* O código aparece UMA vez. Guardá-lo em claro no banco seria guardar
          uma credencial; só o hash e o prefixo ficam lá. */}
      {novoCodigo && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5">
          <p className="text-sm font-medium text-emerald-900">
            Código de ativação de <strong>{novoCodigo.nome}</strong>
          </p>
          <p className="my-3 text-3xl font-black tracking-[0.2em] text-emerald-900 text-center font-mono">
            {novoCodigo.codigo}
          </p>
          <p className="text-xs text-emerald-800">
            Digite-o no PDV em até <strong>{novoCodigo.minutos} minutos</strong>. Ele aparece
            uma única vez — se fechar esta tela sem anotar, autorize o terminal de novo.
          </p>
          <button onClick={() => setNovoCodigo(null)}
            className="mt-3 text-xs text-emerald-700 underline">Já anotei, fechar</button>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-900 mb-1">Autorizar um terminal</p>
        <p className="text-xs text-gray-500 mb-3">
          Gera um código de ativação. O terminal se identifica com ele uma vez e passa a ter
          credencial própria — a empresa dele é decidida aqui, não no computador do balcão.
        </p>
        <div className="flex gap-2">
          <input value={nome} onChange={e => { setNome(e.target.value); setErro('') }}
            onKeyDown={e => { if (e.key === 'Enter') autorizar() }}
            placeholder="Ex.: Balcão 1"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          <button onClick={autorizar} disabled={criando || !nome.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
            {criando ? 'Gerando...' : 'Gerar código'}
          </button>
        </div>
        {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
      </div>

      {/* Telemetria do rollout — só o que é MEDIDO.

          Um contador de "ainda no modo legado" seria mentira aqui: o caminho
          antigo não passa por esta tabela, então ele mostraria zero enquanto
          todo mundo, sem exceção, ainda vende por ele. O que dá para contar
          honestamente são as linhas que existem e o status delas. */}
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          ['Autorizados', terminais.length, 'text-gray-900'],
          ['Com identidade própria', ativos, 'text-emerald-700'],
          ['Aguardando ativação', esperando, esperando > 0 ? 'text-amber-700' : 'text-gray-400'],
        ].map(([rot, n, cor]) => (
          <div key={String(rot)} className="rounded-xl border border-gray-200 py-3">
            <p className={`text-2xl font-bold ${cor}`}>{String(n)}</p>
            <p className="text-xs text-gray-500">{String(rot)}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <strong>Todas as vendas ainda saem pelo caminho antigo</strong> — inclusive as
        dos terminais já ativados. Esta tela mede identidade, não trânsito de dados.
        Mover as escritas para trás do token é a etapa seguinte, e ela só começa
        quando &ldquo;Aguardando ativação&rdquo; chegar a zero.
      </p>

      {terminais.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          Nenhum terminal autorizado ainda. Os PDVs continuam funcionando no modo antigo.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Terminal', 'Status', 'Versão', 'Última autenticação', ''].map(h => (
                  <th key={h} className="text-left font-bold text-gray-700 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {terminais.map(t => {
                const r = ROTULO[t.status]
                return (
                  <tr key={t.id} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{t.nome}</p>
                      {t.terminal_id_legado && (
                        <p className="text-xs text-gray-400">id antigo: {t.terminal_id_legado}</p>
                      )}
                      {t.revogado_em && (
                        <p className="text-xs text-gray-500 mt-1">
                          revogado {quando(t.revogado_em)} — {t.motivo_revogacao}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-medium ${r.cls}`}>
                        {r.txt}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{t.versao_pdv ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{quando(t.ultima_autenticacao_em)}</td>
                    <td className="px-4 py-3 text-right">
                      {t.status !== 'revogado' && (
                        <button onClick={() => revogar(t)}
                          className="text-xs text-red-600 hover:underline">revogar</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm font-medium text-gray-900 mb-2">O que isto muda hoje</p>
        <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-5 leading-relaxed">
          <li><strong>Nada no caixa.</strong> Terminal não autorizado continua vendendo exatamente como antes.</li>
          <li>Autorizar um terminal dá a ele identidade própria e credencial revogável.</li>
          <li>A empresa passa a ser decidida pelo servidor — hoje ela vem de um arquivo no computador do balcão, que pode ser editado.</li>
          <li>As vendas ainda seguem pelo caminho antigo. Trocar isso é a etapa seguinte.</li>
          <li>Revogar não apaga o terminal: muda o status e descarta a credencial. Voltar exige nova autorização.</li>
        </ul>
      </div>
    </div>
  )
}
