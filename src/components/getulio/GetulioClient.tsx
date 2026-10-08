'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { VIGIAS, ORDEM_GRAVIDADE, PRIORIDADE_VIGIA, type ConfigGetulio, type Destinatario, type Gravidade } from '@/lib/getulio/tipos'

// CENTRAL DO GETÚLIO — o que ele está vendo agora, o que já mandou e como
// ele trabalha (para quem, a que horas, o que vigiar).

type SinalTela = {
  id: string; vigia: string; gravidade: Gravidade; titulo: string; detalhe: string | null
  valor: number | null; link: string | null; detectado_em: string; atualizado_em: string
  avisado_em: string | null; dispensado_em: string | null
}
type MensagemTela = { id: string; tipo: string; texto: string; gerado_por: string; status: string; erro: string | null; created_at: string }
type ConversaTela = { id: string; numero: string; papel: 'dono' | 'getulio'; texto: string; consultas: string[]; erro: string | null; created_at: string }

const GRAV: Record<Gravidade, { rotulo: string; icone: string; cartao: string; chip: string }> = {
  urgente: { rotulo: 'Urgente', icone: '🔴', cartao: 'border-red-200 bg-red-50/60', chip: 'bg-red-100 text-red-700' },
  atencao: { rotulo: 'Atenção', icone: '🟡', cartao: 'border-amber-200 bg-amber-50/60', chip: 'bg-amber-100 text-amber-800' },
  oportunidade: { rotulo: 'Oportunidade', icone: '🟢', cartao: 'border-emerald-200 bg-emerald-50/60', chip: 'bg-emerald-100 text-emerald-700' },
  info: { rotulo: 'Para saber', icone: 'ℹ️', cartao: 'border-blue-200 bg-blue-50/50', chip: 'bg-blue-100 text-blue-700' },
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const dataHora = (s: string | null) => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

/** Texto do WhatsApp (*negrito*) para a prévia na tela. */
function TextoWhatsapp({ texto }: { texto: string }) {
  return (
    <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800">
      {texto.split(/(\*[^*\n]+\*)/g).map((parte, i) =>
        parte.startsWith('*') && parte.endsWith('*') && parte.length > 2
          ? <strong key={i}>{parte.slice(1, -1)}</strong>
          : <span key={i}>{parte}</span>)}
    </div>
  )
}

export default function GetulioClient({ configInicial, sinaisIniciais, mensagens, whatsappPronto, recebimentoConectado, conversas, enderecoRecebimento, ultimaMensagemRecebida }: {
  configInicial: ConfigGetulio & { existe: boolean }
  sinaisIniciais: SinalTela[]
  mensagens: MensagemTela[]
  whatsappPronto: boolean
  recebimentoConectado: boolean
  conversas: ConversaTela[]
  enderecoRecebimento: string | null
  ultimaMensagemRecebida: string | null
}) {
  const router = useRouter()
  const [config, setConfig] = useState(configInicial)
  const [sinais, setSinais] = useState(sinaisIniciais)
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>(
    configInicial.destinatarios?.length ? configInicial.destinatarios : [{ nome: '', numero: '' }])
  const [ocupado, setOcupado] = useState<'' | 'varrer' | 'previa' | 'enviar' | 'salvar' | 'conectar'>('')
  const [recebendo, setRecebendo] = useState(recebimentoConectado)
  const [copiado, setCopiado] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [previa, setPrevia] = useState<{ texto: string; geradoPor: string } | null>(null)
  const [mostrarDispensados, setMostrarDispensados] = useState(false)
  const [mensagemAberta, setMensagemAberta] = useState<string | null>(null)
  // Depois de "Olhar agora", o servidor manda a lista nova (router.refresh).
  useEffect(() => { setSinais(sinaisIniciais) }, [sinaisIniciais])
  useEffect(() => {
    setConfig(c => ({ ...c, ultima_varredura: configInicial.ultima_varredura }))
  }, [configInicial.ultima_varredura])

  const visiveis = useMemo(() => sinais
    .filter(s => mostrarDispensados || !s.dispensado_em)
    .sort((a, b) => ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade]
      || (PRIORIDADE_VIGIA[a.vigia] ?? 9) - (PRIORIDADE_VIGIA[b.vigia] ?? 9)
      || Number(b.valor ?? 0) - Number(a.valor ?? 0)),
  [sinais, mostrarDispensados])
  const contagem = (g: Gravidade) => sinais.filter(s => s.gravidade === g && !s.dispensado_em).length
  const dispensados = sinais.filter(s => s.dispensado_em).length

  async function chamar(rota: string, corpo?: unknown) {
    const r = await fetch(rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
    return r.json()
  }

  async function olharAgora() {
    setOcupado('varrer'); setAviso(null)
    try {
      const d = await chamar('/api/getulio/varrer')
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha na varredura' }); return }
      const falhas = d.erros?.length ? ` · ${d.erros.length} vigia(s) com erro: ${d.erros.map((e: any) => e.vigia).join(', ')}` : ''
      setAviso({ tipo: d.erros?.length ? 'erro' : 'ok', texto: `Varredura feita: ${d.abertos} assunto(s) em aberto, ${d.novos} novo(s), ${d.resolvidos} resolvido(s)${falhas}.` })
      router.refresh()
    } finally { setOcupado('') }
  }

  async function verPrevia() {
    setOcupado('previa'); setAviso(null)
    try {
      const d = await chamar('/api/getulio/previa')
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha ao montar a prévia' }); return }
      setPrevia({ texto: d.texto, geradoPor: d.geradoPor })
    } finally { setOcupado('') }
  }

  async function enviarAgora() {
    const nums = (config.destinatarios ?? []).map(d => d.nome || d.numero).join(', ')
    if (!confirm(`Enviar o resumo agora pelo WhatsApp para: ${nums}?`)) return
    setOcupado('enviar'); setAviso(null)
    try {
      const d = await chamar('/api/getulio/enviar')
      setAviso(d.ok
        ? { tipo: 'ok', texto: `Resumo enviado para ${d.enviados} número(s).${d.falhas?.length ? ` Falhou em: ${d.falhas.map((f: any) => f.numero).join(', ')}` : ''}` }
        : { tipo: 'erro', texto: d.erro ?? 'Falha ao enviar' })
      if (d.ok) router.refresh()
    } finally { setOcupado('') }
  }

  async function salvar(ativo = config.ativo) {
    setOcupado('salvar'); setAviso(null)
    try {
      const d = await chamar('/api/getulio/config', {
        ativo, horario_resumo: config.horario_resumo,
        destinatarios: destinatarios.filter(x => x.numero.trim()),
        vigias_desligados: config.vigias_desligados ?? [],
        responder_whatsapp: !!config.responder_whatsapp,
      })
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha ao salvar' }); return }
      setConfig(d.config)
      setDestinatarios(d.config.destinatarios?.length ? d.config.destinatarios : [{ nome: '', numero: '' }])
      setAviso({ tipo: 'ok', texto: d.config.ativo ? `Getúlio ligado. Resumo todo dia às ${d.config.horario_resumo}.` : 'Configuração salva. O Getúlio está desligado.' })
    } finally { setOcupado('') }
  }

  async function dispensar(s: SinalTela, acao: 'dispensar' | 'reativar') {
    const d = await chamar('/api/getulio/sinais', { id: s.id, acao })
    if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha' }); return }
    setSinais(prev => prev.map(x => x.id === s.id
      ? { ...x, dispensado_em: acao === 'dispensar' ? new Date().toISOString() : null, avisado_em: acao === 'reativar' ? null : x.avisado_em }
      : x))
  }

  async function conectarRecebimento() {
    if (!confirm('Isto cadastra o Sistema Vargas como o endereço que recebe as mensagens que chegam no WhatsApp da empresa (Z-API → "Ao receber").\n\nSe outro sistema ou robô de atendimento recebe as mensagens desse número hoje, ele deixa de receber.\n\nContinuar?')) return
    setOcupado('conectar'); setAviso(null)
    try {
      const d = await chamar('/api/getulio/conectar-whatsapp')
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha ao conectar' }); return }
      setRecebendo(true)
      setAviso({ tipo: 'ok', texto: 'Recebimento conectado. Ligue "Responder perguntas" e salve — depois mande uma pergunta para o número da empresa.' })
    } finally { setOcupado('') }
  }

  const alternarVigia = (id: string) => setConfig(c => ({
    ...c,
    vigias_desligados: (c.vigias_desligados ?? []).includes(id)
      ? c.vigias_desligados.filter(v => v !== id)
      : [...(c.vigias_desligados ?? []), id],
  }))

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 border border-amber-300 flex items-center justify-center text-3xl shadow-sm">🧔🏻</div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Getúlio</h1>
            <p className="text-sm text-gray-500">Olha o negócio todo dia e te chama no WhatsApp quando algo merece atenção.</p>
            <p className="text-xs mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${config.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {config.ativo ? `● Ligado · resumo às ${config.horario_resumo}` : '○ Desligado'}
              </span>
              <span className="text-gray-400 ml-2">última olhada: {dataHora(config.ultima_varredura)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={olharAgora} disabled={!!ocupado}
            className="px-3.5 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
            {ocupado === 'varrer' ? 'Olhando…' : '🔎 Olhar agora'}
          </button>
          <button onClick={verPrevia} disabled={!!ocupado}
            className="px-3.5 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">
            {ocupado === 'previa' ? 'Escrevendo…' : '👁 Prévia do resumo'}
          </button>
          <button onClick={enviarAgora} disabled={!!ocupado || !whatsappPronto || !(config.destinatarios ?? []).length}
            title={!whatsappPronto ? 'Configure o WhatsApp em Integrações' : !(config.destinatarios ?? []).length ? 'Cadastre um número abaixo' : ''}
            className="px-3.5 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {ocupado === 'enviar' ? 'Enviando…' : '📲 Enviar resumo agora'}
          </button>
        </div>
      </div>

      {!whatsappPronto && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3">
          O WhatsApp da empresa não está configurado — o Getúlio vê tudo aqui na Central, mas não consegue mandar mensagem.{' '}
          <Link href="/dashboard/integracoes/whatsapp" className="underline font-medium">Configurar o WhatsApp</Link>
        </div>
      )}
      {aviso && (
        <div className={`text-sm rounded-xl px-4 py-3 border ${aviso.tipo === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {aviso.texto}
        </div>
      )}

      {/* Prévia no formato do WhatsApp */}
      {previa && (
        <div className="rounded-2xl border border-gray-200 bg-[#efeae2] p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-600">Prévia — é assim que chegaria agora {previa.geradoPor === 'ia' ? '(escrito pelo Getúlio)' : '(modelo padrão)'}</p>
            <button onClick={() => setPrevia(null)} className="text-gray-500 hover:text-gray-700 text-sm">✕</button>
          </div>
          <div className="max-w-xl bg-white rounded-xl rounded-tl-none shadow-sm px-3.5 py-2.5">
            <TextoWhatsapp texto={previa.texto} />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Sinais */}
        <div className="lg:col-span-2 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['urgente', 'atencao', 'oportunidade', 'info'] as Gravidade[]).map(g => (
              <div key={g} className={`rounded-xl border px-3 py-2.5 ${GRAV[g].cartao}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{GRAV[g].icone} {GRAV[g].rotulo}</p>
                <p className="text-2xl font-bold text-gray-900">{contagem(g)}</p>
              </div>
            ))}
          </div>

          {visiveis.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500">
              {config.ultima_varredura
                ? 'Nada fora do normal agora. 👊'
                : 'O Getúlio ainda não olhou o negócio. Clique em "Olhar agora".'}
            </div>
          ) : visiveis.map(s => (
            <div key={s.id} className={`rounded-xl border bg-white px-4 py-3 ${s.dispensado_em ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    <span className="mr-1">{GRAV[s.gravidade].icone}</span>{s.titulo}
                    {!s.avisado_em && !s.dispensado_em && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 align-middle">novo</span>}
                  </p>
                  {s.detalhe && <p className="text-[13px] text-gray-600 mt-1">{s.detalhe}</p>}
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    desde {dataHora(s.detectado_em)}
                    {s.avisado_em && ` · avisado em ${dataHora(s.avisado_em)}`}
                    {s.dispensado_em && ' · você pediu para não avisar'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {s.valor != null && s.valor > 0 && <span className="text-xs font-semibold text-gray-700">{brl(Number(s.valor))}</span>}
                  {s.link && <Link href={s.link} className="text-xs font-medium text-blue-600 hover:underline">Resolver →</Link>}
                  <button onClick={() => dispensar(s, s.dispensado_em ? 'reativar' : 'dispensar')}
                    className="text-[11px] text-gray-400 hover:text-gray-700">
                    {s.dispensado_em ? 'Voltar a avisar' : 'Não me avise disto'}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {dispensados > 0 && (
            <button onClick={() => setMostrarDispensados(v => !v)} className="text-xs text-gray-500 hover:text-gray-700">
              {mostrarDispensados ? 'Esconder' : 'Mostrar'} {dispensados} assunto(s) que você pediu para não avisar
            </button>
          )}
        </div>

        {/* Configuração */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Como o Getúlio trabalha</h2>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={config.ativo} onChange={e => setConfig(c => ({ ...c, ativo: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
                Ligado
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Resumo diário às</label>
              <input type="time" value={config.horario_resumo} onChange={e => setConfig(c => ({ ...c, horario_resumo: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              <p className="text-[11px] text-gray-400 mt-1">Ele olha o negócio a cada hora; a mensagem sai uma vez por dia, neste horário.</p>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Quem recebe no WhatsApp</p>
              <div className="space-y-2">
                {destinatarios.map((d, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={d.nome} placeholder="Nome" onChange={e => setDestinatarios(l => l.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))}
                      className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                    <input value={d.numero} placeholder="55 DDD número" onChange={e => setDestinatarios(l => l.map((x, j) => j === i ? { ...x, numero: e.target.value } : x))}
                      className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                    {destinatarios.length > 1 && (
                      <button onClick={() => setDestinatarios(l => l.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 px-1">✕</button>
                    )}
                  </div>
                ))}
              </div>
              {destinatarios.length < 5 && (
                <button onClick={() => setDestinatarios(l => [...l, { nome: '', numero: '' }])} className="text-xs text-blue-600 hover:underline mt-1.5">+ outra pessoa</button>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">O que vigiar</p>
              <div className="space-y-1.5">
                {VIGIAS.map(v => (
                  <label key={v.id} className="flex items-start gap-2 text-sm cursor-pointer" title={v.ajuda}>
                    <input type="checkbox" checked={!(config.vigias_desligados ?? []).includes(v.id)} onChange={() => alternarVigia(v.id)}
                      className="w-4 h-4 mt-0.5 accent-emerald-600" />
                    <span>
                      <span className="text-gray-800">{v.nome}</span>
                      <span className="block text-[11px] text-gray-400 leading-snug">{v.ajuda}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button onClick={() => salvar()} disabled={!!ocupado}
              className="w-full py-2 text-sm font-medium rounded-lg bg-gray-900 hover:bg-black text-white disabled:opacity-50">
              {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
            </button>
          </div>

          {/* Conversa pelo WhatsApp */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Conversar pelo WhatsApp</h2>
            <p className="text-[11px] text-gray-500 leading-snug">
              Quem está em "Quem recebe" pode mandar perguntas para o número da empresa — "quanto vendi ontem?",
              "detalha o item 2", "tem plug roscável?" — e o Getúlio responde com os números do sistema.
              Outros números seguem o atendimento normal.
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs ${ultimaMensagemRecebida ? 'text-emerald-700' : 'text-amber-700'}`}>
                {ultimaMensagemRecebida
                  ? `● Recebendo — última mensagem chegou em ${dataHora(ultimaMensagemRecebida)}`
                  : recebendo
                    ? '○ Endereço cadastrado, mas nenhuma mensagem chegou ainda'
                    : '○ O sistema ainda não recebe as mensagens do WhatsApp'}
              </span>
              <button onClick={conectarRecebimento} disabled={!!ocupado || !whatsappPronto}
                className="text-xs px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap">
                {ocupado === 'conectar' ? 'Conectando…' : recebendo ? 'Cadastrar de novo' : 'Conectar'}
              </button>
            </div>
            {/* Plano B: a Z-API às vezes aceita o cadastro pela API e não grava
                (medido em 07/10/2026 — o painel continuou com o endereço de um
                sistema antigo). Colar à mão no painel resolve. */}
            {enderecoRecebimento && (
              <div>
                <p className="text-[11px] text-gray-500 mb-1">
                  Se nenhuma mensagem chegar, cole este endereço no painel da Z-API, em <strong>Webhooks → Ao receber</strong>, e salve:
                </p>
                <div className="flex gap-1.5">
                  <input readOnly value={enderecoRecebimento} onFocus={e => e.currentTarget.select()}
                    className="flex-1 min-w-0 border border-gray-200 bg-gray-50 rounded-lg px-2 py-1 text-[11px] text-gray-600 font-mono" />
                  <button onClick={async () => {
                      try { await navigator.clipboard.writeText(enderecoRecebimento); setCopiado(true); setTimeout(() => setCopiado(false), 2000) } catch { /* sem permissão: o campo já seleciona ao tocar */ }
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 hover:bg-gray-50 whitespace-nowrap">
                    {copiado ? 'Copiado ✓' : 'Copiar'}
                  </button>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!config.responder_whatsapp}
                onChange={e => setConfig(c => ({ ...c, responder_whatsapp: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
              Responder perguntas <span className="text-[11px] text-gray-400">(depois clique em Salvar, acima)</span>
            </label>
            {conversas.length > 0 && (
              <div className="bg-[#efeae2] rounded-lg p-2 space-y-1.5 max-h-80 overflow-y-auto">
                {conversas.map(c => (
                  <div key={c.id} className={`flex ${c.papel === 'dono' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 shadow-sm ${c.papel === 'dono' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                      <TextoWhatsapp texto={c.texto} />
                      <p className="text-[10px] text-gray-400 text-right mt-0.5">
                        {dataHora(c.created_at)}{c.consultas?.length ? ` · consultou ${c.consultas.length}x` : ''}
                      </p>
                      {c.erro && <p className="text-[10px] text-red-600">{c.erro}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Histórico */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">O que ele já mandou</h2>
            {mensagens.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhuma mensagem ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {mensagens.map(m => (
                  <li key={m.id} className="text-xs">
                    <button onClick={() => setMensagemAberta(a => a === m.id ? null : m.id)} className="w-full text-left flex items-center justify-between gap-2 hover:bg-gray-50 rounded px-1 py-0.5">
                      <span className="text-gray-700">{dataHora(m.created_at)} · {m.tipo === 'resumo_diario' ? 'resumo do dia' : 'envio manual'}</span>
                      <span className={m.status === 'enviado' ? 'text-emerald-600' : m.status === 'parcial' ? 'text-amber-600' : 'text-red-600'}>{m.status}</span>
                    </button>
                    {mensagemAberta === m.id && (
                      <div className="mt-1 bg-[#efeae2] rounded-lg p-2">
                        <div className="bg-white rounded-lg px-2.5 py-2"><TextoWhatsapp texto={m.texto} /></div>
                        {m.erro && <p className="text-red-600 mt-1">{m.erro}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
