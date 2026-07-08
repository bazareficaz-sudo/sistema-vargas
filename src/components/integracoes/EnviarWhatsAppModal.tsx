'use client'

import { useState } from 'react'

export type EnviarWppPayload = {
  telefone: string
  mensagem: string
  tipo?: string
  cliente_id?: string | null
  cliente_nome?: string | null
  referencia_tipo?: string
  referencia_id?: string
  pdf_url?: string
}

interface Props {
  aberto: boolean
  titulo?: string
  payload: EnviarWppPayload
  onChange?: (p: EnviarWppPayload) => void
  onClose: () => void
  onEnviado?: () => void
}

type Status = 'idle' | 'enviando' | 'ok' | 'erro'

export default function EnviarWhatsAppModal({ aberto, titulo = 'Enviar via WhatsApp', payload, onChange, onClose, onEnviado }: Props) {
  const [tel, setTel] = useState(payload.telefone)
  const [msg, setMsg] = useState(payload.mensagem)
  const [status, setStatus] = useState<Status>('idle')
  const [erro, setErro] = useState('')

  if (!aberto) return null

  function formatTel(v: string) {
    const d = v.replace(/\D/g, '')
    if (d.length <= 2) return `(${d}`
    if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`
    if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7,11)}`
  }

  async function enviar() {
    if (!tel.trim() || !msg.trim()) return
    setStatus('enviando')
    setErro('')
    try {
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          telefone: tel,
          mensagem: msg,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setErro(data.error ?? 'Erro ao enviar')
        setStatus('erro')
      } else {
        setStatus('ok')
        onEnviado?.()
      }
    } catch (e: any) {
      setErro(e.message)
      setStatus('erro')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">💬</span>
            <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {status === 'ok' ? (
            <div className="text-center py-6">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-lg font-semibold text-gray-900">Mensagem enviada!</p>
              <p className="text-sm text-gray-500 mt-1">Enviado para {tel}</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp do destinatário *</label>
                <input
                  value={tel}
                  onChange={e => setTel(formatTel(e.target.value))}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-600">Mensagem *</label>
                  <span className="text-xs text-gray-400">{msg.length} caracteres</span>
                </div>
                <textarea
                  value={msg}
                  onChange={e => setMsg(e.target.value)}
                  rows={8}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-y font-mono"
                />
              </div>

              {payload.pdf_url && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center gap-2">
                  <span className="text-blue-500">📎</span>
                  <span className="text-xs text-blue-700">PDF anexo será enviado junto</span>
                </div>
              )}

              {erro && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{erro}</div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">
            {status === 'ok' ? 'Fechar' : 'Cancelar'}
          </button>
          {status !== 'ok' && (
            <button onClick={enviar} disabled={status === 'enviando' || !tel.trim() || !msg.trim()}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
              {status === 'enviando' ? (
                <><span className="animate-spin">⏳</span> Enviando...</>
              ) : (
                <>📤 Enviar WhatsApp</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
