'use client'

import { useEffect, useState } from 'react'
import { botao } from '@/components/ui/botao'

// Envio da situação da conta para o cliente, pelo WhatsApp.
//
// Manda um relatório em PDF com todas as compras em aberto — dia, vendedor,
// valor — e os totais separando o que ainda vai vencer do que já venceu.
// Opcionalmente manda também o comprovante de cada compra, um por mensagem,
// que é como o cliente consegue conferir item a item o que está cobrado.

type Resumo = {
  compras: number
  aVencer: number
  vencido: number
  emAberto: number
  vendaIds: string[]
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Um envio atrás do outro estoura o limite da Z-API e o WhatsApp entrega
// fora de ordem. Mesmo intervalo já usado no envio de imagens de produto.
const INTERVALO_MS = 1200

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
  const [anexarPedidos, setAnexarPedidos] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [resultado, setResultado] = useState<{ enviados: number; falhas: number } | null>(null)

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
          (r.resumo.vencido > 0 ? `Vencido: ${fmt(r.resumo.vencido)}\n` : '') +
          (r.resumo.aVencer > 0 ? `A vencer: ${fmt(r.resumo.aVencer)}\n` : '') +
          `\nO detalhamento de cada compra está no arquivo em anexo. Qualquer dúvida, estamos à disposição.`,
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

  async function enviarUm(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await res.json()
      return res.ok && !d.error
    } catch { return false }
  }

  async function enviar() {
    if (!urlRelatorio || !telefoneValido) return
    setEnviando(true); setErro(''); setProgresso('Enviando o relatório…')

    let enviados = 0, falhas = 0

    const okRelatorio = await enviarUm({
      telefone: digitos,
      mensagem: mensagem.trim(),
      tipo: 'atualizacao_conta',
      cliente_id: clienteId,
      cliente_nome: clienteNome,
      referencia_tipo: 'cliente',
      referencia_id: clienteId,
      pdf_url: urlRelatorio,
    })
    okRelatorio ? enviados++ : falhas++

    if (anexarPedidos && resumo?.vendaIds.length) {
      const ids = [...new Set(resumo.vendaIds)]
      for (let i = 0; i < ids.length; i++) {
        setProgresso(`Enviando comprovante ${i + 1} de ${ids.length}…`)
        try {
          const pdf = await fetch(`/api/vendas/${ids[i]}/comprovante-pdf`, { method: 'POST' }).then(r => r.json())
          if (!pdf.ok) { falhas++; continue }
          const ok = await enviarUm({
            telefone: digitos,
            mensagem: `Comprovante da compra ${i + 1} de ${ids.length}.`,
            tipo: 'comprovante_venda',
            cliente_id: clienteId,
            cliente_nome: clienteNome,
            referencia_tipo: 'venda',
            referencia_id: ids[i],
            pdf_url: pdf.url,
          })
          ok ? enviados++ : falhas++
        } catch { falhas++ }
        if (i < ids.length - 1) await new Promise(r => setTimeout(r, INTERVALO_MS))
      }
    }

    setProgresso('')
    setResultado({ enviados, falhas })
    setEnviando(false)
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

          {resultado ? (
            <div className="text-center py-6">
              <p className="text-lg font-semibold text-gray-900">
                {resultado.enviados} {resultado.enviados === 1 ? 'mensagem enviada' : 'mensagens enviadas'}
              </p>
              {resultado.falhas > 0 && (
                <p className="text-sm text-red-600 mt-1">{resultado.falhas} não saiu(ram) — confira a conexão do WhatsApp.</p>
              )}
            </div>
          ) : resumo && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Bloco titulo="A vencer" valor={fmt(resumo.aVencer)} />
                <Bloco titulo="Vencido" valor={fmt(resumo.vencido)} cor={resumo.vencido > 0 ? 'text-red-600' : undefined} />
                <Bloco titulo="Total" valor={fmt(resumo.emAberto)} forte />
              </div>
              <p className="text-xs text-gray-400 -mt-2 text-center">
                {resumo.compras} compra(s) em aberto no relatório
              </p>

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
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={anexarPedidos} onChange={e => setAnexarPedidos(e.target.checked)}
                  disabled={!resumo.vendaIds.length} className="mt-0.5 w-4 h-4 accent-green-600" />
                <span>
                  Anexar os pedidos em PDF
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {resumo.vendaIds.length > 0
                      ? `${new Set(resumo.vendaIds).size} comprovante(s), um por mensagem, depois do relatório.`
                      : 'Nenhuma dessas contas tem venda vinculada — não há comprovante para anexar.'}
                  </span>
                </span>
              </label>

              {anexarPedidos && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Serão {new Set(resumo.vendaIds).size + 1} mensagens no total. O envio leva alguns segundos.
                </p>
              )}
            </>
          )}

          {progresso && <p className="text-sm text-gray-500 text-center">{progresso}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
          {urlRelatorio && !resultado && (
            <a href={urlRelatorio} target="_blank" rel="noreferrer" className={botao('sutil', 'sm')}>Ver relatório</a>
          )}
          <div className="flex-1" />
          <button onClick={onFechar} disabled={enviando} className={botao('secundario', 'md')}>
            {resultado ? 'Fechar' : 'Cancelar'}
          </button>
          {!resultado && (
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

function Bloco({ titulo, valor, cor, forte }: { titulo: string; valor: string; cor?: string; forte?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-lg px-2 py-2">
      <p className="text-[11px] text-gray-500">{titulo}</p>
      <p className={`text-sm mt-0.5 ${forte ? 'font-semibold' : ''} ${cor ?? 'text-gray-900'}`}>{valor}</p>
    </div>
  )
}
