'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Config = {
  id?: string; nome: string; ativo: boolean
  instance_id: string; token: string; client_token: string; url_base: string
  numero_whatsapp: string; nome_exibido: string; webhook_url: string; numero_gestor: string
  status_conexao: string; ultima_sincronizacao: string | null; ultima_mensagem_enviada: string | null
  ambiente: string; observacoes: string
  texto_cupom: string; texto_cobranca: string; texto_orcamento: string
  texto_confirmacao_pag: string; texto_lista_produtos: string; texto_lembrete_venc: string; texto_pos_venda: string
  assinatura: string; saudacao: string; rodape: string; horario_atendimento: string
  /** Por onde as mensagens saem. Ver a aba "Envio e mensagens". */
  canal_envio: 'whatsapp_web' | 'zapi'
  /**
   * Modelo da mensagem do link de produto.
   * NULO = usar o padrão do código; vazio = o gestor apagou de propósito.
   * A distinção existe para o padrão poder mudar no código e alcançar quem
   * nunca escolheu texto nenhum.
   */
  texto_produto_link: string | null
}

type Modelo = { id: string; nome: string; tipo: string; conteudo: string; ativo: boolean }

const TIPOS_MODELO = [
  'cupom', 'orcamento', 'pedido', 'cobranca', 'lembrete_vencimento',
  'confirmacao_pagamento', 'lista_produtos', 'produto_individual',
  'follow_up', 'aniversario', 'pos_venda', 'aviso_retirada', 'promocao',
]

const VARIAVEIS = [
  '{nome_cliente}', '{telefone_cliente}', '{nome_empresa}', '{telefone_empresa}',
  '{numero_pedido}', '{data_pedido}', '{valor_total}', '{valor_pago}',
  '{valor_pendente}', '{vencimento}', '{produtos}', '{vendedor}', '{credito_cliente}',
]

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    conectado:    { cls: 'bg-green-100 text-green-700 border-green-200',  label: '● Conectado' },
    desconectado: { cls: 'bg-gray-100 text-gray-500 border-gray-200',     label: '○ Desconectado' },
    erro:         { cls: 'bg-red-100 text-red-600 border-red-200',         label: '✕ Erro' },
  }
  const s = map[status] ?? map.desconectado
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${s.cls}`}>{s.label}</span>
}

import { aplicarModelo, exemploDe, PADRAO_PRODUTO_LINK, VARIAVEIS_PRODUTO_LINK } from '@/lib/mensagens/modelo'

const BLANK: Config = {
  nome: 'WhatsApp Principal', ativo: false,
  instance_id: '', token: '', client_token: '', url_base: 'https://api.z-api.io',
  numero_whatsapp: '', nome_exibido: '', webhook_url: '', numero_gestor: '',
  status_conexao: 'desconectado', ultima_sincronizacao: null, ultima_mensagem_enviada: null,
  ambiente: 'producao', observacoes: '',
  texto_cupom: 'Olá {nome_cliente}! 👋\nAqui está o seu cupom de compra na *{nome_empresa}*.\n\n🛍️ *Resumo:*\n{produtos}\n\n💰 *Total:* {valor_total}\n📅 {data_pedido}\n\nObrigado! 🙏',
  texto_cobranca: 'Olá {nome_cliente}! 👋\nVocê tem um valor em aberto na *{nome_empresa}*.\n\n💰 *Valor:* {valor_pendente}\n📅 *Vencimento:* {vencimento}\n\n📞 {telefone_empresa}',
  texto_orcamento: 'Olá {nome_cliente}! 👋\nSeu orçamento da *{nome_empresa}* está pronto.\n\n📋 *Orç. nº {numero_pedido}*\n💰 *Total:* {valor_total}\n\n{produtos}\n\n📞 {telefone_empresa}',
  texto_confirmacao_pag: 'Olá {nome_cliente}! ✅\nPagamento de {valor_pago} recebido na *{nome_empresa}*.\n\nObrigado! 🙏',
  texto_lista_produtos: '🛍️ *{nome_empresa}*\n\n{produtos}\n\n📞 {telefone_empresa}',
  texto_lembrete_venc: 'Olá {nome_cliente}! ⏰\nSeu pagamento na *{nome_empresa}* vence em *{vencimento}*.\n\n💰 {valor_pendente}\n\n📞 {telefone_empresa}',
  texto_pos_venda: 'Olá {nome_cliente}! 😊\nObrigado pela compra na *{nome_empresa}*! Qualquer dúvida, estamos à disposição.\n📞 {telefone_empresa}',
  assinatura: '', saudacao: 'Olá {nome_cliente}! 👋', rodape: '', horario_atendimento: '',
  canal_envio: 'whatsapp_web', texto_produto_link: null,
}

export default function WhatsAppConfigClient({
  empresaId, empresaNome, empresaTelefone, configInicial, modelosIniciais,
}: {
  empresaId: string; empresaNome: string; empresaTelefone: string
  configInicial: Config | null; modelosIniciais: Modelo[]
}) {
  const sb = createClient()
  const [aba, setAba] = useState<'conexao' | 'envio' | 'templates' | 'modelos'>('conexao')
  const [cfg, setCfg] = useState<Config>(configInicial ?? { ...BLANK })
  const [modelos, setModelos] = useState<Modelo[]>(modelosIniciais)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  // Testes de conexão
  const [testando, setTestando] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [carregandoQr, setCarregandoQr] = useState(false)
  const [telTeste, setTelTeste] = useState('')

  // Modal modelo
  const [modalModelo, setModalModelo] = useState(false)
  const [modeloEdit, setModeloEdit] = useState<Partial<Modelo>>({ nome: '', tipo: 'cupom', conteudo: '', ativo: true })
  const [salvandoModelo, setSalvandoModelo] = useState(false)

  function upd(field: keyof Config, value: any) {
    setCfg(prev => ({ ...prev, [field]: value }))
  }

  function toast(tipo: 'ok' | 'erro', texto: string) {
    setMsg({ tipo, texto })
    setTimeout(() => setMsg(null), 4000)
  }

  async function salvar() {
    setSalvando(true)
    const payload = { ...cfg, empresa_id: empresaId, updated_at: new Date().toISOString() }
    const { error } = cfg.id
      ? await sb.from('whatsapp_config').update(payload).eq('id', cfg.id)
      : await sb.from('whatsapp_config').insert(payload).select('id').single()
        .then(async r => {
          if (!r.error && r.data) setCfg(prev => ({ ...prev, id: r.data.id }))
          return r
        })
    setSalvando(false)
    if (error) toast('erro', error.message)
    else toast('ok', 'Configuração salva com sucesso!')
  }

  async function testarConexao() {
    if (!cfg.instance_id || !cfg.token) {
      toast('erro', 'Preencha o Instance ID e o Token antes de testar.')
      return
    }
    setTestando(true)
    try {
      // Passa os valores atuais do formulário — não precisa salvar antes
      const params = new URLSearchParams({
        instance_id: cfg.instance_id,
        token: cfg.token,
        ...(cfg.client_token ? { client_token: cfg.client_token } : {}),
        url_base: cfg.url_base || 'https://api.z-api.io',
      })
      const res = await fetch(`/api/whatsapp/status?${params}`)
      const data = await res.json()
      const novoStatus = data.connected ? 'conectado' : 'desconectado'
      setCfg(prev => ({ ...prev, status_conexao: novoStatus }))
      toast(
        data.connected ? 'ok' : 'erro',
        data.connected
          ? '✅ WhatsApp conectado!'
          : `Desconectado${data.error ? ': ' + data.error : ' — verifique Instance ID e Token'}`,
      )
    } catch {
      toast('erro', 'Erro ao testar conexão')
    }
    setTestando(false)
  }

  async function enviarTeste() {
    if (!telTeste.trim()) return toast('erro', 'Informe o telefone')
    setTestando(true)
    const res = await fetch('/api/whatsapp/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone: telTeste }),
    })
    const data = await res.json()
    setTestando(false)
    if (data.success) toast('ok', 'Mensagem de teste enviada!')
    else toast('erro', data.error ?? 'Erro ao enviar')
  }

  async function carregarQR() {
    setCarregandoQr(true); setQrCode(null)
    const res = await fetch('/api/whatsapp/status?action=qrcode')
    const data = await res.json()
    setCarregandoQr(false)
    if (data.value) setQrCode(data.value)
    else toast('erro', data.error ?? 'QR Code não disponível')
  }

  async function desconectar() {
    if (!confirm('Desconectar o WhatsApp desta instância?')) return
    const res = await fetch('/api/whatsapp/status?action=disconnect')
    const data = await res.json()
    if (data.success) { setCfg(prev => ({ ...prev, status_conexao: 'desconectado' })); toast('ok', 'Desconectado!') }
    else toast('erro', data.error ?? 'Erro')
  }

  async function salvarModelo() {
    if (!modeloEdit.nome || !modeloEdit.conteudo) return
    setSalvandoModelo(true)
    if (modeloEdit.id) {
      await sb.from('whatsapp_modelos').update({ ...modeloEdit, updated_at: new Date().toISOString() }).eq('id', modeloEdit.id)
      setModelos(prev => prev.map(m => m.id === modeloEdit.id ? { ...m, ...modeloEdit as Modelo } : m))
    } else {
      const { data } = await sb.from('whatsapp_modelos').insert({
        empresa_id: empresaId, ...modeloEdit, created_at: new Date().toISOString(),
      }).select().single()
      if (data) setModelos(prev => [...prev, data])
    }
    setSalvandoModelo(false)
    setModalModelo(false)
    setModeloEdit({ nome: '', tipo: 'cupom', conteudo: '', ativo: true })
  }

  async function deletarModelo(id: string) {
    if (!confirm('Excluir este modelo?')) return
    await sb.from('whatsapp_modelos').delete().eq('id', id)
    setModelos(prev => prev.filter(m => m.id !== id))
  }

  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/zapi`

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>configurações</span><span>›</span>
        <span className="text-gray-600 font-medium">WhatsApp / Z-API</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-gray-900 text-xl font-semibold">WhatsApp / Z-API</h1>
          <p className="text-sm text-gray-400 mt-0.5">Integração de mensagens para {empresaNome}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={cfg.status_conexao} />
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-gray-600">Ativa</span>
            <button
              onClick={() => upd('ativo', !cfg.ativo)}
              className={`w-10 h-5 rounded-full transition-colors ${cfg.ativo ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform m-0.5 ${cfg.ativo ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </label>
        </div>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-3 rounded-lg mb-4 ${msg.tipo === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {msg.texto}
        </div>
      )}

      {/* Abas */}
      <div className="flex border-b border-gray-200 mb-6 gap-0">
        {([['conexao', '🔌 Conexão'], ['envio', '📤 Envio e mensagens'], ['templates', '📝 Templates'], ['modelos', '💬 Modelos']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setAba(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${aba === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ABA CONEXÃO ── */}
      {aba === 'conexao' && (
        <div className="space-y-6">
          {/* Status e ações */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Status da Instância</h2>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <Stat label="Status" value={cfg.status_conexao === 'conectado' ? '✅ Conectado' : cfg.status_conexao === 'erro' ? '❌ Erro' : '○ Desconectado'} />
              <Stat label="Última sincronização" value={cfg.ultima_sincronizacao ? new Date(cfg.ultima_sincronizacao).toLocaleString('pt-BR') : '—'} />
              <Stat label="Última mensagem enviada" value={cfg.ultima_mensagem_enviada ? new Date(cfg.ultima_mensagem_enviada).toLocaleString('pt-BR') : '—'} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={testarConexao} disabled={testando || !cfg.instance_id}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {testando ? '⏳ Verificando...' : '🔍 Testar Conexão'}
              </button>
              <button onClick={carregarQR} disabled={carregandoQr || !cfg.instance_id}
                className="px-4 py-2 border border-blue-300 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
                {carregandoQr ? '⏳ Carregando...' : '📷 Ver QR Code'}
              </button>
              <button onClick={() => fetch('/api/whatsapp/status?action=restart').then(() => toast('ok', 'Reiniciando...'))}
                disabled={!cfg.instance_id}
                className="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                🔄 Reiniciar
              </button>
              {cfg.status_conexao === 'conectado' && (
                <button onClick={desconectar}
                  className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors">
                  🔌 Desconectar
                </button>
              )}
            </div>
            {qrCode && (
              <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl inline-block">
                <p className="text-xs text-gray-500 mb-2">Escaneie com o WhatsApp do celular</p>
                <img src={`data:image/png;base64,${qrCode}`} alt="QR Code" className="w-48 h-48" />
              </div>
            )}
          </div>

          {/* Envio de teste */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Enviar Mensagem de Teste</h2>
            <div className="flex gap-3">
              <input
                value={telTeste}
                onChange={e => setTelTeste(e.target.value)}
                placeholder="(11) 99999-9999"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
              <button onClick={enviarTeste} disabled={testando || !cfg.instance_id}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap">
                📤 Enviar Teste
              </button>
            </div>
          </div>

          {/* Configurações da instância */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Configurações da Instância Z-API</h2>
            <div className="grid grid-cols-2 gap-4">
              <F label="Nome da integração" value={cfg.nome} onChange={v => upd('nome', v)} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ambiente</label>
                <select value={cfg.ambiente} onChange={e => upd('ambiente', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  <option value="producao">Produção</option>
                  <option value="teste">Teste</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Instance ID *" value={cfg.instance_id} onChange={v => upd('instance_id', v)} placeholder="Ex: 3ABC12345" />
              <F label="Token da instância *" value={cfg.token} onChange={v => upd('token', v)} type="password" placeholder="••••••••" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Client Token
                  <span className="ml-1 text-orange-500 font-semibold">(exigido pela Z-API)</span>
                </label>
                <input
                  type="password"
                  value={cfg.client_token}
                  onChange={e => upd('client_token', e.target.value)}
                  placeholder="Token da conta Z-API"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Encontre em: <span className="font-medium text-blue-600">app.z-api.io → Account → Security Token</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">URL Base da Z-API</label>
                <input
                  value={cfg.url_base}
                  onChange={e => {
                    let v = e.target.value
                    const idx = v.indexOf('/instances/')
                    if (idx > 0) v = v.substring(0, idx)
                    upd('url_base', v)
                  }}
                  placeholder="https://api.z-api.io"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Apenas o host — ex: <span className="font-mono">https://api.z-api.io</span></p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Número WhatsApp conectado" value={cfg.numero_whatsapp} onChange={v => upd('numero_whatsapp', v)} placeholder="5511999999999" />
              <F label="Nome exibido" value={cfg.nome_exibido} onChange={v => upd('nome_exibido', v)} placeholder="Loja Vargas" />
            </div>
            <div>
              <F label="Número do gestor (alertas de produtos monitorados)" value={cfg.numero_gestor} onChange={v => upd('numero_gestor', v)} placeholder="5511999999999" />
              <p className="text-xs text-gray-400 mt-1">
                Recebe um WhatsApp a cada venda, devolução ou baixa de estoque de produtos marcados como "Monitorar produto" no cadastro.
              </p>
            </div>
          </div>

          {/* Webhook */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Webhook</h2>
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-blue-700">URL do Webhook (configure na Z-API)</p>
                <p className="text-sm font-mono text-blue-800 mt-0.5">{webhookUrl}</p>
              </div>
              <button onClick={() => { navigator.clipboard.writeText(webhookUrl); toast('ok', 'URL copiada!') }}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 whitespace-nowrap">
                Copiar
              </button>
            </div>
            <F label="Webhook URL personalizada (opcional)" value={cfg.webhook_url} onChange={v => upd('webhook_url', v)} placeholder="https://..." />
            <textarea value={cfg.observacoes} onChange={e => upd('observacoes', e.target.value)}
              placeholder="Observações internas..." rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          <div className="flex justify-end">
            <button onClick={salvar} disabled={salvando}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
              {salvando ? 'Salvando...' : '💾 Salvar Configuração'}
            </button>
          </div>
        </div>
      )}

      {/* ── ABA TEMPLATES ── */}
      {/* ── ABA ENVIO E MENSAGENS ──
          Junta duas decisões que sempre foram tomadas juntas e não tinham
          onde ser tomadas: POR ONDE a mensagem sai e O QUE ela diz. */}
      {aba === 'envio' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-800">Por onde as mensagens saem</h2>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              Vale para os botões de enviar espalhados pelo sistema — como o do link do produto na
              lista de produtos.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['whatsapp_web', 'WhatsApp Web / app', 'Abre o WhatsApp do próprio vendedor com a mensagem escrita. Ele escolhe o contato, e a mensagem sai do número dele. Funciona no celular e não exige configuração nenhuma.'],
                ['zapi', 'API Z-API (número da empresa)', 'O servidor envia usando a conta Z-API. Você informa o número de destino, a mensagem sai do número da empresa e fica registrada no histórico.'],
              ] as const).map(([valor, titulo, desc]) => {
                const escolhido = (cfg.canal_envio ?? 'whatsapp_web') === valor
                const zapiPronto = !!cfg.instance_id && !!cfg.token && cfg.ativo
                const bloqueado = valor === 'zapi' && !zapiPronto
                return (
                  <button key={valor} type="button" disabled={bloqueado}
                    onClick={() => upd('canal_envio', valor)}
                    className={`text-left rounded-xl border p-4 transition-colors ${
                      escolhido ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    } ${bloqueado ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full border ${escolhido ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`} />
                      <span className="text-sm font-medium text-gray-900">{titulo}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-gray-500">{desc}</p>
                    {/* O QUE FALTA, dito onde a escolha é feita. Sem isto o
                        gestor escolheria Z-API, salvaria, e descobriria que
                        não funciona quando um cliente não recebesse. */}
                    {bloqueado && (
                      <p className="mt-2 text-[11px] font-medium text-amber-700">
                        Configure e ative a conexão Z-API na aba Conexão para poder escolher esta opção.
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Mensagem do link de produto ─────────────────────────── */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-800">Mensagem do link do produto</h2>
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Usada pelo botão verde ao lado do selo <b>LO</b>, na lista de produtos.
            </p>

            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-xs text-gray-400 mr-1 self-center">Clique para inserir:</span>
              {VARIAVEIS_PRODUTO_LINK.map(v => (
                <button key={v.chave} type="button"
                  title={`${v.descricao} — ex.: ${v.exemplo}`}
                  onClick={() => upd('texto_produto_link', `${cfg.texto_produto_link ?? PADRAO_PRODUTO_LINK}{${v.chave}}`)}
                  className="px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-[11px] font-mono text-gray-600 hover:bg-blue-50 hover:border-blue-300">
                  {'{' + v.chave + '}'}
                </button>
              ))}
            </div>

            <textarea
              value={cfg.texto_produto_link ?? PADRAO_PRODUTO_LINK}
              onChange={e => upd('texto_produto_link', e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none" />

            {/* PRÉ-VISUALIZAÇÃO com valores de exemplo — é onde uma variável
                escrita errada aparece, antes de o cliente receber a frase
                pela metade. */}
            {(() => {
              const modelo = cfg.texto_produto_link ?? PADRAO_PRODUTO_LINK
              const r = aplicarModelo(modelo, exemploDe(VARIAVEIS_PRODUTO_LINK))
              return (
                <div className="mt-3">
                  <p className="text-xs text-gray-400 mb-1">Como o cliente recebe:</p>
                  <pre className="whitespace-pre-wrap rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-gray-800">{r.texto || '(mensagem vazia)'}</pre>
                  {r.desconhecidas.length > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      Estas variáveis não existem nesta mensagem e vão chegar assim mesmo, entre chaves:{' '}
                      <b>{r.desconhecidas.map(d => `{${d}}`).join(', ')}</b>
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-gray-400">
                    O padrão é só o link porque a página do produto já manda foto, nome e preço para o
                    WhatsApp montar a prévia. Texto a mais duplica o que a prévia mostra.
                  </p>
                </div>
              )
            })()}
          </div>

          {/* O QUE ESTA TELA NÃO CONFIGURA, dito aqui em vez de descoberto
              depois: o sistema não tem envio de e-mail nenhum. */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-medium text-amber-900">E-mail ainda não é enviado por este sistema</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Não há serviço de e-mail configurado no sistema — nenhuma mensagem sai por e-mail hoje,
              de nenhuma tela. Por isso não existe aqui uma opção de e-mail para escolher: seria uma
              configuração sem efeito.
            </p>
          </div>

          <button onClick={salvar} disabled={salvando}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}

      {aba === 'templates' && (
        <div className="space-y-5">
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <p className="text-sm text-blue-700 font-medium">Variáveis disponíveis</p>
            <p className="text-xs text-blue-600 mt-1 font-mono leading-relaxed">{VARIAVEIS.join('  ')}</p>
          </div>
          {([
            ['texto_cupom', '🧾 Template do Cupom de Venda'],
            ['texto_cobranca', '💰 Template de Cobrança'],
            ['texto_orcamento', '📋 Template de Orçamento'],
            ['texto_confirmacao_pag', '✅ Template de Confirmação de Pagamento'],
            ['texto_lista_produtos', '📦 Template de Lista de Produtos'],
            ['texto_lembrete_venc', '⏰ Template de Lembrete de Vencimento'],
            ['texto_pos_venda', '😊 Template de Pós-Venda'],
          ] as [keyof Config, string][]).map(([field, label]) => (
            <div key={field} className="bg-white border border-gray-200 rounded-xl p-5">
              <label className="block text-sm font-semibold text-gray-800 mb-2">{label}</label>
              <textarea
                value={cfg[field] as string}
                onChange={e => upd(field, e.target.value)}
                rows={5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-y font-mono"
              />
            </div>
          ))}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold text-gray-800">Configurações de texto</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Saudação padrão</label>
                <input value={cfg.saudacao} onChange={e => upd('saudacao', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Horário de atendimento</label>
                <input value={cfg.horario_atendimento} onChange={e => upd('horario_atendimento', e.target.value)}
                  placeholder="Seg–Sex 8h–18h · Sáb 8h–12h"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Assinatura (rodapé de todas as mensagens)</label>
              <textarea value={cfg.assinatura} onChange={e => upd('assinatura', e.target.value)} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={salvar} disabled={salvando}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
              {salvando ? 'Salvando...' : '💾 Salvar Templates'}
            </button>
          </div>
        </div>
      )}

      {/* ── ABA MODELOS ── */}
      {aba === 'modelos' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">Modelos personalizados por tipo de mensagem.</p>
            <button onClick={() => { setModeloEdit({ nome: '', tipo: 'cupom', conteudo: '', ativo: true }); setModalModelo(true) }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              + Novo Modelo
            </button>
          </div>

          {modelos.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-gray-500 text-sm">Nenhum modelo criado ainda.</p>
              <p className="text-gray-400 text-xs mt-1">Crie modelos para reutilizar em diferentes situações.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide">Nome</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-36">Tipo</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-600 uppercase tracking-wide w-20">Status</th>
                    <th className="w-24 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modelos.map(m => (
                    <tr key={m.id} className="group hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{m.nome}</td>
                      <td className="px-4 py-3 text-gray-500 capitalize text-xs">{m.tipo.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.ativo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {m.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100">
                          <button onClick={() => { setModeloEdit(m); setModalModelo(true) }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                          <button onClick={() => deletarModelo(m.id)}
                            className="text-xs text-red-500 hover:text-red-700 font-medium">Excluir</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal de modelo */}
      {modalModelo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalModelo(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">{modeloEdit.id ? 'Editar Modelo' : 'Novo Modelo'}</h2>
              <button onClick={() => setModalModelo(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <F label="Nome do modelo" value={modeloEdit.nome ?? ''} onChange={v => setModeloEdit(p => ({ ...p, nome: v }))} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select value={modeloEdit.tipo ?? 'cupom'} onChange={e => setModeloEdit(p => ({ ...p, tipo: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                  {TIPOS_MODELO.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Conteúdo</label>
                <textarea value={modeloEdit.conteudo ?? ''} onChange={e => setModeloEdit(p => ({ ...p, conteudo: e.target.value }))}
                  rows={6} placeholder="Use {nome_cliente}, {valor_total}, etc."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-y font-mono" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={modeloEdit.ativo ?? true} onChange={e => setModeloEdit(p => ({ ...p, ativo: e.target.checked }))}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm text-gray-700">Modelo ativo</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setModalModelo(false)} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={salvarModelo} disabled={salvandoModelo || !modeloEdit.nome || !modeloEdit.conteudo}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {salvandoModelo ? 'Salvando...' : 'Salvar Modelo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function F({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500" />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}
