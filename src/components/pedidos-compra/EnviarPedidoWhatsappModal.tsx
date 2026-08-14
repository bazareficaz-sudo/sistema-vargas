'use client'

import { useEffect, useState } from 'react'

// Envio do pedido ao fornecedor por WhatsApp.
//
// O telefone vem preenchido do cadastro do fornecedor — quem manda pedido não
// deveria precisar abrir outra tela para copiar o número. Continua editável:
// o comprador às vezes fala com o vendedor, não com a central.
//
// A mensagem é montada no servidor (nome do produto, código do fornecedor e
// quantidade — sem custo e sem total) e vem para cá como texto editável. Quem
// manda vê exatamente o que vai antes de mandar.

function soDigitos(v: string) { return v.replace(/\D/g, '') }

function formatarTelefone(v: string) {
  const d = soDigitos(v).replace(/^55/, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export default function EnviarPedidoWhatsappModal({ pedidoId, numero, onFechar, onEnviado }: {
  pedidoId: string
  numero: string
  onFechar: () => void
  onEnviado?: () => void
}) {
  const [carregando, setCarregando] = useState(true)
  const [telefone, setTelefone] = useState('')
  const [nomeFornecedor, setNomeFornecedor] = useState('')
  const [texto, setTexto] = useState('')
  const [semItens, setSemItens] = useState(false)
  const [itensZerados, setItensZerados] = useState(0)
  const [semCodigo, setSemCodigo] = useState(0)
  const [marcarEnviado, setMarcarEnviado] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState(false)

  useEffect(() => {
    let ativo = true
    fetch(`/api/pedidos-compra/${pedidoId}/whatsapp`)
      .then(r => r.json())
      .then(d => {
        if (!ativo) return
        if (!d.ok) { setErro(d.erro ?? 'Não foi possível montar o pedido'); return }
        setTexto(d.texto ?? '')
        setSemItens(!!d.semItens)
        setItensZerados(d.itensZerados ?? 0)
        setSemCodigo(d.semCodigoFornecedor ?? 0)
        setNomeFornecedor(d.fornecedor?.nome ?? '')
        if (d.fornecedor?.telefone) setTelefone(formatarTelefone(d.fornecedor.telefone))
      })
      .catch(() => { if (ativo) setErro('Falha ao carregar o pedido') })
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [pedidoId])

  const digitos = soDigitos(telefone)
  const telefoneValido = digitos.length === 10 || digitos.length === 11

  async function enviar() {
    setEnviando(true); setErro('')
    try {
      const d = await fetch(`/api/pedidos-compra/${pedidoId}/whatsapp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: digitos, texto, marcarEnviado }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível enviar'); return }
      setSucesso(true)
      onEnviado?.()
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha de rede')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Enviar pedido por WhatsApp</h2>
            <p className="text-xs text-slate-400">
              Pedido #{numero}{nomeFornecedor ? ` · ${nomeFornecedor}` : ''}
            </p>
          </div>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {carregando ? (
            <p className="text-sm text-slate-400">Montando o pedido...</p>
          ) : sucesso ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4">
              <p className="text-sm font-medium text-emerald-800">✓ Pedido enviado para {formatarTelefone(telefone)}</p>
              {marcarEnviado && <p className="text-xs text-emerald-700 mt-1">O pedido foi marcado como enviado.</p>}
              <button onClick={onFechar} className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
                Fechar
              </button>
            </div>
          ) : (
            <>
              {semItens && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Este pedido não tem item com quantidade — o fornecedor receberia uma lista vazia.
                </p>
              )}
              {itensZerados > 0 && !semItens && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {itensZerados} item(ns) estão com quantidade zero e ficaram de fora da mensagem.
                  Se era para pedir, ajuste a quantidade no pedido antes de enviar.
                </p>
              )}
              {semCodigo > 0 && (
                <p className="text-xs text-slate-500">
                  {semCodigo} produto(s) não têm código do fornecedor no cadastro — para esses foi usado o
                  código de barras, que o fornecedor também consegue identificar.
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Telefone do fornecedor</label>
                <input value={telefone} onChange={e => setTelefone(formatarTelefone(e.target.value))}
                  placeholder="(00) 00000-0000"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-slate-400 mt-1">
                  {telefone
                    ? 'Veio do cadastro do fornecedor — pode trocar se for falar com outro contato.'
                    : 'O cadastro deste fornecedor não tem telefone. Digite o número.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mensagem</label>
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={12}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-slate-400 mt-1">
                  Vai o nome do produto, o código do fornecedor e a quantidade. Custo e total ficam de fora
                  de propósito — é o fornecedor quem deve cotar.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={marcarEnviado} onChange={e => setMarcarEnviado(e.target.checked)} />
                Marcar o pedido como enviado
              </label>

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </>
          )}
        </div>

        {!carregando && !sucesso && (
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
            <button onClick={onFechar} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
              Cancelar
            </button>
            <button onClick={enviar} disabled={!telefoneValido || !texto.trim() || enviando}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {enviando ? 'Enviando...' : 'Enviar no WhatsApp'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
