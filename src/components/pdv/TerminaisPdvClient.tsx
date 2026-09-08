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
  usar_rotas_novas: boolean | null
  ultimo_heartbeat_em: string | null
  saude?: {
    presenca: 'online' | 'offline' | 'nunca_bateu'
    autenticado: boolean
    validacaoPendente: boolean
    rotulo: string
    versao_situacao: string
  }
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

type Operacao = {
  id: string
  terminal_id: string
  operacao: string
  status: 'em_andamento' | 'sucesso' | 'erro'
  erro: string | null
  versao_pdv: string | null
  criado_em: string
  concluido_em: string | null
}

function quando(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

export default function TerminaisPdvClient() {
  const [terminais, setTerminais] = useState<Terminal[]>([])
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  const [segredoOk, setSegredoOk] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState('')
  const [novoCodigo, setNovoCodigo] = useState<{ codigo: string; nome: string; minutos: number } | null>(null)

  async function carregar() {
    const d = await fetch('/api/pdv/terminais').then(r => r.json()).catch(() => null)
    if (d?.ok) aplicar(d)
    setCarregando(false)
  }

  function aplicar(d: { terminais: Terminal[]; operacoes?: Operacao[]; segredo_configurado?: boolean }) {
    setTerminais(d.terminais)
    setOperacoes(d.operacoes ?? [])
    setSegredoOk(d.segredo_configurado !== false)
  }

  // A carga inicial fica dentro do efeito, e nao numa funcao chamada por ele:
  // o `set` acontece depois do await, e nao de forma sincrona na montagem.
  useEffect(() => {
    let vivo = true
    fetch('/api/pdv/terminais')
      .then(r => r.json())
      .then(d => { if (!vivo) return; if (d?.ok) aplicar(d); setCarregando(false) })
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

  async function alternarRota(t: Terminal) {
    const ligar = !t.usar_rotas_novas
    if (ligar && !confirmar(t)) return
    const d = await fetch('/api/pdv/terminais', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminal_id: t.id, usar_rotas_novas: ligar }),
    }).then(r => r.json())
    if (!d.ok) { setErro(d.erro ?? 'Falha ao mudar a rota'); return }
    carregar()
  }

  function confirmar(t: Terminal) {
    return window.confirm(
      `Ligar a rota nova em "${t.nome}"?\n\n` +
      'A partir daqui, a publicação da URL de impressão deste terminal passa pelo ' +
      'servidor, autenticada. Nenhuma venda muda. Desligar volta ao caminho antigo ' +
      'na hora, sem precisar de nova versão do PDV.'
    )
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
      {/* Sem o segredo de assinatura no ambiente, a ativação falha. Melhor
          descobrir aqui do que no balcão, com o código já na mão. */}
      {!segredoOk && (
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-900">
            O servidor ainda não tem o segredo de assinatura configurado
          </p>
          <p className="text-xs text-red-800 mt-1">
            Enquanto <code className="font-mono">PDV_TOKEN_SECRET</code> não existir no
            ambiente, ativar um terminal vai falhar. Nada mais é afetado — os PDVs
            continuam vendendo pelo caminho de sempre.
          </p>
        </div>
      )}

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
        <strong>Vendas, estoque e dinheiro ainda saem pelo caminho antigo</strong> — em
        todos os terminais, inclusive nos ativados. A única operação que já passa pelo
        servidor autenticado é a publicação da URL de impressão, e só nos terminais com
        a rota nova ligada.
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
                {['Terminal', 'Status', 'Presença', 'Rota nova', 'Versão', 'Última autenticação', ''].map(h => (
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
                    {/* Presença é pergunta SEPARADA de ativação e de
                        autenticação. Um terminal pode estar online e ainda
                        não ter provado que autentica depois de reiniciar —
                        juntar as três num "status" só foi exatamente o que
                        deixou a 0.6A cega por quatro rodadas. */}
                    <td className="px-4 py-3">
                      <span className={`text-xs ${
                        t.saude?.presenca === 'online' ? 'text-emerald-700 font-medium'
                        : t.saude?.presenca === 'offline' ? 'text-amber-700'
                        : 'text-gray-400'
                      }`}>
                        {t.saude?.rotulo ?? '—'}
                      </span>
                      {t.saude?.validacaoPendente && (
                        <p className="text-[10px] text-amber-700 mt-0.5">validação pós-reinício pendente</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {t.status !== 'ativo' ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <button onClick={() => alternarRota(t)}
                          className={`text-xs px-2 py-1 rounded border font-medium ${
                            t.usar_rotas_novas
                              ? 'bg-blue-50 text-blue-700 border-blue-300'
                              : 'bg-gray-50 text-gray-500 border-gray-300'
                          }`}>
                          {t.usar_rotas_novas ? 'ligada' : 'desligada'}
                        </button>
                      )}
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

      {/* O que a rota protegida DE FATO registrou. Cada linha aqui é uma
          requisição que passou por token, teve a empresa decidida pelo
          servidor e foi gravada — não é estimativa, e não conta o legado. */}
      <div className="rounded-2xl border border-gray-200 p-5">
        <p className="text-sm font-medium text-gray-900 mb-1">Operações pela rota protegida</p>
        <p className="text-xs text-gray-500 mb-3">
          As 50 mais recentes. O caminho legado não aparece aqui porque não passa por
          este servidor — ele é contado nos logs do banco, pelo papel <code>anon</code>.
        </p>
        {operacoes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">
            Nenhuma ainda. Ligue a rota nova em um terminal e reinicie o servidor de
            impressão dele para ver a primeira.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {operacoes.map(o => {
              const t = terminais.find(x => x.id === o.terminal_id)
              const cor = o.status === 'sucesso' ? 'text-emerald-700'
                : o.status === 'erro' ? 'text-red-700' : 'text-amber-700'
              return (
                <div key={o.id} className="flex items-baseline gap-2 text-xs border-b border-gray-50 pb-1.5">
                  <span className={`font-medium ${cor} w-20 shrink-0`}>{o.status}</span>
                  <span className="font-mono text-gray-700 shrink-0">{o.operacao}</span>
                  <span className="text-gray-500 truncate">
                    {t?.nome ?? o.terminal_id.slice(0, 8)}
                    {o.versao_pdv ? ` · v${o.versao_pdv}` : ''}
                    {o.erro ? ` · ${o.erro}` : ''}
                  </span>
                  <span className="text-gray-400 ml-auto shrink-0">{quando(o.criado_em)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm font-medium text-gray-900 mb-2">O que isto muda hoje</p>
        <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-5 leading-relaxed">
          <li><strong>Nada no caixa.</strong> Terminal não autorizado continua vendendo exatamente como antes.</li>
          <li>Autorizar um terminal dá a ele identidade própria e credencial revogável.</li>
          <li>A empresa passa a ser decidida pelo servidor — hoje ela vem de um arquivo no computador do balcão, que pode ser editado.</li>
          <li>Com a <strong>rota nova ligada</strong>, só a publicação da URL de impressão passa a ir pelo servidor autenticado. Venda, estoque e dinheiro seguem pelo caminho antigo.</li>
          <li>Desligar a rota nova tem efeito na hora, sem nova versão do PDV — é o botão de recuo.</li>
          <li>Revogar não apaga o terminal: muda o status e descarta a credencial. Voltar exige nova autorização.</li>
        </ul>
      </div>
    </div>
  )
}
