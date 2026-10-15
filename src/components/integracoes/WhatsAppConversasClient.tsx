'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone } from '@/lib/clientes/telefone'
import { numeroOculto, semMarca } from '@/lib/whatsapp/contatos'
import { BUCKET_MIDIAS, LIMITE_MIDIA, comoMostrar } from '@/lib/whatsapp/midias'
import { filtroNomeOuMarca } from '@/lib/produtos/similares'
import { ETAPAS, atalhosDeRetorno, etapaDe, hojeNaLoja, somarDias, rotuloRetorno, doCliente, legendaDoProduto, preencherResposta, rotuloSaida, tempoDeEspera, type ProdutoParaEnviar, type RespostaRapida } from '@/lib/whatsapp/conversas'
import { precoVigente, promocaoVigente } from '@/lib/produtos/promocao'

export type Conversa = {
  id: string; telefone: string; nome_whatsapp: string | null; cliente_id: string | null; cliente_nome: string | null
  status: string; ultima_atividade: string | null; ultima_entrada_em: string | null; aguardando: boolean; nao_lida: boolean
  etapa: string; retorno_em: string | null; retorno_nota: string | null; retorno_vencido: boolean; orcamento_parado: boolean
}
export type Mensagem = {
  id: string; tipo: string; conteudo: string; status: string; erro: string | null
  created_at: string; enviado_em: string | null; operador_nome: string | null
  /** Link para mostrar o arquivo (assinado, quando guardado no bucket). */
  midia_url: string | null
}
export type Ficha = {
  saldo_devedor: number | null; saldo_credito: number | null; valor_vencido: number | null
  limite_credito: number | null; bloqueado_fiado: boolean | null; opt_out_whatsapp: boolean | null
  compras: { id: string; numero: number | string | null; created_at: string; total: number | null; canal: string | null }[]
}
export type OrcamentoConversa = { id: string; numero: number | string | null; created_at: string; total: number | null; validade: string | null; status: string }
type ProdutoBusca = ProdutoParaEnviar & { id: string; controlar_estoque: boolean | null; estoque: number | null; marca?: string | null; foto_url?: string | null }

// Busca de produto igual à do PDV: EAN ou código exatos primeiro; senão cada
// palavra precisa aparecer no nome ou na marca ("disj 32a steck"); por fim
// código parecido. Se o banco ainda não tiver `foto_url`, busca sem a foto.
const COLS_BUSCA = 'id, nome, sku, ean, marca, unidade, preco_venda, preco_promocional, promocao_ativa, promocao_inicio, promocao_fim, controlar_estoque, estoque'
let comFoto = true
async function procurarProdutos(empresaId: string, q: string): Promise<ProdutoBusca[]> {
  const sb = createClient()
  const palavras = q.trim().split(/\s+/).filter(Boolean)
  if (!palavras.length) return []
  const consultar = async (montar: (base: any) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const base = (cols: string) => sb.from('produtos').select(cols).eq('empresa_id', empresaId).eq('ativo', true)
    if (comFoto) {
      const r = await montar(base(`${COLS_BUSCA}, foto_url`))
      if (!(r.error && (r.error.code === '42703' || /foto_url/.test(r.error.message ?? '')))) return (r.error ? [] : r.data ?? []) as ProdutoBusca[]
      comFoto = false
    }
    const r = await montar(base(COLS_BUSCA))
    return (r.error ? [] : r.data ?? []) as ProdutoBusca[]
  }
  if (palavras.length === 1) {
    const exato = /^\d{8,14}$/.test(palavras[0])
      ? await consultar(b => b.or(`ean.eq.${palavras[0]},sku.eq.${palavras[0]}`).limit(5))
      : await consultar(b => b.eq('sku', palavras[0].replace(/[,()"]/g, '')).limit(5))
    if (exato.length) return exato
  }
  let lista = await consultar(b => {
    for (const p of palavras) { const f = filtroNomeOuMarca(p); if (f) b = b.or(f) }
    return b.order('nome').limit(20)
  })
  if (!lista.length) lista = await consultar(b => b.ilike('sku', `%${palavras[0].replace(/[%*,()"]/g, '')}%`).order('nome').limit(20))
  return lista
}

const EXT_IMAGEM: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

function Midia({ m }: { m: Mensagem }) {
  const tipo = comoMostrar(m.conteudo, m.midia_url)
  if (!tipo || !m.midia_url) return null
  if (tipo === 'foto') return (
    <a href={m.midia_url} target="_blank" rel="noreferrer" className="block mb-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.midia_url} alt="" loading="lazy" className="max-h-64 max-w-full rounded-lg" />
    </a>
  )
  if (tipo === 'audio') return <audio controls preload="none" src={m.midia_url} className="mb-1 max-w-full" />
  if (tipo === 'video') return <video controls preload="metadata" src={m.midia_url} className="mb-1 max-h-64 max-w-full rounded-lg" />
  return <a href={m.midia_url} target="_blank" rel="noreferrer" className="block mb-1 text-blue-700 underline">📄 Abrir arquivo</a>
}

const nomeDe = (c: Conversa) => c.cliente_nome || c.nome_whatsapp || (numeroOculto(c.telefone) ? 'Número oculto' : formatarTelefone(c.telefone))
const hora = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' })
const brl = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const FILTROS: Record<string, string> = { todas: 'Todas', hoje: 'Para hoje', aguardando: 'Aguardando resposta', nao_lidas: 'Não lidas' }

export default function WhatsAppConversasClient({ conversas, aberta, mensagens, contagem, filtros, indisponivel, ficha, orcamentos, respostas, loja, empresaId }: {
  conversas: Conversa[]; aberta: Conversa | null; mensagens: Mensagem[]
  ficha: Ficha | null; orcamentos: OrcamentoConversa[]; respostas: RespostaRapida[]; loja: string; empresaId: string
  contagem: { aguardando: number; naoLidas: number; hoje: number; etapas: Record<string, number> }
  filtros: { f: string; q: string; e: string | null }
  indisponivel: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [q, setQ] = useState(filtros.q)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const fim = useRef<HTMLDivElement>(null)
  const [verFicha, setVerFicha] = useState(false)
  const [painel, setPainel] = useState<'' | 'nova' | 'produto' | 'orcamento'>('')
  const [nova, setNova] = useState({ nome: '', conteudo: '' })
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<ProdutoBusca[]>([])
  const [escolhido, setEscolhido] = useState<ProdutoBusca | null>(null)
  const [aviso, setAviso] = useState('')
  const [lembrete, setLembrete] = useState<{ dia: string; nota: string } | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [marcado, setMarcado] = useState(0)
  const [anexo, setAnexo] = useState<{ arquivo: File; previa: string } | null>(null)
  const seletor = useRef<HTMLInputElement>(null)
  const [orcItens, setOrcItens] = useState<{ p: ProdutoBusca; quantidade: number }[]>([])
  const [orcValidade, setOrcValidade] = useState('')
  const [orcObs, setOrcObs] = useState('')
  const [orcOcupado, setOrcOcupado] = useState<string | null>(null)

  function abrirOrcamento() {
    setPainel(p => p === 'orcamento' ? '' : 'orcamento')
    setBusca(''); setAchados([]); setEscolhido(null)
    if (!orcValidade) setOrcValidade(somarDias(hojeNaLoja(), 7))
  }
  function adicionarAoOrcamento(p: ProdutoBusca) {
    setOrcItens(l => l.some(i => i.p.id === p.id) ? l.map(i => i.p.id === p.id ? { ...i, quantidade: i.quantidade + 1 } : i) : [...l, { p, quantidade: 1 }])
    setBusca(''); setAchados([])
  }
  const totalOrcamento = orcItens.reduce((s, i) => s + Math.round(precoVigente(i.p) * i.quantidade * 100) / 100, 0)

  // Cria o orçamento (o mesmo do PDV e da tela de Orçamentos) e envia na
  // conversa. O preço é recalculado no servidor pelo cadastro.
  async function criarOrcamento() {
    if (!aberta || !orcItens.length) return
    setEnviando(true); setErro(''); setAviso('')
    try {
      const res = await fetch('/api/whatsapp/conversas/orcamento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatoId: aberta.id, itens: orcItens.map(i => ({ produtoId: i.p.id, quantidade: i.quantidade })), validade: orcValidade, observacao: orcObs }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok && !r.criado) { setErro(r.error ?? 'Não foi possível criar o orçamento.'); return }
      if (r.error) setErro(r.error)
      else setAviso(`Orçamento nº ${r.numero} criado e enviado.`)
      setOrcItens([]); setOrcObs(''); setOrcValidade(''); setPainel('')
    } finally {
      setEnviando(false)
      router.refresh()
    }
  }

  async function acaoOrcamento(o: OrcamentoConversa, acao: 'fechou' | 'desistiu' | 'reenviar') {
    if (!aberta) return
    if (acao === 'desistiu' && !confirm(`Cancelar o orçamento nº ${o.numero} e marcar a conversa como Perdido?`)) return
    if (acao === 'reenviar' && !confirm(`Enviar de novo o orçamento nº ${o.numero} para o cliente?`)) return
    setOrcOcupado(o.id); setErro(''); setAviso('')
    try {
      const res = await fetch('/api/whatsapp/conversas/orcamento/acao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatoId: aberta.id, orcamentoId: o.id, acao }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(r.error ?? 'Não foi possível concluir.'); return }
      // Fechou: o PDV abre com o orçamento; ao concluir a venda ele vira
      // "Convertido" e a conversa vai para "Comprou".
      if (acao === 'fechou' && r.pdv) { router.push(r.pdv); return }
      setAviso(acao === 'reenviar' ? `Orçamento nº ${o.numero} reenviado.` : `Orçamento nº ${o.numero} cancelado.`)
    } finally {
      setOrcOcupado(null)
      router.refresh()
    }
  }
  const listaOrcamentos = <OrcamentosDaConversa orcamentos={orcamentos} ocupado={orcOcupado} onAcao={acaoOrcamento} />
  type Sugestao = { texto: string; nota: string; produtos: { id: string; nome: string; preco: number | null; estoque: number | null }[] }
  const [sugestao, setSugestao] = useState<Sugestao | null>(null)
  const [sugerindo, setSugerindo] = useState(false)

  // Rascunho da IA: aparece num quadro para ler; "Usar" só coloca na caixa
  // de texto. Quem envia é sempre a pessoa.
  async function sugerirResposta() {
    if (!aberta) return
    setSugerindo(true); setErro(''); setSugestao(null)
    try {
      const res = await fetch('/api/whatsapp/conversas/sugerir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatoId: aberta.id }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) setErro(r.error ?? 'Não foi possível sugerir agora.')
      else setSugestao({ texto: r.sugestao, nota: r.nota ?? '', produtos: r.produtos ?? [] })
    } finally {
      setSugerindo(false)
    }
  }

  // Busca enquanto digita, como no PDV.
  useEffect(() => {
    if ((painel !== 'produto' && painel !== 'orcamento') || busca.trim().length < 2) return
    let valido = true
    const t = setTimeout(async () => {
      setBuscando(true)
      const lista = await procurarProdutos(empresaId, busca)
      if (valido) { setAchados(lista); setMarcado(0); setEscolhido(null); setBuscando(false) }
    }, 220)
    return () => { valido = false; clearTimeout(t) }
  }, [busca, painel, empresaId])

  // Imagem colada (Ctrl+V) ou escolhida: fica de prévia até enviar.
  function anexar(arquivo: File | null | undefined) {
    if (!arquivo) return
    if (!EXT_IMAGEM[arquivo.type]) { setErro('Só dá para enviar imagem (JPG, PNG, WEBP ou GIF).'); return }
    if (arquivo.size > LIMITE_MIDIA) { setErro('Imagem muito grande (máximo 16 MB).'); return }
    if (anexo) URL.revokeObjectURL(anexo.previa)
    setErro(''); setAnexo({ arquivo, previa: URL.createObjectURL(arquivo) })
  }
  function tirarAnexo() {
    if (anexo) URL.revokeObjectURL(anexo.previa)
    setAnexo(null)
  }

  async function enviarImagem() {
    if (!aberta || !anexo) return
    setEnviando(true); setErro('')
    try {
      const arquivo = `${crypto.randomUUID()}.${EXT_IMAGEM[anexo.arquivo.type]}`
      const { error } = await createClient().storage.from(BUCKET_MIDIAS)
        .upload(`${empresaId}/${aberta.id}/${arquivo}`, anexo.arquivo, { contentType: anexo.arquivo.type })
      if (error) { setErro('Não foi possível subir a imagem.'); return }
      const res = await fetch('/api/whatsapp/conversas/imagem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatoId: aberta.id, arquivo, legenda: texto.trim() }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) setErro(r.error ?? 'Não foi possível enviar a imagem.')
      else { setTexto(''); tirarAnexo() }
    } finally {
      setEnviando(false)
      router.refresh()
    }
  }

  const url = (p: Record<string, string | null>) => {
    const sp = new URLSearchParams()
    const base = { f: filtros.f, q: filtros.q, e: filtros.e, c: aberta?.id ?? null, ...p }
    Object.entries(base).forEach(([k, v]) => { if (v && !(k === 'f' && v === 'todas')) sp.set(k, v) })
    return `/dashboard/integracoes/whatsapp/conversas?${sp}`
  }
  const ir = (p: Record<string, string | null>) => startTransition(() => router.push(url(p)))

  // Atualiza sozinho (mensagem nova do cliente) enquanto a aba está aberta.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, 20_000)
    return () => clearInterval(t)
  }, [router])

  // Abriu a conversa: marca como lida e desce para a última mensagem.
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
    if (aberta?.nao_lida) {
      createClient().from('whatsapp_contatos').update({ lida_em: new Date().toISOString() }).eq('id', aberta.id)
        .then(() => router.refresh())
    }
  }, [aberta?.id, aberta?.nao_lida, mensagens.length, router])

  async function responder() {
    if (anexo) return enviarImagem()
    if (!aberta || !texto.trim()) return
    setEnviando(true); setErro('')
    try {
      // Mesma rota dos outros envios: registra, respeita opt-out e guarda o
      // resultado da Z-API. O banco liga a mensagem à conversa pelo telefone.
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: aberta.telefone, mensagem: texto.trim(), tipo: 'atendimento', cliente_id: aberta.cliente_id, cliente_nome: aberta.cliente_nome }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) setErro(r.error ?? 'Não foi possível enviar.')
      else setTexto('')
    } finally {
      setEnviando(false)
      router.refresh()
    }
  }

  // Etapa e lembrete: o banco só deixa o logado mudar essas colunas (e o
  // RLS limita à empresa). Lembrete é só aviso na tela; nada sai sozinho.
  async function mudarEtapa(etapa: string) {
    if (!aberta) return
    const { error } = await createClient().from('whatsapp_contatos').update({ etapa }).eq('id', aberta.id)
    if (error) setErro('Não foi possível mudar a etapa.')
    router.refresh()
  }

  async function salvarLembrete(valor: { dia: string; nota: string } | null) {
    if (!aberta) return
    const { error } = await createClient().from('whatsapp_contatos')
      .update({ retorno_em: valor?.dia || null, retorno_nota: valor?.nota.trim().slice(0, 200) || null })
      .eq('id', aberta.id)
    if (error) { setErro('Não foi possível salvar o lembrete.'); return }
    setLembrete(null); router.refresh()
  }

  // Resposta rápida: entra na caixa de texto para ajustar antes de enviar.
  function usarResposta(r: RespostaRapida) {
    const pronto = preencherResposta(r.conteudo, { nome: aberta?.cliente_nome || aberta?.nome_whatsapp, loja })
    setTexto(t => (t.trim() ? `${t.trimEnd()}\n${pronto}` : pronto))
  }

  async function salvarResposta() {
    if (!nova.nome.trim() || !nova.conteudo.trim()) return
    const { error } = await createClient().from('whatsapp_modelos').insert({
      empresa_id: empresaId, nome: nova.nome.trim().slice(0, 40), tipo: 'resposta_rapida', conteudo: nova.conteudo.trim(), ativo: true,
    })
    if (error) { setErro('Não foi possível salvar a resposta.'); return }
    setNova({ nome: '', conteudo: '' }); setPainel(''); router.refresh()
  }

  async function enviarProduto() {
    if (!aberta || !escolhido) return
    setEnviando(true); setErro(''); setAviso('')
    try {
      const res = await fetch('/api/whatsapp/conversas/produto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contatoId: aberta.id, produtoId: escolhido.id }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) setErro(r.error ?? 'Não foi possível enviar o produto.')
      else { setAviso(r.comFoto ? 'Produto enviado com foto.' : 'Produto sem foto cadastrada: foi só o texto.'); setPainel(''); setEscolhido(null); setAchados([]); setBusca('') }
    } finally {
      setEnviando(false)
      router.refresh()
    }
  }

  if (indisponivel) return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
      A caixa de entrada ainda não foi ativada no banco. Peça para aplicar as migrações <code>20261015200000_whatsapp_conversas.sql</code> e <code>20261016120000_whatsapp_funil.sql</code>.
    </div>
  )

  const oculto = aberta ? numeroOculto(aberta.telefone) : false

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span>
        <a href="/dashboard/integracoes/whatsapp" className="hover:text-gray-600">WhatsApp</a><span>›</span>
        <span className="text-gray-600 font-medium">Conversas</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] xl:grid-cols-[320px_1fr_270px] gap-4 h-[calc(100vh-150px)] min-h-[520px]">
        {/* Lista */}
        <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100 space-y-2">
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ir({ q, c: null })}
              placeholder="Buscar nome ou telefone..." className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500" />
            <div className="flex gap-1 flex-wrap">
              {Object.entries(FILTROS).map(([k, v]) => (
                <button key={k} onClick={() => ir({ f: k, c: null })}
                  className={`text-xs px-2 py-1 rounded-full ${filtros.f === k ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {v}{k === 'hoje' && contagem.hoje ? ` (${contagem.hoje})` : ''}{k === 'aguardando' && contagem.aguardando ? ` (${contagem.aguardando})` : ''}{k === 'nao_lidas' && contagem.naoLidas ? ` (${contagem.naoLidas})` : ''}
                </button>
              ))}
            </div>
            <div className="flex gap-1 flex-wrap">
              {ETAPAS.map(e => (
                <button key={e.id} onClick={() => ir({ e: filtros.e === e.id ? null : e.id, c: null })}
                  className={`text-[11px] px-2 py-0.5 rounded-full ${filtros.e === e.id ? 'ring-2 ring-teal-500 ' : ''}${e.cor}`}>
                  {e.rotulo} {contagem.etapas[e.id] ?? 0}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {conversas.length === 0 && <p className="p-6 text-sm text-gray-400 text-center">Nenhuma conversa aqui.</p>}
            {conversas.map(c => (
              <button key={c.id} onClick={() => { setLembrete(null); setSugestao(null); ir({ c: c.id }) }}
                className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 ${aberta?.id === c.id ? 'bg-teal-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm truncate ${c.nao_lida ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{nomeDe(c)}</span>
                  {c.ultima_atividade && <span className="text-[11px] text-gray-400 whitespace-nowrap">{hora(c.ultima_atividade)}</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {c.etapa !== 'novo' && <span className={`text-[10px] px-1.5 rounded ${etapaDe(c.etapa).cor}`}>{etapaDe(c.etapa).rotulo}</span>}
                  {c.cliente_id && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded">cliente</span>}
                  {c.retorno_em && <span className={`text-[10px] px-1.5 rounded ${c.retorno_vencido ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600'}`}>retorno {rotuloRetorno(c.retorno_em)}</span>}
                  {c.orcamento_parado && <span className="text-[10px] bg-orange-100 text-orange-800 px-1.5 rounded">orçamento parado</span>}
                  {c.aguardando && c.ultima_entrada_em && <span className="text-[11px] text-amber-700">aguardando há {tempoDeEspera(c.ultima_entrada_em)}</span>}
                  {c.nao_lida && <span className="ml-auto w-2 h-2 rounded-full bg-teal-500" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Conversa */}
        <div className="bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
          {!aberta ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-6 text-center">
              Escolha uma conversa. As que estão aguardando resposta aparecem marcadas em amarelo.
            </div>
          ) : <>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{nomeDe(aberta)}</p>
                <p className="text-xs text-gray-500">
                  {oculto ? 'Número oculto pelo WhatsApp' : formatarTelefone(aberta.telefone)}
                  {aberta.cliente_nome && aberta.nome_whatsapp ? ` · no WhatsApp: ${aberta.nome_whatsapp}` : ''}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <select value={aberta.etapa} onChange={e => mudarEtapa(e.target.value)}
                    className={`text-xs rounded-full px-2 py-0.5 border-0 cursor-pointer ${etapaDe(aberta.etapa).cor}`}>
                    {ETAPAS.map(e => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
                  </select>
                  {aberta.retorno_em ? (
                    <button onClick={() => setLembrete({ dia: aberta.retorno_em!, nota: aberta.retorno_nota ?? '' })}
                      className={`text-xs px-2 py-0.5 rounded-full ${aberta.retorno_vencido ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'}`}>
                      Retornar {rotuloRetorno(aberta.retorno_em)}{aberta.retorno_nota ? ` · ${aberta.retorno_nota}` : ''}
                    </button>
                  ) : (
                    <button onClick={() => setLembrete({ dia: atalhosDeRetorno()[0].dia, nota: '' })}
                      className="text-xs px-2 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-gray-700">+ Lembrete de retorno</button>
                  )}
                  {aberta.orcamento_parado && <span className="text-xs text-orange-700">Orçamento sem resposta há 3 dias ou mais</span>}
                </div>
                {lembrete && (
                  <div className="mt-2 p-2 rounded-lg bg-gray-50 border border-gray-200 space-y-1.5 max-w-md">
                    <div className="flex gap-1 flex-wrap items-center">
                      {atalhosDeRetorno().map(a => (
                        <button key={a.rotulo} onClick={() => setLembrete(l => l && { ...l, dia: a.dia })}
                          className={`text-[11px] px-2 py-0.5 rounded-full ${lembrete.dia === a.dia ? 'bg-teal-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{a.rotulo}</button>
                      ))}
                      <input type="date" value={lembrete.dia} onChange={e => setLembrete(l => l && { ...l, dia: e.target.value })}
                        className="text-[11px] border border-gray-300 rounded px-1.5 py-0.5" />
                    </div>
                    <input value={lembrete.nota} onChange={e => setLembrete(l => l && { ...l, nota: e.target.value })} maxLength={200}
                      placeholder="Nota (ex.: ver se fechou o orçamento da tinta)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                    <div className="flex justify-between items-center">
                      {aberta.retorno_em
                        ? <button onClick={() => salvarLembrete(null)} className="text-[11px] text-gray-600 hover:underline">Concluir (apagar lembrete)</button>
                        : <span className="text-[11px] text-gray-400">Só um aviso na tela: nada é enviado sozinho.</span>}
                      <div className="flex gap-2">
                        <button onClick={() => setLembrete(null)} className="text-xs px-2 py-1 text-gray-600">Cancelar</button>
                        <button onClick={() => salvarLembrete(lembrete)} disabled={!lembrete.dia} className="text-xs px-3 py-1 rounded bg-teal-600 text-white disabled:opacity-50">Salvar</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 text-xs">
                <button onClick={() => setVerFicha(v => !v)} className="xl:hidden text-blue-600 hover:underline">{verFicha ? 'Fechar ficha' : 'Ficha'}</button>
                {aberta.cliente_id
                  ? <a href={`/dashboard/clientes/${aberta.cliente_id}`} className="text-blue-600 hover:underline">Ver cliente</a>
                  : <a href={`/dashboard/integracoes/whatsapp/contatos?q=${encodeURIComponent(aberta.nome_whatsapp ?? aberta.telefone)}`} className="text-blue-600 hover:underline">Cadastrar cliente</a>}
                {!oculto && <a href={`https://wa.me/${aberta.telefone}`} target="_blank" rel="noreferrer" className="text-green-700 hover:underline">Abrir no WhatsApp</a>}
              </div>
            </div>

            {verFicha && <div className="xl:hidden border-b border-gray-100 max-h-[45%] overflow-y-auto"><FichaCliente aberta={aberta} ficha={ficha} orcamentos={listaOrcamentos} /></div>}

            <div className="flex-1 overflow-y-auto bg-gray-50 px-4 py-3 space-y-2">
              {mensagens.length === 200 && <p className="text-center text-[11px] text-gray-400">Mostrando as últimas 200 mensagens.</p>}
              {mensagens.map(m => {
                const cliente = doCliente(m.tipo), rotulo = rotuloSaida(m.tipo)
                return (
                  <div key={m.id} className={`flex ${cliente ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm ${cliente ? 'bg-white text-gray-800' : m.status === 'erro' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-teal-100 text-gray-900'}`}>
                      {rotulo && <p className="text-[10px] uppercase tracking-wide text-teal-700 mb-0.5">{rotulo}</p>}
                      <Midia m={m} />
                      {(() => { const t = m.midia_url ? semMarca(m.conteudo) : m.conteudo; return t ? <p className="whitespace-pre-wrap break-words">{t}</p> : null })()}
                      <p className="text-[10px] text-gray-400 mt-1 text-right">
                        {hora(m.enviado_em ?? m.created_at)}
                        {!cliente && m.operador_nome ? ` · ${m.operador_nome.split('@')[0]}` : ''}
                        {m.status === 'erro' ? ` · não enviada${m.erro ? `: ${m.erro}` : ''}` : m.status === 'pendente' ? ' · enviando…' : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={fim} />
            </div>

            <div className="border-t border-gray-100 p-3">
              {oculto ? (
                <p className="text-xs text-gray-500">O WhatsApp escondeu o número desta pessoa: responda pelo celular. Ao pedir o telefone dela, cadastre como cliente.</p>
              ) : <>
                <div className="flex gap-1.5 flex-wrap mb-2 items-center">
                  {respostas.map(r => (
                    <button key={r.id ?? r.nome} onClick={() => usarResposta(r)} title={r.conteudo}
                      className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-teal-50 hover:text-teal-800">{r.nome}</button>
                  ))}
                  <button onClick={() => setPainel(p => p === 'nova' ? '' : 'nova')} className="text-xs px-2 py-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-gray-700">+ Nova</button>
                  <button onClick={sugerirResposta} disabled={sugerindo}
                    className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60">
                    {sugerindo ? 'Pensando…' : '✨ Sugerir resposta'}
                  </button>
                  <button onClick={abrirOrcamento}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white border border-amber-500 text-amber-700 hover:bg-amber-50">Montar orçamento</button>
                  <button onClick={() => setPainel(p => p === 'produto' ? '' : 'produto')}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white border border-teal-600 text-teal-700 hover:bg-teal-50">Enviar produto</button>
                </div>

                {painel === 'nova' && (
                  <div className="mb-2 p-2 rounded-lg bg-gray-50 border border-gray-200 space-y-1.5">
                    <input value={nova.nome} onChange={e => setNova(n => ({ ...n, nome: e.target.value }))} maxLength={40}
                      placeholder="Nome do botão (ex.: Entrega)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                    <textarea value={nova.conteudo} onChange={e => setNova(n => ({ ...n, conteudo: e.target.value }))} rows={2} maxLength={1000}
                      placeholder="Texto. Use {nome} para o primeiro nome e {loja} para o nome da loja." className="w-full border border-gray-300 rounded px-2 py-1 text-xs resize-none" />
                    <div className="flex justify-between items-center">
                      <a href="/dashboard/integracoes/whatsapp" className="text-[11px] text-gray-500 hover:underline">Editar ou apagar em Modelos</a>
                      <button onClick={salvarResposta} disabled={!nova.nome.trim() || !nova.conteudo.trim()}
                        className="text-xs px-3 py-1 rounded bg-teal-600 text-white disabled:opacity-50">Salvar resposta</button>
                    </div>
                  </div>
                )}

                {painel === 'orcamento' && (
                  <div className="mb-2 p-2 rounded-lg bg-amber-50/60 border border-amber-200 space-y-2">
                    <input value={busca} onChange={e => setBusca(e.target.value)} autoFocus
                      onKeyDown={e => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado(i => Math.min(i + 1, achados.length - 1)) }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado(i => Math.max(i - 1, 0)) }
                        else if (e.key === 'Enter' && achados[marcado]) { e.preventDefault(); adicionarAoOrcamento(achados[marcado]) }
                      }}
                      placeholder="Adicionar produto: nome, marca, código ou código de barras" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                    {achados.length > 0 && (
                      <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 bg-white rounded border border-gray-200">
                        {achados.map((p, i) => (
                          <button key={p.id} onClick={() => adicionarAoOrcamento(p)} onMouseEnter={() => setMarcado(i)}
                            className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 ${i === marcado ? 'bg-amber-50' : ''}`}>
                            <span className="flex-1 min-w-0 truncate">{p.nome}{p.sku ? <span className="text-gray-400"> · {p.sku}</span> : null}</span>
                            <span className="whitespace-nowrap">{brl(precoVigente(p))}
                              {p.controlar_estoque && <span className={`ml-1.5 ${Number(p.estoque ?? 0) > 0 ? 'text-gray-400' : 'text-red-600'}`}>est. {Number(p.estoque ?? 0)}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {orcItens.length === 0 ? <p className="text-[11px] text-gray-500">Busque e clique nos produtos para montar o orçamento.</p> : (
                      <table className="w-full text-xs bg-white rounded border border-gray-200">
                        <tbody className="divide-y divide-gray-100">
                          {orcItens.map(i => {
                            const preco = precoVigente(i.p)
                            return (
                              <tr key={i.p.id}>
                                <td className="px-2 py-1">{i.p.nome}{!(preco > 0) && <span className="text-red-600"> (sem preço)</span>}</td>
                                <td className="px-1 py-1 w-20">
                                  <input type="number" min={0.001} step="any" value={i.quantidade}
                                    onChange={e => { const q = Number(e.target.value); setOrcItens(l => l.map(x => x.p.id === i.p.id ? { ...x, quantidade: q } : x)) }}
                                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-right" />
                                </td>
                                <td className="px-2 py-1 text-right whitespace-nowrap text-gray-500">× {brl(preco)}</td>
                                <td className="px-2 py-1 text-right whitespace-nowrap font-medium">{brl(Math.round(preco * i.quantidade * 100) / 100)}</td>
                                <td className="px-1"><button onClick={() => setOrcItens(l => l.filter(x => x.p.id !== i.p.id))} className="text-red-500 px-1" title="Tirar">×</button></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                    <div className="flex gap-2 flex-wrap items-center text-xs">
                      <label className="flex items-center gap-1 text-gray-600">Válido até
                        <input type="date" value={orcValidade} onChange={e => setOrcValidade(e.target.value)} className="border border-gray-300 rounded px-1 py-0.5" />
                      </label>
                      <input value={orcObs} onChange={e => setOrcObs(e.target.value)} maxLength={500} placeholder="Observação (opcional)"
                        className="flex-1 min-w-[140px] border border-gray-300 rounded px-2 py-0.5" />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold">Total: {brl(totalOrcamento)}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setPainel('')} className="text-xs px-2 py-1 text-gray-600">Fechar</button>
                        <button onClick={criarOrcamento} disabled={enviando || !orcItens.length || orcItens.some(i => !(i.quantidade > 0) || !(precoVigente(i.p) > 0))}
                          className="text-xs px-3 py-1 rounded bg-amber-600 text-white disabled:opacity-50">{enviando ? 'Enviando…' : 'Criar e enviar orçamento'}</button>
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-500">Preço de hoje do cadastro. Desconto e condições de pagamento: edite depois em Orçamentos e use &ldquo;Reenviar&rdquo;.</p>
                  </div>
                )}

                {painel === 'produto' && (
                  <div className="mb-2 p-2 rounded-lg bg-gray-50 border border-gray-200">
                    <input value={busca} onChange={e => setBusca(e.target.value)} autoFocus
                      onKeyDown={e => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado(i => Math.min(i + 1, achados.length - 1)) }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado(i => Math.max(i - 1, 0)) }
                        else if (e.key === 'Enter' && achados[marcado]) { e.preventDefault(); setEscolhido(achados[marcado]) }
                      }}
                      placeholder="Nome, marca, código ou código de barras — como no PDV" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
                    {buscando && <p className="text-[11px] text-gray-400 mt-1">Buscando…</p>}
                    {!buscando && busca.trim().length >= 2 && achados.length === 0 && <p className="text-[11px] text-gray-400 mt-1">Nenhum produto ativo encontrado.</p>}
                    {achados.length > 0 && !escolhido && (
                      <div className="mt-1.5 max-h-60 overflow-y-auto divide-y divide-gray-100 bg-white rounded border border-gray-200">
                        {achados.map((p, i) => (
                          <button key={p.id} onClick={() => setEscolhido(p)} onMouseEnter={() => setMarcado(i)}
                            className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 ${i === marcado ? 'bg-teal-50' : ''}`}>
                            {p.foto_url
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={p.foto_url} alt="" loading="lazy" className="w-9 h-9 object-cover rounded border border-gray-100 shrink-0" />
                              : <span className="w-9 h-9 rounded bg-gray-100 shrink-0" />}
                            <span className="flex-1 min-w-0">
                              <span className="block truncate font-medium text-gray-800">{p.nome}</span>
                              <span className="block truncate text-gray-400">{[p.sku && `Cód. ${p.sku}`, p.marca].filter(Boolean).join(' · ')}</span>
                            </span>
                            <span className="text-right whitespace-nowrap">
                              <span className="block font-medium">{promocaoVigente(p) && <span className="text-orange-600 mr-1">promo</span>}{brl(precoVigente(p))}</span>
                              {p.controlar_estoque && <span className={`block ${Number(p.estoque ?? 0) > 0 ? 'text-gray-400' : 'text-red-600'}`}>estoque {Number(p.estoque ?? 0)}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {escolhido && (
                      <div className="mt-1.5 bg-white rounded border border-gray-200 p-2">
                        <p className="text-[11px] text-gray-500 mb-1">Vai com a foto principal do produto (se houver) e esta legenda:</p>
                        <p className="text-xs whitespace-pre-wrap">{legendaDoProduto(escolhido)}</p>
                        {escolhido.controlar_estoque && Number(escolhido.estoque ?? 0) <= 0 && <p className="text-[11px] text-red-600 mt-1">Sem estoque no sistema.</p>}
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setEscolhido(null)} className="text-xs px-2 py-1 text-gray-600">Voltar</button>
                          <button onClick={enviarProduto} disabled={enviando} className="text-xs px-3 py-1 rounded bg-teal-600 text-white disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar ao cliente'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {sugestao && (
                  <div className="mb-2 p-2.5 rounded-lg bg-violet-50 border border-violet-200">
                    <p className="text-[10px] uppercase tracking-wide text-violet-700 mb-1">Sugestão da IA — leia antes de usar</p>
                    <p className="text-sm whitespace-pre-wrap text-gray-900">{sugestao.texto}</p>
                    {sugestao.nota && <p className="text-[11px] text-amber-800 mt-1.5">⚠ {sugestao.nota}</p>}
                    {sugestao.produtos.length > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1.5">
                        Consultou no cadastro: {sugestao.produtos.map(p => `${p.nome}${p.preco != null ? ` (${brl(p.preco)}` : ' (sem preço'}${p.estoque === null ? ')' : p.estoque > 0 ? `, estoque ${p.estoque})` : ', em falta)'}`).join('; ')}
                      </p>
                    )}
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setSugestao(null)} className="text-xs px-2 py-1 text-gray-600">Descartar</button>
                      <button onClick={sugerirResposta} disabled={sugerindo} className="text-xs px-2 py-1 text-violet-700 disabled:opacity-50">Outra sugestão</button>
                      <button onClick={() => { setTexto(sugestao.texto); setSugestao(null) }}
                        className="text-xs px-3 py-1 rounded bg-violet-600 text-white">Usar na caixa de texto</button>
                    </div>
                  </div>
                )}
                {anexo && (
                  <div className="mb-2 flex items-start gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={anexo.previa} alt="" className="max-h-28 rounded-lg border border-gray-200" />
                    <div className="text-[11px] text-gray-500">
                      <p>Imagem pronta. O texto da caixa vai como legenda.</p>
                      <button onClick={tirarAnexo} className="text-red-600 hover:underline mt-1">Tirar imagem</button>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <button onClick={() => seletor.current?.click()} title="Enviar imagem (ou cole com Ctrl+V)"
                    className="px-2.5 py-2 border border-gray-300 rounded-lg text-gray-500 hover:text-teal-700 hover:border-teal-500">📎</button>
                  <input ref={seletor} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                    onChange={e => { anexar(e.target.files?.[0]); e.target.value = '' }} />
                  <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} maxLength={4000}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); responder() } }}
                    onPaste={e => {
                      const img = Array.from(e.clipboardData.items).find(i => i.kind === 'file' && i.type.startsWith('image/'))
                      if (img) { e.preventDefault(); anexar(img.getAsFile()) }
                    }}
                    placeholder={anexo ? 'Legenda da imagem (opcional)… Enter envia' : 'Escreva a resposta… (Enter envia, Shift+Enter quebra a linha, Ctrl+V cola imagem)'}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-teal-500" />
                  <button onClick={responder} disabled={enviando || (!texto.trim() && !anexo)}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm rounded-lg">
                    {enviando ? 'Enviando…' : 'Enviar'}
                  </button>
                </div>
                {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
                {aviso && <p className="text-xs text-teal-700 mt-1">{aviso}</p>}
                <p className="text-[11px] text-gray-400 mt-1">Sai pelo WhatsApp da loja (Z-API) e fica no histórico. O que for respondido direto no celular aparece aqui só se a Z-API estiver avisando as mensagens enviadas.</p>
              </>}
            </div>
          </>}
        </div>

        {/* Ficha */}
        <div className="hidden xl:block bg-white border border-gray-200 rounded-xl overflow-y-auto">
          {aberta ? <FichaCliente aberta={aberta} ficha={ficha} orcamentos={listaOrcamentos} /> : <p className="p-4 text-xs text-gray-400">A ficha do cliente aparece aqui.</p>}
        </div>
      </div>
    </div>
  )
}

type AcaoOrcamento = 'fechou' | 'desistiu' | 'reenviar'

function OrcamentosDaConversa({ orcamentos, ocupado, onAcao }: { orcamentos: OrcamentoConversa[]; ocupado: string | null; onAcao: (o: OrcamentoConversa, acao: AcaoOrcamento) => void }) {
  const hoje = hojeNaLoja()
  return (
    <div>
      <p className="text-xs font-medium text-gray-700 mb-1">Orçamentos em aberto</p>
      {orcamentos.length === 0 ? <p className="text-xs text-gray-400">Nenhum.</p> : (
        <ul className="text-xs space-y-2">
          {orcamentos.map(o => {
            const venceu = Boolean(o.validade && o.validade < hoje)
            return (
              <li key={o.id} className="rounded-lg border border-gray-100 p-2">
                <div className="flex justify-between gap-2">
                  <span className="text-gray-700">{o.numero ? `nº ${o.numero}` : dia(o.created_at)}
                    {o.status === 'aprovado' && <span className="ml-1 text-[10px] bg-green-100 text-green-700 px-1 rounded">aprovado</span>}
                  </span>
                  <span className="font-medium">{brl(o.total)}</span>
                </div>
                {o.validade && <p className={`text-[11px] ${venceu ? 'text-red-600' : 'text-gray-400'}`}>{venceu ? 'venceu em' : 'vale até'} {dia(`${o.validade}T12:00:00Z`)}</p>}
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <button onClick={() => onAcao(o, 'fechou')} disabled={ocupado === o.id}
                    className="px-2 py-0.5 rounded bg-green-600 text-white disabled:opacity-50">Cliente fechou</button>
                  <button onClick={() => onAcao(o, 'reenviar')} disabled={ocupado === o.id}
                    className="px-2 py-0.5 rounded border border-gray-200 text-gray-700 disabled:opacity-50">Reenviar</button>
                  <button onClick={() => onAcao(o, 'desistiu')} disabled={ocupado === o.id}
                    className="px-2 py-0.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50">Desistiu</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <a href="/dashboard/orcamentos" className="text-[11px] text-blue-600 hover:underline">Ver todos os orçamentos (editar, condições de pagamento)</a>
    </div>
  )
}

function FichaCliente({ aberta, ficha, orcamentos }: { aberta: Conversa; ficha: Ficha | null; orcamentos: React.ReactNode }) {
  if (!aberta.cliente_id || !ficha) return (
    <div className="p-4 text-sm space-y-4">
      <div className="space-y-2">
        <p className="font-medium text-gray-800">Ainda não é cliente</p>
        <p className="text-xs text-gray-500">Cadastre para ver compras e saldo aqui, e para o WhatsApp ligar a conversa ao cadastro.</p>
        <a href={`/dashboard/integracoes/whatsapp/contatos?q=${encodeURIComponent(aberta.nome_whatsapp ?? aberta.telefone)}`}
          className="inline-block text-xs px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700">Cadastrar cliente</a>
      </div>
      {orcamentos}
    </div>
  )
  const devedor = Number(ficha.saldo_devedor ?? 0), vencido = Number(ficha.valor_vencido ?? 0), credito = Number(ficha.saldo_credito ?? 0)
  return (
    <div className="p-4 text-sm space-y-4">
      <div>
        <a href={`/dashboard/clientes/${aberta.cliente_id}`} className="font-medium text-gray-900 hover:underline">{aberta.cliente_nome}</a>
        <div className="flex gap-1 flex-wrap mt-1">
          {ficha.bloqueado_fiado && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded">fiado bloqueado</span>}
          {ficha.opt_out_whatsapp && <span className="text-[10px] bg-gray-200 text-gray-700 px-1.5 rounded">não quer receber WhatsApp</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Em aberto</p><p className={`font-semibold ${devedor > 0 ? 'text-red-700' : 'text-gray-800'}`}>{brl(devedor)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Vencido</p><p className={`font-semibold ${vencido > 0 ? 'text-red-700' : 'text-gray-800'}`}>{brl(vencido)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Crédito</p><p className={`font-semibold ${credito > 0 ? 'text-green-700' : 'text-gray-800'}`}>{brl(credito)}</p></div>
        <div className="rounded-lg bg-gray-50 p-2"><p className="text-gray-500">Limite</p><p className="font-semibold text-gray-800">{brl(ficha.limite_credito)}</p></div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-700 mb-1">Últimas compras</p>
        {ficha.compras.length === 0 ? <p className="text-xs text-gray-400">Nenhuma compra registrada.</p> : (
          <ul className="text-xs divide-y divide-gray-100">
            {ficha.compras.map(v => (
              <li key={v.id} className="py-1 flex justify-between gap-2">
                <span className="text-gray-600">{dia(v.created_at)}{v.numero ? ` · nº ${v.numero}` : ''}{v.canal && v.canal !== 'pdv' ? ` · ${v.canal}` : ''}</span>
                <span className="font-medium">{brl(v.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {orcamentos}
    </div>
  )
}
