'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatarTelefone } from '@/lib/clientes/telefone'
import { numeroOculto, semMarca, telefoneParaWhatsapp, tipoPelaMarca } from '@/lib/whatsapp/contatos'
import { BUCKET_MIDIAS, LIMITE_MIDIA, comoMostrar } from '@/lib/whatsapp/midias'
import { filtroNomeOuMarca } from '@/lib/produtos/similares'
import { ETAPAS, atalhosDeRetorno, etapaDe, hojeNaLoja, rotuloRetorno, doCliente, legendaDoProduto, preencherResposta, rotuloSaida, tempoDeEspera, type ProdutoParaEnviar, type RespostaRapida } from '@/lib/whatsapp/conversas'
import { precoVigente, promocaoVigente } from '@/lib/produtos/promocao'

export type Conversa = {
  id: string; telefone: string; nome_whatsapp: string | null; cliente_id: string | null; cliente_nome: string | null
  status: string; ultima_atividade: string | null; ultima_entrada_em: string | null; aguardando: boolean; nao_lida: boolean
  etapa: string; retorno_em: string | null; retorno_nota: string | null; retorno_vencido: boolean; orcamento_parado: boolean
  /** Código da publicação do Vargas Marketing que trouxe o contato. */
  origem_codigo: string | null; origem_em: string | null
  /** Foto do perfil no WhatsApp (link que vence; some se der erro). */
  foto_url?: string | null; foto_em?: string | null
  /** Última mensagem (prévia na lista). */
  ultima?: { tipo: string; conteudo: string; status: string; status_entrega: string | null } | null
}
export type Mensagem = {
  id: string; tipo: string; conteudo: string; status: string; erro: string | null
  created_at: string; enviado_em: string | null; operador_nome: string | null
  /** entregue / lido (aviso da Z-API), para os tiques. */
  status_entrega?: string | null
  /** Link para mostrar o arquivo (assinado, quando guardado no bucket). */
  midia_url: string | null
  /** Mensagem que esta responde (quando o cliente usou "Responder"). */
  citada?: { achada: true; tipo: string; conteudo: string; midia_url: string | null } | { achada: false } | null
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

// Citação em cima da resposta, como no celular: de quem era e o que era.
function Citacao({ c }: { c: NonNullable<Mensagem['citada']> }) {
  if (!c.achada) return (
    <p className="mb-1 border-l-4 border-gray-300 bg-black/5 rounded px-2 py-1 text-[11px] text-gray-500">
      ↩ Respondeu a uma mensagem que não está no sistema (antiga ou enviada antes de a Z-API avisar).
    </p>
  )
  const daLoja = !doCliente(c.tipo)
  const foto = c.midia_url && comoMostrar(c.conteudo, c.midia_url) === 'foto'
  const texto = semMarca(c.conteudo) || (c.conteudo.match(/^\[[^\]]+\]/)?.[0] ?? '')
  return (
    <div className={`mb-1 flex gap-2 items-start border-l-4 ${daLoja ? 'border-teal-500' : 'border-gray-400'} bg-black/5 rounded px-2 py-1`}>
      <div className="min-w-0 flex-1">
        <p className={`text-[10px] font-medium ${daLoja ? 'text-teal-700' : 'text-gray-600'}`}>↩ Respondendo a {daLoja ? 'mensagem da loja' : 'mensagem do cliente'}</p>
        <p className="text-[12px] text-gray-700 whitespace-pre-wrap break-words line-clamp-4">{texto}</p>
      </div>
      {foto && (
        <a href={c.midia_url!} target="_blank" rel="noreferrer" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.midia_url!} alt="" loading="lazy" className="w-14 h-14 object-cover rounded" />
        </a>
      )}
    </div>
  )
}

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
const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' })
const brl = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const FILTROS: Record<string, string> = { todas: 'Tudo', nao_lidas: 'Não lidas', aguardando: 'Aguardando', hoje: 'Para hoje' }

// ── Visual do WhatsApp ──────────────────────────────────────────────────
const CORES_AVATAR = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-indigo-500', 'bg-orange-500']
function Avatar({ nome, foto, tamanho = 'w-12 h-12 text-base' }: { nome: string; foto?: string | null; tamanho?: string }) {
  // Guarda QUAL link falhou: link novo tenta de novo sem efeito para zerar.
  const [falhou, setFalhou] = useState<string | null>(null)
  // eslint-disable-next-line @next/next/no-img-element
  if (foto && falhou !== foto) return <img src={foto} alt="" referrerPolicy="no-referrer" onError={() => setFalhou(foto)} className={`${tamanho} rounded-full shrink-0 object-cover bg-gray-200`} />
  const iniciais = nome.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
  const cor = CORES_AVATAR[[...nome].reduce((t, ch) => t + ch.charCodeAt(0), 0) % CORES_AVATAR.length]
  return <span className={`${tamanho} ${cor} rounded-full shrink-0 flex items-center justify-center text-white font-medium`}>{iniciais}</span>
}

/** Tiques como no WhatsApp: ✓ enviado, ✓✓ entregue, ✓✓ azul lido; relógio e erro. */
function Tiques({ status, entrega }: { status: string; entrega?: string | null }) {
  if (status === 'erro') return <span className="text-red-500" title="Não enviada">⚠</span>
  if (status === 'pendente') return <span className="text-gray-400" title="Enviando">🕓</span>
  if (entrega === 'lido') return <span className="text-sky-500 tracking-[-3px]" title="Lida">✓✓</span>
  if (entrega === 'entregue') return <span className="text-gray-400 tracking-[-3px]" title="Entregue">✓✓</span>
  return <span className="text-gray-400" title="Enviada">✓</span>
}

/** Prévia da última mensagem na lista. */
function previaDe(m: NonNullable<Conversa['ultima']>): string {
  const tipo = tipoPelaMarca(m.conteudo)
  const icone = tipo === 'foto' ? '📷 ' : tipo === 'audio' ? '🎤 ' : tipo === 'video' ? '🎥 ' : tipo === 'documento' ? '📄 ' : tipo === 'figurinha' ? '🏷 ' : ''
  const texto = semMarca(m.conteudo).replace(/[*~_]/g, '').replace(/\s+/g, ' ').trim()
  return icone + (texto || (tipo === 'foto' ? 'Foto' : tipo === 'audio' ? 'Áudio' : tipo === 'video' ? 'Vídeo' : tipo === 'documento' ? 'Documento' : tipo ? 'Figurinha' : ''))
}

const diaLocal = (s: string) => new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const so_hora = (s: string) => new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
/** "14:32" hoje, "Ontem", ou "14/10/2026" — como na lista do WhatsApp. */
function quandoNaLista(s: string): string {
  const hoje = hojeNaLoja(), d = diaLocal(s)
  if (d === hoje) return so_hora(s)
  const ontem = new Date(`${hoje}T12:00:00Z`); ontem.setUTCDate(ontem.getUTCDate() - 1)
  if (d === ontem.toISOString().slice(0, 10)) return 'Ontem'
  return new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
/** Separador de dia na conversa: Hoje, Ontem ou a data. */
function rotuloDia(d: string): string {
  const hoje = hojeNaLoja()
  if (d === hoje) return 'Hoje'
  const ontem = new Date(`${hoje}T12:00:00Z`); ontem.setUTCDate(ontem.getUTCDate() - 1)
  if (d === ontem.toISOString().slice(0, 10)) return 'Ontem'
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}

const FUNDO_CONVERSA = { backgroundColor: '#efeae2', backgroundImage: 'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)', backgroundSize: '18px 18px' }

type ClienteBusca = { id: string; nome: string; telefone: string | null; whatsapp: string | null; telefone_whatsapp: string | null }

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
  const [painel, setPainel] = useState<'' | 'nova' | 'produto'>('')
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
  const [orcOcupado, setOrcOcupado] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [fichaAberta, setFichaAberta] = useState(true)
  // Nova conversa: cliente do cadastro ou número digitado.
  const [novaConversa, setNovaConversa] = useState(false)
  const [buscaContato, setBuscaContato] = useState('')
  const [clientesAchados, setClientesAchados] = useState<ClienteBusca[]>([])
  const [abrindo, setAbrindo] = useState(false)

  useEffect(() => {
    if (!novaConversa || buscaContato.trim().length < 2) return
    let valido = true
    const t = setTimeout(async () => {
      const termo = buscaContato.trim().replace(/[,()"%*\\]/g, ' ').trim()
      const digitos = termo.replace(/\D/g, '')
      const filtros = [`nome.ilike.%${termo}%`, ...(digitos.length >= 4 ? [`telefone.ilike.%${digitos}%`, `whatsapp.ilike.%${digitos}%`, `telefone_whatsapp.ilike.%${digitos}%`] : [])]
      const { data } = await createClient().from('clientes').select('id, nome, telefone, whatsapp, telefone_whatsapp')
        .eq('empresa_id', empresaId).is('mesclado_em', null).or(filtros.join(',')).order('nome').limit(15)
      if (valido) setClientesAchados((data ?? []) as ClienteBusca[])
    }, 250)
    return () => { valido = false; clearTimeout(t) }
  }, [buscaContato, novaConversa, empresaId])

  // Abre (ou cria) a conversa do número e vai para ela. Nada é enviado aqui.
  async function abrirConversa(telefone: string | null) {
    const tel = telefoneParaWhatsapp(telefone)
    if (!tel) { setErro('Número inválido: informe o DDD e o número.'); return }
    setAbrindo(true); setErro('')
    try {
      const { data, error } = await createClient().rpc('whatsapp_abrir_conversa', { p_empresa: empresaId, p_telefone: tel })
      if (error || !data) { setErro(error?.message ?? 'Não foi possível abrir a conversa.'); return }
      setNovaConversa(false); setBuscaContato(''); setClientesAchados([])
      startTransition(() => router.push(`/dashboard/integracoes/whatsapp/conversas?c=${data}`))
    } finally {
      setAbrindo(false)
    }
  }

  async function acaoOrcamento(o: OrcamentoConversa, acao: 'fechou' | 'desistiu') {
    if (!aberta) return
    if (acao === 'desistiu' && !confirm(`Cancelar o orçamento nº ${o.numero} e marcar a conversa como Perdido?`)) return
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
      setAviso(`Orçamento nº ${o.numero} cancelado.`)
    } finally {
      setOrcOcupado(null)
      router.refresh()
    }
  }
  const listaOrcamentos = aberta ? <OrcamentosDaConversa conversaId={aberta.id} orcamentos={orcamentos} ocupado={orcOcupado} onAcao={acaoOrcamento} /> : null
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
    if (painel !== 'produto' || busca.trim().length < 2) return
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

  const oculto = aberta ? numeroOculto(aberta.telefone) : false

  // FOTO DO PERFIL: a mensagem do cliente já traz; sem ela (ou velha — o link
  // do WhatsApp vence), pergunta à Z-API ao abrir. Uma vez por conversa aberta.
  const [fotoNova, setFotoNova] = useState<Record<string, string>>({})
  const fotoPedida = useRef(new Set<string>())
  const fotoAberta = aberta ? fotoNova[aberta.id] ?? aberta.foto_url ?? null : null
  useEffect(() => {
    if (!aberta || fotoPedida.current.has(aberta.id)) return
    const velha = !aberta.foto_em || Date.now() - new Date(aberta.foto_em).getTime() > 3 * 86_400_000
    if (!velha) return
    const id = aberta.id
    fotoPedida.current.add(id)
    fetch('/api/whatsapp/conversas/foto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contatoId: id }) })
      .then(r => r.json()).then(d => { if (d?.ok && d.foto_url) setFotoNova(f => ({ ...f, [id]: d.foto_url })) }).catch(() => undefined)
  }, [aberta])

  // JUNTAR CONVERSAS da mesma pessoa: o WhatsApp manda umas mensagens com o
  // número e outras com um código no lugar dele, e cada forma virava uma
  // conversa. O sistema junta sozinho quando a Z-API manda os dois juntos;
  // este é o caminho manual para as que já se separaram.
  // Aberto para UMA conversa: trocar de conversa fecha sozinho.
  const [juntarEm, setJuntarEm] = useState<string | null>(null)
  const juntar = Boolean(aberta && juntarEm === aberta.id)
  const setJuntar = (f: (j: boolean) => boolean) => setJuntarEm(f(juntar) && aberta ? aberta.id : null)
  const [buscaJuntar, setBuscaJuntar] = useState('')
  const [juntando, setJuntando] = useState(false)
  const candidatasJuntar = !aberta ? [] : conversas
    .filter(c => c.id !== aberta.id && (oculto || numeroOculto(c.telefone)))
    .filter(c => !buscaJuntar.trim() || nomeDe(c).toLowerCase().includes(buscaJuntar.trim().toLowerCase()) || c.telefone.includes(buscaJuntar.replace(/\D/g, '') || '§'))
    .slice(0, 8)
  async function juntarCom(alvo: Conversa) {
    if (!aberta) return
    if (!confirm(`Juntar esta conversa com "${nomeDe(alvo)}"? As mensagens das duas ficam numa conversa só. Não dá para desfazer.`)) return
    setJuntando(true)
    const r = await fetch('/api/whatsapp/conversas/juntar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: aberta.id, b: alvo.id }) })
      .then(x => x.json()).catch(() => ({ error: 'Falha de conexão' }))
    setJuntando(false)
    if (!r.ok) { alert(r.error ?? 'Não foi possível juntar'); return }
    setJuntarEm(null)
    ir({ c: r.para })
  }
  const painelJuntar = !aberta ? null : (
    <div className="px-4 py-3 border-b-8 border-[#f0f2f5] space-y-2">
      <p className="text-xs text-gray-600">{oculto
        ? 'Escolha a conversa com o número desta pessoa. Tudo passa para lá.'
        : 'Escolha a conversa sem número (código do WhatsApp) desta mesma pessoa. Tudo vem para cá.'}</p>
      <input autoFocus value={buscaJuntar} onChange={e => setBuscaJuntar(e.target.value)} placeholder="Nome ou telefone…"
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" />
      {candidatasJuntar.length === 0
        ? <p className="text-xs text-gray-400">Nenhuma conversa {oculto ? '' : 'sem número '}com esse nome na lista.</p>
        : candidatasJuntar.map(c => (
          <button key={c.id} disabled={juntando} onClick={() => juntarCom(c)}
            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-[#f5f6f6] disabled:opacity-50">
            <Avatar nome={nomeDe(c)} foto={c.foto_url} tamanho="w-8 h-8 text-xs" />
            <span className="min-w-0">
              <span className="block text-sm text-gray-900 truncate">{nomeDe(c)}</span>
              <span className="block text-[11px] text-gray-500">{numeroOculto(c.telefone) ? 'número oculto' : formatarTelefone(c.telefone)}</span>
            </span>
          </button>
        ))}
    </div>
  )

  if (indisponivel) return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
      A caixa de entrada ainda não foi ativada no banco. Peça para aplicar as migrações <code>20261015200000_whatsapp_conversas.sql</code> e <code>20261016120000_whatsapp_funil.sql</code>.
    </div>
  )

  const telDigitado = telefoneParaWhatsapp(buscaContato)
  const dias = mensagens.map(m => diaLocal(m.enviado_em ?? m.created_at))

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-[360px_1fr] ${aberta && fichaAberta ? 'xl:grid-cols-[360px_1fr_300px]' : ''} h-[calc(100vh-110px)] min-h-[520px] bg-white border border-gray-200 rounded-xl overflow-hidden`}>

      {/* ── Lista de conversas ── */}
      <aside className="flex flex-col min-h-0 border-r border-gray-200 bg-white">
        {novaConversa ? <>
          <div className="bg-[#008069] text-white px-4 pt-6 pb-3 flex items-center gap-4">
            <button onClick={() => { setNovaConversa(false); setBuscaContato(''); setErro('') }} className="text-xl leading-none" title="Voltar">←</button>
            <span className="font-medium">Nova conversa</span>
          </div>
          <div className="p-2">
            <div className="flex items-center gap-2 bg-[#f0f2f5] rounded-lg px-3 py-1.5">
              <span className="text-gray-500 text-sm">🔍</span>
              <input value={buscaContato} onChange={e => setBuscaContato(e.target.value)} autoFocus
                placeholder="Nome do cliente ou número com DDD" className="flex-1 bg-transparent text-sm py-1 focus:outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {telDigitado && (
              <button onClick={() => abrirConversa(telDigitado)} disabled={abrindo}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#f5f6f6] text-left disabled:opacity-50">
                <span className="w-12 h-12 rounded-full bg-[#00a884] text-white flex items-center justify-center text-xl shrink-0">💬</span>
                <span><span className="block text-[15px] text-gray-900">Conversar com {formatarTelefone(telDigitado)}</span>
                  <span className="block text-xs text-gray-500">Número digitado</span></span>
              </button>
            )}
            {clientesAchados.length > 0 && <p className="px-4 pt-3 pb-1 text-[13px] text-[#008069]">Clientes do cadastro</p>}
            {clientesAchados.map(c => {
              const tel = c.whatsapp || c.telefone_whatsapp || c.telefone
              const valido = telefoneParaWhatsapp(tel)
              return (
                <button key={c.id} onClick={() => abrirConversa(tel)} disabled={!valido || abrindo}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[#f5f6f6] text-left disabled:opacity-50 disabled:cursor-not-allowed">
                  <Avatar nome={c.nome} />
                  <span className="min-w-0 flex-1 border-b border-gray-100 pb-2">
                    <span className="block text-[15px] text-gray-900 truncate">{c.nome}</span>
                    <span className="block text-xs text-gray-500">{valido ? formatarTelefone(valido) : 'sem celular válido no cadastro'}</span>
                  </span>
                </button>
              )
            })}
            {buscaContato.trim().length >= 2 && !telDigitado && clientesAchados.length === 0 && (
              <p className="p-6 text-sm text-gray-400 text-center">Nenhum cliente encontrado. Digite o número com DDD para conversar com quem não está no cadastro.</p>
            )}
            {buscaContato.trim().length < 2 && <p className="p-6 text-sm text-gray-400 text-center">Busque um cliente pelo nome ou digite um número com DDD.<br />A conversa abre aqui; nada é enviado até você escrever.</p>}
            {erro && <p className="px-4 text-xs text-red-600">{erro}</p>}
          </div>
        </> : <>
          <div className="bg-[#f0f2f5] px-4 h-14 flex items-center justify-between shrink-0">
            <span className="text-lg font-semibold text-gray-800">Conversas</span>
            <div className="flex items-center gap-1">
              <a href="/dashboard/integracoes/whatsapp/contatos" title="Contatos" className="w-9 h-9 rounded-full hover:bg-black/5 flex items-center justify-center text-gray-600">👥</a>
              <button onClick={() => { setNovaConversa(true); setErro('') }} title="Nova conversa"
                className="w-9 h-9 rounded-full hover:bg-black/5 flex items-center justify-center text-gray-700 text-xl">＋</button>
            </div>
          </div>
          <div className="px-3 pt-2 pb-1 space-y-2 shrink-0">
            <div className="flex items-center gap-2 bg-[#f0f2f5] rounded-lg px-3 py-1.5">
              <span className="text-gray-500 text-sm">🔍</span>
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ir({ q, c: null })}
                placeholder="Pesquisar nome ou número" className="flex-1 bg-transparent text-sm py-1 focus:outline-none" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 items-center">
              {Object.entries(FILTROS).map(([k, v]) => {
                const n = k === 'hoje' ? contagem.hoje : k === 'aguardando' ? contagem.aguardando : k === 'nao_lidas' ? contagem.naoLidas : 0
                return (
                  <button key={k} onClick={() => ir({ f: k, c: null })}
                    className={`text-[13px] px-3 py-1 rounded-full whitespace-nowrap ${filtros.f === k ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#f0f2f5] text-gray-600 hover:bg-[#e9edef]'}`}>
                    {v}{n ? ` ${n}` : ''}
                  </button>
                )
              })}
              <select value={filtros.e ?? ''} onChange={e => ir({ e: e.target.value || null, c: null })}
                className={`text-[13px] rounded-full px-2 py-1 border-0 cursor-pointer ${filtros.e ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#f0f2f5] text-gray-600'}`}>
                <option value="">Etapa</option>
                {ETAPAS.map(e => <option key={e.id} value={e.id}>{e.rotulo} ({contagem.etapas[e.id] ?? 0})</option>)}
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversas.length === 0 && <p className="p-6 text-sm text-gray-400 text-center">Nenhuma conversa aqui.</p>}
            {conversas.map(c => {
              const nome = nomeDe(c)
              const daLoja = c.ultima ? !doCliente(c.ultima.tipo) : false
              return (
                <button key={c.id} onClick={() => { setLembrete(null); setSugestao(null); setMenu(false); ir({ c: c.id }) }}
                  className={`w-full text-left flex items-center gap-3 pl-3 hover:bg-[#f5f6f6] ${aberta?.id === c.id ? 'bg-[#f0f2f5]' : ''}`}>
                  <Avatar nome={nome} foto={c.foto_url} />
                  <span className="min-w-0 flex-1 border-b border-gray-100 py-2.5 pr-3">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex items-baseline gap-1.5">
                        <span className={`truncate text-[15px] ${c.nao_lida ? 'font-semibold text-gray-900' : 'text-gray-900'}`}>{nome}</span>
                        {c.cliente_id && <span title="Cliente cadastrado" className="shrink-0 text-[10px] leading-4 px-1.5 rounded-full bg-emerald-100 text-emerald-800">cliente</span>}
                      </span>
                      {c.ultima_atividade && <span className={`text-xs whitespace-nowrap ${c.nao_lida ? 'text-[#00a884] font-medium' : 'text-gray-500'}`}>{quandoNaLista(c.ultima_atividade)}</span>}
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      <span className={`truncate text-[13px] flex-1 ${c.nao_lida ? 'text-gray-800' : 'text-gray-500'}`}>
                        {daLoja && c.ultima && <span className="mr-1 text-xs"><Tiques status={c.ultima.status} entrega={c.ultima.status_entrega} /></span>}
                        {c.ultima ? previaDe(c.ultima) : (c.etapa !== 'novo' ? etapaDe(c.etapa).rotulo : '')}
                      </span>
                      {c.retorno_vencido && <span title={`Retorno ${c.retorno_em ? rotuloRetorno(c.retorno_em) : ''}`} className="text-xs">🔔</span>}
                      {c.orcamento_parado && <span title="Orçamento sem resposta há 3 dias ou mais" className="text-xs">⏳</span>}
                      {c.etapa !== 'novo' && <span title={etapaDe(c.etapa).rotulo} className={`w-2 h-2 rounded-full ${etapaDe(c.etapa).cor.split(' ')[0].replace('-100', '-400')}`} />}
                      {c.nao_lida
                        ? <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25d366] text-white text-[11px] font-semibold flex items-center justify-center">1</span>
                        : c.aguardando && c.ultima_entrada_em && <span className="text-[11px] text-amber-700 whitespace-nowrap" title="Esperando resposta da loja">{tempoDeEspera(c.ultima_entrada_em)}</span>}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </>}
      </aside>

      {/* ── Conversa aberta ── */}
      <section className="flex flex-col min-h-0 min-w-0">
        {!aberta ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#f0f2f5] border-b-4 border-[#25d366]">
            <span className="text-6xl mb-4">💬</span>
            <p className="text-2xl font-light text-gray-700">Caixa de entrada do WhatsApp</p>
            <p className="text-sm text-gray-500 mt-2 max-w-md">Escolha uma conversa à esquerda ou comece uma nova com um cliente do cadastro ou um número.</p>
            <button onClick={() => setNovaConversa(true)} className="mt-6 px-5 py-2 rounded-full bg-[#008069] text-white text-sm hover:bg-[#017561]">＋ Nova conversa</button>
          </div>
        ) : <>
          {/* Cabeçalho */}
          <div className="bg-[#f0f2f5] px-4 h-14 flex items-center gap-3 shrink-0 border-l border-gray-200">
            <button onClick={() => setFichaAberta(v => !v)} className="flex items-center gap-3 min-w-0 flex-1 text-left" title="Dados do contato">
              <Avatar nome={nomeDe(aberta)} foto={fotoAberta} tamanho="w-10 h-10 text-sm" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[15px] text-gray-900 min-w-0">
                  <span className="truncate">{nomeDe(aberta)}</span>
                  {aberta.cliente_id && <span title="Cliente cadastrado" className="shrink-0 text-[10px] leading-4 px-1.5 rounded-full bg-emerald-100 text-emerald-800">cliente</span>}
                </span>
                <span className="block text-xs text-gray-500 truncate">
                  {oculto ? 'Número oculto pelo WhatsApp' : formatarTelefone(aberta.telefone)}
                  {aberta.origem_codigo ? ` · 📣 post ${aberta.origem_codigo}` : ''}
                  {aberta.orcamento_parado ? ' · ⏳ orçamento parado' : ''}
                </span>
              </span>
            </button>
            <select value={aberta.etapa} onChange={e => mudarEtapa(e.target.value)} title="Etapa do atendimento"
              className={`text-xs rounded-full px-2.5 py-1 border-0 cursor-pointer ${etapaDe(aberta.etapa).cor}`}>
              {ETAPAS.map(e => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
            </select>
            <button onClick={() => setLembrete(l => l ? null : { dia: aberta.retorno_em ?? atalhosDeRetorno()[0].dia, nota: aberta.retorno_nota ?? '' })}
              title={aberta.retorno_em ? `Retornar ${rotuloRetorno(aberta.retorno_em)}${aberta.retorno_nota ? ` · ${aberta.retorno_nota}` : ''}` : 'Lembrete de retorno'}
              className={`w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 ${aberta.retorno_vencido ? 'text-orange-600' : aberta.retorno_em ? 'text-[#008069]' : 'text-gray-500'}`}>🔔</button>
            {!oculto && <a href={`https://wa.me/${aberta.telefone}`} target="_blank" rel="noreferrer" title="Abrir no WhatsApp"
              className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 text-gray-500">↗</a>}
            <button onClick={() => setFichaAberta(v => !v)} title="Dados do contato" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 text-gray-600">ⓘ</button>
          </div>

          {lembrete && (
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 space-y-1.5 shrink-0">
              <p className="text-xs font-medium text-gray-700">Lembrete de retorno <span className="font-normal text-gray-400">— só um aviso na tela; nada é enviado sozinho</span></p>
              <div className="flex gap-1 flex-wrap items-center">
                {atalhosDeRetorno().map(a => (
                  <button key={a.rotulo} onClick={() => setLembrete(l => l && { ...l, dia: a.dia })}
                    className={`text-xs px-2.5 py-0.5 rounded-full ${lembrete.dia === a.dia ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#f0f2f5] text-gray-700'}`}>{a.rotulo}</button>
                ))}
                <input type="date" value={lembrete.dia} onChange={e => setLembrete(l => l && { ...l, dia: e.target.value })}
                  className="text-xs border border-gray-300 rounded px-1.5 py-0.5" />
                <input value={lembrete.nota} onChange={e => setLembrete(l => l && { ...l, nota: e.target.value })} maxLength={200}
                  placeholder="Nota (ex.: ver se fechou o orçamento)" className="flex-1 min-w-[160px] border border-gray-300 rounded px-2 py-0.5 text-xs" />
              </div>
              <div className="flex justify-end gap-2">
                {aberta.retorno_em && <button onClick={() => salvarLembrete(null)} className="mr-auto text-xs text-gray-600 hover:underline">Concluir lembrete</button>}
                <button onClick={() => setLembrete(null)} className="text-xs px-2 py-1 text-gray-600">Cancelar</button>
                <button onClick={() => salvarLembrete(lembrete)} disabled={!lembrete.dia} className="text-xs px-3 py-1 rounded-full bg-[#008069] text-white disabled:opacity-50">Salvar</button>
              </div>
            </div>
          )}

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-[5%] py-3 space-y-1" style={FUNDO_CONVERSA}>
            {mensagens.length === 200 && <p className="text-center"><span className="inline-block text-[11px] bg-white/80 text-gray-500 rounded-md px-2 py-0.5 shadow-sm">Mostrando as últimas 200 mensagens</span></p>}
            {mensagens.length === 0 && (
              <p className="text-center pt-8"><span className="inline-block text-xs bg-[#fff5c4] text-gray-700 rounded-lg px-3 py-1.5 shadow-sm">Conversa nova. Escreva abaixo para começar — sai pelo WhatsApp da loja.</span></p>
            )}
            {mensagens.map((m, i) => {
              const cliente = doCliente(m.tipo), rotulo = rotuloSaida(m.tipo)
              const novoDia = i === 0 || dias[i] !== dias[i - 1]
              const mesmoLado = i > 0 && !novoDia && doCliente(mensagens[i - 1].tipo) === cliente
              const textoMsg = m.midia_url ? semMarca(m.conteudo) : m.conteudo
              return (
                <div key={m.id}>
                  {novoDia && <p className="text-center my-2"><span className="inline-block text-[12px] bg-white text-gray-600 rounded-md px-3 py-1 shadow-sm">{rotuloDia(dias[i])}</span></p>}
                  <div className={`flex ${cliente ? 'justify-start' : 'justify-end'} ${mesmoLado ? 'mt-0.5' : 'mt-2'}`}>
                    <div className={`relative max-w-[65%] rounded-lg px-2.5 pt-1.5 pb-1 text-[14.2px] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] ${
                      cliente ? 'bg-white text-gray-900' : m.status === 'erro' ? 'bg-red-50 text-red-900' : 'bg-[#d9fdd3] text-gray-900'
                    } ${!mesmoLado ? (cliente ? 'rounded-tl-none' : 'rounded-tr-none') : ''}`}>
                      {!mesmoLado && (
                        <span className={`absolute top-0 w-2 h-3 ${cliente ? '-left-2' : '-right-2'}`} style={{
                          background: cliente ? '#fff' : m.status === 'erro' ? '#fef2f2' : '#d9fdd3',
                          clipPath: cliente ? 'polygon(100% 0, 0 0, 100% 100%)' : 'polygon(0 0, 100% 0, 0 100%)',
                        }} />
                      )}
                      {rotulo && <p className="text-[11px] font-medium text-[#008069] mb-0.5">{rotulo}</p>}
                      {m.citada && <Citacao c={m.citada} />}
                      <Midia m={m} />
                      {textoMsg && <span className="whitespace-pre-wrap break-words">{textoMsg}</span>}
                      <span className="float-right ml-3 mt-1.5 -mb-0.5 text-[11px] text-gray-500 flex items-center gap-1 select-none">
                        {!cliente && m.operador_nome && <span className="text-gray-400">{m.operador_nome.split('@')[0].split(' ')[0]}</span>}
                        {so_hora(m.enviado_em ?? m.created_at)}
                        {!cliente && <Tiques status={m.status} entrega={m.status_entrega} />}
                      </span>
                      {m.status === 'erro' && <p className="clear-both text-[11px] text-red-600">Não enviada{m.erro ? `: ${m.erro}` : ''}</p>}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={fim} />
          </div>

          {/* Rodapé: respostas rápidas, painéis e a barra de digitação */}
          <div className="bg-[#f0f2f5] shrink-0">
            {oculto ? (
              <div className="px-4 py-3 text-xs text-gray-600">
                <p>O WhatsApp escondeu o número desta pessoa: responda pelo celular. Ao pedir o telefone dela, cadastre como cliente.
                  {' '}<button onClick={() => { setJuntar(j => !j); setBuscaJuntar('') }} className="text-[#008069] hover:underline">É a mesma pessoa de outra conversa? Juntar</button></p>
                {juntar && <div className="mt-2 bg-white rounded-lg border border-gray-200">{painelJuntar}</div>}
              </div>
            ) : <>
              {(painel || sugestao || anexo) && (
                <div className="px-4 pt-3 space-y-2 max-h-[45vh] overflow-y-auto">
                  {painel === 'nova' && (
                    <div className="p-3 rounded-lg bg-white shadow-sm space-y-1.5">
                      <p className="text-xs font-medium text-gray-700">Nova resposta rápida</p>
                      <input value={nova.nome} onChange={e => setNova(n => ({ ...n, nome: e.target.value }))} maxLength={40}
                        placeholder="Nome do botão (ex.: Entrega)" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                      <textarea value={nova.conteudo} onChange={e => setNova(n => ({ ...n, conteudo: e.target.value }))} rows={2} maxLength={1000}
                        placeholder="Texto. Use {nome} para o primeiro nome e {loja} para o nome da loja." className="w-full border border-gray-300 rounded px-2 py-1 text-xs resize-none" />
                      <div className="flex justify-between items-center">
                        <a href="/dashboard/integracoes/whatsapp" className="text-[11px] text-gray-500 hover:underline">Editar ou apagar em Modelos</a>
                        <div className="flex gap-2">
                          <button onClick={() => setPainel('')} className="text-xs px-2 py-1 text-gray-600">Fechar</button>
                          <button onClick={salvarResposta} disabled={!nova.nome.trim() || !nova.conteudo.trim()}
                            className="text-xs px-3 py-1 rounded-full bg-[#008069] text-white disabled:opacity-50">Salvar</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {painel === 'produto' && (
                    <div className="p-3 rounded-lg bg-white shadow-sm">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium text-gray-700">Enviar produto</p>
                        <button onClick={() => { setPainel(''); setEscolhido(null) }} className="text-xs text-gray-500">✕</button>
                      </div>
                      <input value={busca} onChange={e => setBusca(e.target.value)} autoFocus
                        onKeyDown={e => {
                          if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado(i => Math.min(i + 1, achados.length - 1)) }
                          else if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado(i => Math.max(i - 1, 0)) }
                          else if (e.key === 'Enter' && achados[marcado]) { e.preventDefault(); setEscolhido(achados[marcado]) }
                        }}
                        placeholder="Nome, marca, código ou código de barras — como no PDV" className="w-full bg-[#f0f2f5] rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                      {buscando && <p className="text-[11px] text-gray-400 mt-1">Buscando…</p>}
                      {!buscando && busca.trim().length >= 2 && achados.length === 0 && <p className="text-[11px] text-gray-400 mt-1">Nenhum produto ativo encontrado.</p>}
                      {achados.length > 0 && !escolhido && (
                        <div className="mt-1.5 max-h-56 overflow-y-auto divide-y divide-gray-100">
                          {achados.map((p, i) => (
                            <button key={p.id} onClick={() => setEscolhido(p)} onMouseEnter={() => setMarcado(i)}
                              className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 rounded ${i === marcado ? 'bg-[#f0f2f5]' : ''}`}>
                              {p.foto_url
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={p.foto_url} alt="" loading="lazy" className="w-9 h-9 object-cover rounded shrink-0" />
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
                        <div className="mt-2">
                          <p className="text-[11px] text-gray-500 mb-1">Vai com a foto principal do produto (se houver) e esta legenda:</p>
                          <p className="text-xs whitespace-pre-wrap bg-[#d9fdd3] rounded-lg p-2">{legendaDoProduto(escolhido)}</p>
                          {escolhido.controlar_estoque && Number(escolhido.estoque ?? 0) <= 0 && <p className="text-[11px] text-red-600 mt-1">Sem estoque no sistema.</p>}
                          <div className="flex justify-end gap-2 mt-2">
                            <button onClick={() => setEscolhido(null)} className="text-xs px-2 py-1 text-gray-600">Voltar</button>
                            <button onClick={enviarProduto} disabled={enviando} className="text-xs px-3 py-1 rounded-full bg-[#008069] text-white disabled:opacity-50">{enviando ? 'Enviando…' : 'Enviar ao cliente'}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {sugestao && (
                    <div className="p-3 rounded-lg bg-white shadow-sm border-l-4 border-violet-500">
                      <p className="text-[11px] font-medium text-violet-700 mb-1">✨ Sugestão da IA — leia antes de usar</p>
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
                          className="text-xs px-3 py-1 rounded-full bg-violet-600 text-white">Usar na caixa de texto</button>
                      </div>
                    </div>
                  )}

                  {anexo && (
                    <div className="p-3 rounded-lg bg-white shadow-sm flex items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={anexo.previa} alt="" className="max-h-28 rounded-lg" />
                      <div className="text-xs text-gray-600">
                        <p>Imagem pronta. O texto da caixa vai como legenda.</p>
                        <button onClick={tirarAnexo} className="text-red-600 hover:underline mt-1">Tirar imagem</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {respostas.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto px-4 pt-2">
                  {respostas.map(r => (
                    <button key={r.id ?? r.nome} onClick={() => usarResposta(r)} title={r.conteudo}
                      className="text-xs px-3 py-1 rounded-full bg-white text-gray-700 hover:bg-[#d9fdd3] whitespace-nowrap shadow-sm">{r.nome}</button>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-2 px-4 py-2.5">
                <div className="relative">
                  <button onClick={() => setMenu(v => !v)} title="Anexar e ações"
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-2xl text-gray-600 hover:bg-black/5 transition-transform ${menu ? 'rotate-45' : ''}`}>＋</button>
                  {menu && (
                    <div className="absolute bottom-12 left-0 z-20 w-60 bg-white rounded-xl shadow-xl py-2 text-sm">
                      <button onClick={() => { setMenu(false); seletor.current?.click() }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#f5f6f6]"><span className="w-8 h-8 rounded-full bg-[#7f66ff] text-white flex items-center justify-center">🖼</span>Imagem <span className="ml-auto text-[11px] text-gray-400">ou Ctrl+V</span></button>
                      <button onClick={() => { setMenu(false); setPainel('produto') }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#f5f6f6]"><span className="w-8 h-8 rounded-full bg-[#00a884] text-white flex items-center justify-center">🛍</span>Produto do estoque</button>
                      {/* Orçamento no PDV (preço, promoção, logística) e negociação na tela de Orçamentos — a conversa só faz a ponte. */}
                      <a href={`/pdv?conversa=${aberta.id}`} target="_blank" rel="noreferrer" onClick={() => setMenu(false)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#f5f6f6]"><span className="w-8 h-8 rounded-full bg-[#ffbc38] text-white flex items-center justify-center">🧾</span>Orçamento no PDV <span className="ml-auto text-[11px] text-gray-400">↗</span></a>
                      <button onClick={() => { setMenu(false); setPainel('nova') }} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[#f5f6f6]"><span className="w-8 h-8 rounded-full bg-[#53bdeb] text-white flex items-center justify-center">⚡</span>Nova resposta rápida</button>
                    </div>
                  )}
                </div>
                <input ref={seletor} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
                  onChange={e => { anexar(e.target.files?.[0]); e.target.value = '' }} />
                <button onClick={sugerirResposta} disabled={sugerindo} title="Sugerir resposta com IA (você revisa antes de enviar)"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg hover:bg-black/5 disabled:opacity-50">{sugerindo ? '⏳' : '✨'}</button>
                <textarea value={texto} onChange={e => setTexto(e.target.value)} maxLength={4000}
                  rows={Math.min(5, Math.max(1, texto.split('\n').length))}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); responder() } }}
                  onPaste={e => {
                    const img = Array.from(e.clipboardData.items).find(i => i.kind === 'file' && i.type.startsWith('image/'))
                    if (img) { e.preventDefault(); anexar(img.getAsFile()) }
                  }}
                  placeholder={anexo ? 'Legenda da imagem (opcional)' : 'Digite uma mensagem'}
                  className="flex-1 bg-white rounded-lg px-3 py-2.5 text-[15px] resize-none focus:outline-none leading-5" />
                <button onClick={responder} disabled={enviando || (!texto.trim() && !anexo)} title="Enviar (Enter)"
                  className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008f72] disabled:bg-gray-300 text-white flex items-center justify-center">
                  {enviando ? '…' : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" /></svg>}
                </button>
              </div>
              {(erro || aviso) && <p className={`px-4 pb-2 text-xs ${erro ? 'text-red-600' : 'text-[#008069]'}`}>{erro || aviso}</p>}
            </>}
          </div>
        </>}
      </section>

      {/* ── Dados do contato (ficha) ── */}
      {aberta && fichaAberta && (
        <aside className="hidden xl:flex flex-col min-h-0 border-l border-gray-200 bg-white">
          <div className="bg-[#f0f2f5] px-4 h-14 flex items-center gap-4 shrink-0">
            <button onClick={() => setFichaAberta(false)} className="text-gray-600 text-lg" title="Fechar">✕</button>
            <span className="text-[15px] text-gray-800">Dados do contato</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col items-center py-5 border-b-8 border-[#f0f2f5]">
              <Avatar nome={nomeDe(aberta)} foto={fotoAberta} tamanho="w-24 h-24 text-3xl" />
              <p className="mt-3 text-lg text-gray-900 text-center px-3">{nomeDe(aberta)}</p>
              <p className="text-sm text-gray-500">{oculto ? 'Número oculto' : formatarTelefone(aberta.telefone)}</p>
              {aberta.cliente_nome && aberta.nome_whatsapp && <p className="text-xs text-gray-400 mt-0.5">no WhatsApp: {aberta.nome_whatsapp}</p>}
              {aberta.origem_codigo && <p className="mt-2 text-xs px-2.5 py-0.5 rounded-full bg-violet-100 text-violet-800">📣 Veio da publicação {aberta.origem_codigo}{aberta.origem_em ? ` · ${dia(aberta.origem_em)}` : ''}</p>}
              {aberta.retorno_em && <p className={`mt-1.5 text-xs ${aberta.retorno_vencido ? 'text-orange-700' : 'text-gray-500'}`}>🔔 Retornar {rotuloRetorno(aberta.retorno_em)}{aberta.retorno_nota ? ` · ${aberta.retorno_nota}` : ''}</p>}
              <button onClick={() => { setJuntar(j => !j); setBuscaJuntar('') }} className="mt-2 text-xs text-[#008069] hover:underline">⤵ É a mesma pessoa de outra conversa? Juntar</button>
            </div>
            {juntar && painelJuntar}
            <FichaCliente aberta={aberta} ficha={ficha} orcamentos={listaOrcamentos} />
          </div>
        </aside>
      )}
    </div>
  )
}

type AcaoOrcamento = 'fechou' | 'desistiu'

function OrcamentosDaConversa({ conversaId, orcamentos, ocupado, onAcao }: { conversaId: string; orcamentos: OrcamentoConversa[]; ocupado: string | null; onAcao: (o: OrcamentoConversa, acao: AcaoOrcamento) => void }) {
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
                  <a href={`/dashboard/orcamentos?abrir=${o.id}&conversa=${conversaId}`} target="_blank" rel="noreferrer"
                    title="Tela de negociação: condições de pagamento, parcelamento e envio por WhatsApp"
                    className="px-2 py-0.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50">Abrir negociação ↗</a>
                  <button onClick={() => onAcao(o, 'desistiu')} disabled={ocupado === o.id}
                    className="px-2 py-0.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50">Desistiu</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <a href={`/pdv?conversa=${conversaId}`} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">+ Novo orçamento no PDV</a>
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
