'use client'

import { useState } from 'react'
import { botao } from '@/components/ui/botao'

// Envio das imagens escolhidas por WhatsApp.
//
// Cada imagem vai numa mensagem própria, com o seu título como legenda —
// é assim que o WhatsApp mostra texto junto da foto.

type ImagemEnvio = { id: string; url: string; titulo?: string | null }

// Só dígitos. O que o usuário digita vem com parênteses, traço e espaço.
function soDigitos(v: string) { return v.replace(/\D/g, '') }

function formatarTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export default function EnviarImagensWhatsappModal({
  imagens, nomeProduto, onFechar,
}: {
  imagens: ImagemEnvio[]
  nomeProduto: string
  onFechar: () => void
}) {
  const [telefone, setTelefone] = useState('')
  const [mensagem, setMensagem] = useState(`Segue o material do produto: ${nomeProduto}`)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<{ enviadas: number; falhas: number } | null>(null)

  const digitos = soDigitos(telefone)
  const telefoneValido = digitos.length === 10 || digitos.length === 11
  const semTitulo = imagens.filter(i => !i.titulo?.trim()).length

  async function enviar() {
    setEnviando(true); setErro(''); setResultado(null)
    try {
      const r = await fetch('/api/produtos/imagens/enviar-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: digitos,
          imagemIds: imagens.map(i => i.id),
          mensagemInicial: mensagem.trim() || undefined,
        }),
      }).then(res => res.json())

      if (!r.ok) { setErro(r.erro ?? 'Não foi possível enviar'); return }
      setResultado({ enviadas: r.enviadas, falhas: r.falhas })
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha de rede')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Enviar por WhatsApp</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {imagens.length} {imagens.length === 1 ? 'imagem selecionada' : 'imagens selecionadas'}
          </p>
        </div>

        {resultado ? (
          <div className="px-6 py-8 text-center">
            <p className="text-lg font-semibold text-gray-900">
              {resultado.enviadas} {resultado.enviadas === 1 ? 'imagem enviada' : 'imagens enviadas'}
            </p>
            {resultado.falhas > 0 && (
              <p className="text-sm text-red-600 mt-1">{resultado.falhas} falhou(ram) no envio.</p>
            )}
            <button onClick={onFechar} className={botao('primario', 'md', 'mt-5')}>Fechar</button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Número de destino *</label>
                <input value={telefone} onChange={e => setTelefone(formatarTelefone(e.target.value))}
                  placeholder="(11) 98888-7777" inputMode="numeric"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                {telefone && !telefoneValido && (
                  <p className="text-[11px] text-amber-700 mt-1">Faltam dígitos — informe DDD e número.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Mensagem de abertura <span className="font-normal text-gray-400">(opcional)</span>
                </label>
                <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-500" />
                <p className="text-[11px] text-gray-400 mt-1">Vai antes das fotos. Deixe em branco para mandar só as imagens.</p>
              </div>

              {/* Prévia: mostra exatamente a legenda que cada foto vai levar. */}
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-52 overflow-y-auto">
                {imagens.map((i, idx) => (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2">
                    <img src={i.url} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400">Mensagem {idx + 1}</p>
                      <p className={`text-sm truncate ${i.titulo?.trim() ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                        {i.titulo?.trim() || 'sem legenda'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {semTitulo > 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {semTitulo} {semTitulo === 1 ? 'imagem vai' : 'imagens vão'} sem legenda. Para escrever uma,
                  preencha o campo <b>Título</b> abaixo da foto e salve o produto antes de enviar.
                </p>
              )}

              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button onClick={onFechar} className={botao('secundario', 'md', 'flex-1')}>Cancelar</button>
              <button onClick={enviar} disabled={enviando || !telefoneValido}
                className={botao('primario', 'md', 'flex-1')}>
                {enviando ? 'Enviando…' : `Enviar ${imagens.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
