'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Fechamento do contador › envio por e-mail: botão "Enviar ao contador",
// envio automático todo mês e o histórico dos envios.

type Config = { envio_automatico: boolean; dia_envio: number; copia_para: string | null }
type Envio = { id: string; mes: string; para: string; copia: string | null; origem: string; status: string; erro: string | null; notas: number | null; created_at: string }
type Estado = { config: Config; envios: Envio[]; emailConfigurado: boolean; contador: string | null; emailContador: string | null }

const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const rotuloMes = (m: string) => { const [a, n] = m.split('-'); return `${n}/${a}` }

export default function EnvioContadorCard({ mes, rotulo, totalNotas }: { mes: string; rotulo: string; totalNotas: number }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [form, setForm] = useState<Config | null>(null)
  const [ocupado, setOcupado] = useState<'' | 'enviar' | 'salvar'>('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/fiscal/fechamento/envio').then(r => r.json()).then(d => {
      if (vivo && d.ok) { setEstado(d); setForm(d.config) }
    }).catch(() => {})
    return () => { vivo = false }
  }, [])

  async function post(corpo: unknown) {
    const r = await fetch('/api/fiscal/fechamento/envio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    return r.json()
  }

  async function enviar() {
    if (!estado?.emailContador) return
    if (!window.confirm(`Enviar o fechamento de ${rotulo} (${totalNotas} notas) para ${estado.emailContador}?`)) return
    setOcupado('enviar'); setAviso(null)
    try {
      const d = await post({ acao: 'enviar', mes })
      if (d.envios) { setEstado(d); }
      setAviso(d.ok
        ? { tipo: 'ok', texto: `Enviado para ${d.para.join(', ')}${d.copia?.length ? ` (cópia: ${d.copia.join(', ')})` : ''}.` }
        : { tipo: 'erro', texto: d.erro ?? 'Falha no envio' })
    } catch { setAviso({ tipo: 'erro', texto: 'Falha de conexão no envio' }) }
    finally { setOcupado('') }
  }

  async function salvar() {
    if (!form) return
    setOcupado('salvar'); setAviso(null)
    try {
      const d = await post({ acao: 'config', ...form })
      if (!d.ok) { setAviso({ tipo: 'erro', texto: d.erro ?? 'Falha ao salvar' }); return }
      setEstado(d); setForm(d.config)
      setAviso({ tipo: 'ok', texto: d.config.envio_automatico
        ? `Envio automático ligado: todo dia ${d.config.dia_envio}, o fechamento do mês anterior vai para o contador.`
        : 'Envio automático desligado.' })
    } finally { setOcupado('') }
  }

  if (!estado || !form) return null
  const jaEnviado = estado.envios.find(e => e.mes === mes && e.status === 'enviado')
  const mudou = form.envio_automatico !== estado.config.envio_automatico || form.dia_envio !== estado.config.dia_envio
    || (form.copia_para ?? '') !== (estado.config.copia_para ?? '')

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-900">✉️ Enviar ao contador</p>
        <p className="text-xs text-gray-500">
          {estado.emailContador
            ? <>O .zip vai anexado num e-mail para {estado.contador ? `${estado.contador} — ` : ''}<strong>{estado.emailContador}</strong>, com o resumo e as pendências no corpo.</>
            : <>O e-mail do contador ainda não está no cadastro. <Link href="/dashboard/empresas" className="text-blue-600 hover:underline">Cadastrar em Gestão › Empresas</Link>.</>}
        </p>
      </div>

      {!estado.emailConfigurado && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          O serviço de e-mail ainda não está ligado (chave do Resend na Vercel). Até lá, baixe o .zip e envie pelo seu e-mail.
        </p>
      )}

      {jaEnviado && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          ✓ {rotulo} já foi enviado em {dataHora(jaEnviado.created_at)} para {jaEnviado.para}.
        </p>
      )}

      <button onClick={enviar} disabled={!!ocupado || !estado.emailConfigurado || !estado.emailContador || totalNotas === 0}
        className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
        {ocupado === 'enviar' ? 'Enviando…' : jaEnviado ? `Enviar de novo (${rotulo})` : `Enviar ${rotulo} ao contador`}
      </button>

      {aviso && (
        <p className={`text-xs rounded-lg px-3 py-2 ${aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{aviso.texto}</p>
      )}

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={form.envio_automatico} onChange={e => setForm(f => f && ({ ...f, envio_automatico: e.target.checked }))}
            className="w-4 h-4 mt-0.5 accent-emerald-600" />
          <span>Enviar sozinho todo mês
            <span className="block text-[11px] text-gray-500">No dia escolhido, às 8h, o fechamento do mês anterior vai para o contador — só se ainda não tiver sido enviado.</span>
          </span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">Dia do envio</label>
            <select value={form.dia_envio} onChange={e => setForm(f => f && ({ ...f, dia_envio: Number(e.target.value) }))}
              className="w-full sm:w-28 border border-gray-300 rounded-lg px-2 py-2 sm:py-1.5 text-base sm:text-sm bg-white">
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>dia {d}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-gray-500 mb-0.5">Cópia para (opcional)</label>
            <input value={form.copia_para ?? ''} onChange={e => setForm(f => f && ({ ...f, copia_para: e.target.value }))}
              type="email" inputMode="email" placeholder="seu@email.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-sm" />
          </div>
          <button onClick={salvar} disabled={!!ocupado || !mudou}
            className="px-4 py-2.5 sm:py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 text-sm rounded-lg">
            {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      {estado.envios.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">Últimos envios</p>
          <ul className="space-y-1">
            {estado.envios.map(e => (
              <li key={e.id} className="text-xs flex items-start justify-between gap-2">
                <span className="text-gray-700 min-w-0">
                  {dataHora(e.created_at)} · {rotuloMes(e.mes)} · {e.origem === 'automatico' ? 'automático' : 'manual'}
                  {e.status === 'erro' && e.erro && <span className="block text-red-600">{e.erro}</span>}
                </span>
                <span className={`shrink-0 ${e.status === 'enviado' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {e.status === 'enviado' ? `✓ ${e.notas ?? ''} notas` : 'falhou'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
