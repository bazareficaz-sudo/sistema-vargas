'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BUCKET_FOTOS, LIMITE_FOTO, TIPOS_FOTO, caminhoDaFoto } from '@/lib/clientes/foto'

// Foto do cliente no cadastro: enviar, usar a do WhatsApp ou tirar. Grava na
// hora (não espera o "Salvar" da gaveta). Bucket privado: mostra por link
// assinado.

export function iniciaisDe(nome: string) {
  return nome.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function AvatarCliente({ nome, url, tamanho = 'w-10 h-10 text-sm' }: { nome: string; url?: string | null; tamanho?: string }) {
  const [falhou, setFalhou] = useState<string | null>(null)
  // eslint-disable-next-line @next/next/no-img-element
  if (url && falhou !== url) return <img src={url} alt="" onError={() => setFalhou(url)} className={`${tamanho} rounded-full object-cover bg-gray-100 shrink-0`} />
  return <span className={`${tamanho} rounded-full bg-gray-200 text-gray-600 font-medium flex items-center justify-center shrink-0`}>{iniciaisDe(nome)}</span>
}

export default function FotoCliente({ empresaId, clienteId, nome, onMudou }: {
  empresaId: string; clienteId: string; nome: string; onMudou?: () => void
}) {
  const sb = useRef(createClient()).current
  const [foto, setFoto] = useState<{ caminho: string | null; origem: string | null; url: string | null } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const seletor = useRef<HTMLInputElement>(null)

  async function carregar() {
    const { data } = await sb.from('clientes').select('foto_path, foto_origem').eq('id', clienteId).maybeSingle()
    const caminho = (data?.foto_path as string | null) ?? null
    const url = caminho ? (await sb.storage.from(BUCKET_FOTOS).createSignedUrl(caminho, 3600)).data?.signedUrl ?? null : null
    return { caminho, origem: (data?.foto_origem as string | null) ?? null, url }
  }
  useEffect(() => {
    let valido = true
    carregar().then(f => { if (valido) setFoto(f) })
    return () => { valido = false }
  }, [clienteId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function recarregar() { setFoto(await carregar()); onMudou?.() }

  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return
    setAviso('')
    const caminho = caminhoDaFoto(empresaId, clienteId, arquivo.type)
    if (!caminho) { setAviso('Use uma foto JPG, PNG ou WEBP.'); return }
    if (arquivo.size > LIMITE_FOTO) { setAviso('Foto grande demais (máximo 5 MB).'); return }
    setOcupado(true)
    try {
      const { error } = await sb.storage.from(BUCKET_FOTOS).upload(caminho, arquivo, { contentType: arquivo.type })
      if (error) { setAviso('Não foi possível enviar a foto.'); return }
      const { error: e2 } = await sb.from('clientes').update({ foto_path: caminho, foto_origem: 'manual', foto_em: new Date().toISOString() }).eq('id', clienteId)
      if (e2) { await sb.storage.from(BUCKET_FOTOS).remove([caminho]); setAviso('Não foi possível gravar no cadastro.'); return }
      if (foto?.caminho && foto.caminho !== caminho) await sb.storage.from(BUCKET_FOTOS).remove([foto.caminho])
      await recarregar()
    } finally { setOcupado(false) }
  }

  async function doWhatsapp() {
    if (foto?.origem === 'manual' && !confirm('Trocar a foto enviada pela loja pela foto do WhatsApp?')) return
    setOcupado(true); setAviso('')
    try {
      const r = await fetch('/api/clientes/foto-whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId, substituir: true }),
      }).then(x => x.json()).catch(() => ({ ok: false, motivo: 'Sem conexão.' }))
      if (!r.ok) setAviso(r.motivo ?? r.error ?? 'Não foi possível pegar a foto do WhatsApp.')
      else await recarregar()
    } finally { setOcupado(false) }
  }

  async function tirar() {
    if (!foto?.caminho || !confirm('Tirar a foto do cadastro?')) return
    setOcupado(true); setAviso('')
    try {
      const { error } = await sb.from('clientes').update({ foto_path: null, foto_origem: null, foto_em: null }).eq('id', clienteId)
      if (error) { setAviso('Não foi possível tirar a foto.'); return }
      await sb.storage.from(BUCKET_FOTOS).remove([foto.caminho])
      await recarregar()
    } finally { setOcupado(false) }
  }

  return (
    <div className="flex items-center gap-4">
      <AvatarCliente nome={nome || '?'} url={foto?.url} tamanho="w-20 h-20 text-2xl" />
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => seletor.current?.click()} disabled={ocupado}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">{foto?.caminho ? 'Trocar foto' : 'Enviar foto'}</button>
          <button type="button" onClick={doWhatsapp} disabled={ocupado}
            className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Usar foto do WhatsApp</button>
          {foto?.caminho && <button type="button" onClick={tirar} disabled={ocupado} className="text-xs px-2 py-1.5 text-red-600 hover:underline disabled:opacity-50">Tirar</button>}
        </div>
        <p className="text-[11px] text-gray-400">
          {ocupado ? 'Gravando…' : foto?.origem === 'whatsapp' ? 'Foto copiada do WhatsApp do cliente.' : foto?.origem === 'manual' ? 'Foto enviada pela loja.' : 'Sem foto. Se o cliente tiver foto no WhatsApp, ela vem sozinha quando ele escrever.'}
          {' '}A foto é gravada na hora.
        </p>
        {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
        <input ref={seletor} type="file" accept={Object.keys(TIPOS_FOTO).join(',')} className="hidden"
          onChange={e => { enviar(e.target.files?.[0]); e.target.value = '' }} />
      </div>
    </div>
  )
}
