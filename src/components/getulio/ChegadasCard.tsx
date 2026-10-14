'use client'

import { useEffect, useState } from 'react'

// Central da Betina › "Chegou na loja": o boletim de mercadoria nova e
// reposta que vai para o grupo dos vendedores logo depois de cada nota.

type Config = {
  ativo: boolean; grupo_id: string | null; grupo_nome: string | null
  incluir_reposicao: boolean; avisar_sem_preco: boolean; ativado_em: string | null
}
type Boletim = {
  id: string; rotulo: string | null; fornecedor: string | null
  novidades: number; voltaram: number; repostos: number; sem_preco: number
  status: string; texto: string | null; erro: string | null; enviado_em: string | null; created_at: string
}
type Grupo = { id: string; nome: string }

const STATUS: Record<string, { rotulo: string; cls: string }> = {
  enviado: { rotulo: 'enviado', cls: 'text-emerald-600' },
  erro: { rotulo: 'falhou', cls: 'text-red-600' },
  enviando: { rotulo: 'enviando…', cls: 'text-gray-500' },
  sem_grupo: { rotulo: 'só no PDV (sem grupo)', cls: 'text-amber-600' },
  sem_novidade: { rotulo: 'nada a avisar', cls: 'text-gray-400' },
}

const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function TextoWhatsapp({ texto }: { texto: string }) {
  return (
    <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-800">
      {texto.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((parte, i) =>
        parte.length > 2 && parte.startsWith('*') && parte.endsWith('*') ? <strong key={i}>{parte.slice(1, -1)}</strong>
          : parte.length > 2 && parte.startsWith('_') && parte.endsWith('_') ? <em key={i}>{parte.slice(1, -1)}</em>
            : <span key={i}>{parte}</span>)}
    </div>
  )
}

export default function ChegadasCard({ whatsappPronto }: { whatsappPronto: boolean }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [boletins, setBoletins] = useState<Boletim[]>([])
  const [grupos, setGrupos] = useState<Grupo[] | null>(null)
  const [ocupado, setOcupado] = useState<'' | 'salvar' | 'grupos' | 'teste' | string>('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/getulio/chegadas').then(r => r.json()).then(d => {
      if (!vivo || !d.ok) return
      setConfig(d.config); setBoletins(d.boletins ?? [])
    }).catch(() => {})
    return () => { vivo = false }
  }, [])

  async function post(corpo: unknown) {
    const r = await fetch('/api/getulio/chegadas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    return r.json()
  }

  async function salvar() {
    if (!config) return
    setOcupado('salvar'); setAviso(null)
    try {
      const d = await post({ ...config })
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha ao salvar' }); return }
      setConfig(d.config)
      setAviso({
        tipo: 'ok',
        texto: !d.config.ativo ? 'Salvo. O boletim está desligado.'
          : d.config.grupo_id ? `Ligado. Cada nota lançada vira um aviso no grupo ${d.config.grupo_nome ?? ''}.`
            : 'Ligado, mas sem grupo: o boletim aparece só no PDV ("Chegou hoje").',
      })
    } finally { setOcupado('') }
  }

  async function buscarGrupos() {
    setOcupado('grupos'); setAviso(null)
    try {
      const d = await fetch('/api/getulio/chegadas/grupos').then(r => r.json())
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Não foi possível listar os grupos' }); return }
      setGrupos(d.grupos)
      if (d.grupos.length === 0) setAviso({ tipo: 'erro', texto: 'Nenhum grupo encontrado. Crie o grupo dos vendedores no WhatsApp com o número da empresa e busque de novo.' })
    } finally { setOcupado('') }
  }

  async function testar() {
    setOcupado('teste'); setAviso(null)
    try {
      const d = await post({ acao: 'teste' })
      setAviso(d.ok ? { tipo: 'ok', texto: 'Mensagem de teste enviada ao grupo.' } : { tipo: 'erro', texto: d.erro ?? 'Falha no envio' })
    } finally { setOcupado('') }
  }

  async function reenviar(b: Boletim) {
    setOcupado(b.id); setAviso(null)
    try {
      const d = await post({ acao: 'reenviar', id: b.id })
      if (d.boletins) setBoletins(d.boletins)
      setAviso(d.ok ? { tipo: 'ok', texto: 'Boletim reenviado.' } : { tipo: 'erro', texto: d.erro ?? 'Falha no reenvio' })
    } finally { setOcupado('') }
  }

  if (!config) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">📦 Chegou na loja</h2>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={config.ativo} onChange={e => setConfig(c => c && ({ ...c, ativo: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
          Ligado
        </label>
      </div>
      <p className="text-[11px] text-gray-500 leading-snug">
        Logo depois de cada nota lançada (manual ou XML) e de cada transferência recebida de outra empresa do grupo,
        a Betina avisa no grupo dos vendedores o que chegou:
        novidades com preço e endereço, o que voltou ao estoque (e quantos clientes esperavam) e a reposição.
        O PDV mostra a mesma lista em &quot;Chegou hoje&quot;.
      </p>

      {!whatsappPronto && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          O WhatsApp da empresa ainda não está configurado. Sem ele, o boletim aparece só no PDV.
        </p>
      )}

      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Grupo dos vendedores</p>
        {config.grupo_id ? (
          <div className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5">
            <span className="text-sm text-gray-800 truncate">👥 {config.grupo_nome || config.grupo_id}</span>
            <button onClick={() => setConfig(c => c && ({ ...c, grupo_id: null, grupo_nome: null }))} className="text-xs text-gray-400 hover:text-red-600">trocar</button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button onClick={buscarGrupos} disabled={!!ocupado || !whatsappPronto}
              className="w-full py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
              {ocupado === 'grupos' ? 'Buscando…' : 'Buscar grupos do WhatsApp'}
            </button>
            {grupos && grupos.length > 0 && (
              <ul className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {grupos.map(g => (
                  <li key={g.id}>
                    <button onClick={() => setConfig(c => c && ({ ...c, grupo_id: g.id, grupo_nome: g.nome }))}
                      className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-emerald-50">👥 {g.nome}</button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-400 leading-snug">
              Crie um grupo no WhatsApp com o número da empresa e os vendedores. Um grupo é uma mensagem só, e evita que o WhatsApp bloqueie o número por envio em massa.
            </p>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={config.incluir_reposicao} onChange={e => setConfig(c => c && ({ ...c, incluir_reposicao: e.target.checked }))} className="w-4 h-4 mt-0.5 accent-emerald-600" />
        <span>Incluir reposição comum
          <span className="block text-[11px] text-gray-400 leading-snug">Itens que não estavam em falta, só pelo nome. Desligado, o aviso sai apenas quando há novidade ou item que voltou.</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={config.avisar_sem_preco} onChange={e => setConfig(c => c && ({ ...c, avisar_sem_preco: e.target.checked }))} className="w-4 h-4 mt-0.5 accent-emerald-600" />
        <span>Avisar quem administra quando chegar produto sem preço
          <span className="block text-[11px] text-gray-400 leading-snug">Produto sem preço de venda nunca vai para o grupo. O alerta vai para os números de &quot;Quem recebe&quot;.</span></span>
      </label>

      <div className="flex gap-2">
        <button onClick={salvar} disabled={!!ocupado}
          className="flex-1 py-2 text-sm font-medium rounded-lg bg-gray-900 hover:bg-black text-white disabled:opacity-50">
          {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
        </button>
        {config.grupo_id && (
          <button onClick={testar} disabled={!!ocupado} title="Manda uma mensagem de teste no grupo salvo"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
            {ocupado === 'teste' ? '…' : 'Testar'}
          </button>
        )}
      </div>

      {aviso && (
        <p className={`text-xs rounded-lg px-2.5 py-1.5 ${aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{aviso.texto}</p>
      )}

      {boletins.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Últimos boletins</p>
          <ul className="space-y-1">
            {boletins.map(b => {
              const st = STATUS[b.status] ?? { rotulo: b.status, cls: 'text-gray-500' }
              const resumo = [b.novidades && `${b.novidades} nov.`, b.voltaram && `${b.voltaram} voltou`, b.repostos && `${b.repostos} rep.`, b.sem_preco && `${b.sem_preco} sem preço`].filter(Boolean).join(' · ')
              return (
                <li key={b.id} className="text-xs">
                  <button onClick={() => setAberto(a => a === b.id ? null : b.id)} className="w-full text-left flex items-center justify-between gap-2 hover:bg-gray-50 rounded px-1 py-0.5">
                    <span className="text-gray-700 truncate">{dataHora(b.created_at)} · {b.rotulo ?? 'nota'}{resumo ? ` · ${resumo}` : ''}</span>
                    <span className={`shrink-0 ${st.cls}`}>{st.rotulo}</span>
                  </button>
                  {aberto === b.id && (
                    <div className="mt-1 bg-[#efeae2] rounded-lg p-2 space-y-1.5">
                      {b.texto
                        ? <div className="bg-white rounded-lg px-2.5 py-2"><TextoWhatsapp texto={b.texto} /></div>
                        : <p className="text-gray-500">Sem mensagem: nada para avisar aos vendedores nesta nota.</p>}
                      {b.erro && <p className="text-red-600">{b.erro}</p>}
                      {b.texto && config.grupo_id && b.status !== 'enviando' && (
                        <button onClick={() => reenviar(b)} disabled={!!ocupado} className="text-blue-700 hover:underline disabled:opacity-50">
                          {ocupado === b.id ? 'Enviando…' : b.status === 'enviado' ? 'Enviar de novo' : 'Enviar agora'}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
