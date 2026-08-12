'use client'

import { useEffect, useState } from 'react'
import { botao } from '@/components/ui/botao'

// Envio da situação da conta para o cliente, pelo WhatsApp.
//
// Uma mensagem só, com o relatório do sistema em anexo: todas as compras em
// aberto com dia, vendedor, valor e há quantos dias estão na conta, e o
// total no fim.
//
// Chegou a existir aqui a opção de anexar também o comprovante de cada
// compra. Saiu: virava uma enxurrada de mensagens no chat do cliente (23
// numa conta real) e o relatório já traz a informação que interessa.

type Resumo = {
  compras: number
  emAberto: number
  maisAntigaDias: number
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function EnviarAtualizacaoContaModal({
  clienteId, clienteNome, telefone, onFechar,
}: {
  clienteId: string
  clienteNome: string
  telefone: string | null
  onFechar: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [urlRelatorio, setUrlRelatorio] = useState<string | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)

  const [tel, setTel] = useState(telefone ?? '')
  const [mensagem, setMensagem] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  // A rota diz separadamente se o anexo saiu. Texto entregue sem o PDF não
  // pode ser anunciado como "enviado" — o cliente ficaria sem o relatório.
  const [anexoErro, setAnexoErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    ;(async () => {
      try {
        const r = await fetch(`/api/clientes/${clienteId}/extrato-pdf`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        }).then(res => res.json())
        if (!ativo) return
        if (!r.ok) { setErro(r.erro ?? 'Não foi possível gerar o relatório'); return }
        setUrlRelatorio(r.url)
        setResumo(r.resumo)
        setMensagem(
          `Olá, ${clienteNome}! Segue a situação da sua conta na loja.\n\n` +
          `Total em aberto: ${fmt(r.resumo.emAberto)}\n` +
          `${r.resumo.compras} compra${r.resumo.compras === 1 ? '' : 's'} em aberto.\n\n` +
          `O detalhamento de cada compra está no arquivo em anexo. Qualquer dúvida, estamos à disposição.`,
        )
      } catch (e: unknown) {
        if (ativo) setErro(e instanceof Error ? e.message : 'Falha ao gerar o relatório')
      } finally {
        if (ativo) setCarregando(false)
      }
    })()
    return () => { ativo = false }
  }, [clienteId, clienteNome])

  const digitos = tel.replace(/\D/g, '')
  const telefoneValido = digitos.length === 10 || digitos.length === 11

  async function enviar() {
    if (!urlRelatorio || !telefoneValido) return
    setEnviando(true); setErro('')
    try {
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: digitos,
          mensagem: mensagem.trim(),
          tipo: 'atualizacao_conta',
          cliente_id: clienteId,
          cliente_nome: clienteNome,
          referencia_tipo: 'cliente',
          referencia_id: clienteId,
          pdf_url: urlRelatorio,
          pdf_nome: `situacao-conta-${clienteNome.replace(/\s+/g, '-').toLowerCase()}.pdf`,
        }),
      })
      const d = await res.json()
      if (!res.ok || d.error) { setErro(d.error ?? 'Não foi possível enviar'); return }
      setAnexoErro(d.anexoErro ?? null)
      setEnviado(true)
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha de rede')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={enviando ? undefined : onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Enviar situação da conta</h3>
          <p className="text-sm text-gray-500 mt-0.5">{clienteNome}</p>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {carregando && <p className="text-sm text-gray-400 text-center py-6">Montando o relatório…</p>}

          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

          {enviado ? (
            <div className="text-center py-8">
              <p className="text-lg font-semibold text-gray-900">
                {anexoErro ? 'Mensagem enviada, anexo não' : 'Mensagem enviada'}
              </p>
              {anexoErro ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 text-left">
                  O texto chegou em {tel}, mas o relatório em PDF não foi aceito pelo WhatsApp:
                  <span className="block mt-1 font-mono text-[11px]">{anexoErro}</span>
                  Use &quot;Ver relatório&quot; para baixar e mandar à mão.
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">O relatório foi para {tel}.</p>
              )}
            </div>
          ) : resumo && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Bloco titulo="Compras" valor={String(resumo.compras)} />
                <Bloco titulo="Mais antiga" valor={resumo.maisAntigaDias === 0 ? 'hoje' : `${resumo.maisAntigaDias} dias`} />
                <Bloco titulo="Total em aberto" valor={fmt(resumo.emAberto)} forte />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp do cliente *</label>
                <input value={tel} onChange={e => setTel(e.target.value)} placeholder="(11) 98888-7777" inputMode="numeric"
                  className="w-full border border-gray-300 rounded-lg px-3 h-10 text-sm focus:outline-none focus:border-green-500" />
                {tel && !telefoneValido && (
                  <p className="text-[11px] text-amber-700 mt-1">Faltam dígitos — informe DDD e número.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mensagem</label>
                <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={7}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-green-500" />
                <p className="text-[11px] text-gray-400 mt-1">O relatório em PDF vai anexado a esta mensagem.</p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
          {urlRelatorio && (!enviado || anexoErro) && (
            <a href={urlRelatorio} target="_blank" rel="noreferrer" className={botao('sutil', 'sm')}>Ver relatório</a>
          )}
          <div className="flex-1" />
          <button onClick={onFechar} disabled={enviando} className={botao('secundario', 'md')}>
            {enviado ? 'Fechar' : 'Cancelar'}
          </button>
          {!enviado && (
            <button onClick={enviar} disabled={enviando || carregando || !urlRelatorio || !telefoneValido}
              className={botao('primario', 'md')}>
              {enviando ? 'Enviando…' : 'Enviar por WhatsApp'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Bloco({ titulo, valor, forte }: { titulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-lg px-2 py-2">
      <p className="text-[11px] text-gray-500">{titulo}</p>
      <p className={`text-sm mt-0.5 text-gray-900 ${forte ? 'font-semibold' : ''}`}>{valor}</p>
    </div>
  )
}
