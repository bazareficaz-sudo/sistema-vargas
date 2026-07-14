'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type Resultado = { sucesso: number; falhas: { id: string; erro: string }[] }

export default function AdicionarImagemMassaModal({ ids, empresaId, onClose, onAplicado }: {
  ids: string[]
  empresaId: string
  onClose: () => void
  onAplicado: () => void
}) {
  const [modo, setModo] = useState<'arquivo' | 'url'>('arquivo')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previewArquivo, setPreviewArquivo] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [aplicando, setAplicando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!arquivo) { setPreviewArquivo(''); return }
    const url = URL.createObjectURL(arquivo)
    setPreviewArquivo(url)
    return () => URL.revokeObjectURL(url)
  }, [arquivo])

  function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    setArquivo(e.target.files?.[0] ?? null)
  }

  async function aplicar() {
    if (modo === 'arquivo' && !arquivo) { setErro('Escolha um arquivo de imagem.'); return }
    if (modo === 'url' && !urlInput.trim()) { setErro('Cole uma URL de imagem.'); return }
    setAplicando(true); setErro(''); setResultado(null); setProgresso(0)
    const sb = createClient()

    // Quantas imagens cada produto já tem — pra decidir ordem/principal por produto
    const { data: imgRows } = await sb.from('produto_imagens').select('produto_id').in('produto_id', ids)
    const contagem = new Map<string, number>()
    for (const id of ids) contagem.set(id, 0)
    for (const row of imgRows ?? []) contagem.set(row.produto_id, (contagem.get(row.produto_id) ?? 0) + 1)

    if (modo === 'url') {
      const url = urlInput.trim()
      const linhas = ids.map(id => ({
        empresa_id: empresaId,
        produto_id: id,
        url,
        ordem: contagem.get(id) ?? 0,
        principal: (contagem.get(id) ?? 0) === 0,
      }))
      const { error } = await sb.from('produto_imagens').insert(linhas)
      setAplicando(false)
      if (error) { setErro(error.message); return }
      setResultado({ sucesso: ids.length, falhas: [] })
      return
    }

    // Modo arquivo: envia uma vez para a pasta do primeiro produto, depois
    // copia o objeto no Storage pra pasta de cada um dos demais — evita que
    // dois produtos apontem pro mesmo arquivo físico (apagar a imagem de um
    // removeria o arquivo do outro).
    const ext = arquivo!.name.split('.').pop()?.toLowerCase() || 'jpg'
    const primeiroId = ids[0]
    const path0 = `${empresaId}/${primeiroId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error: uploadError } = await sb.storage.from('produto-imagens').upload(path0, arquivo!, { upsert: false })
    if (uploadError) {
      setAplicando(false)
      setErro('Falha ao enviar o arquivo: ' + uploadError.message)
      return
    }
    const { data: { publicUrl: url0 } } = sb.storage.from('produto-imagens').getPublicUrl(path0)

    const falhas: { id: string; erro: string }[] = []
    let sucesso = 0

    const { error: err0 } = await sb.from('produto_imagens').insert({
      empresa_id: empresaId, produto_id: primeiroId, url: url0,
      ordem: contagem.get(primeiroId) ?? 0, principal: (contagem.get(primeiroId) ?? 0) === 0,
    })
    if (err0) falhas.push({ id: primeiroId, erro: err0.message })
    else sucesso++
    setProgresso(1)

    for (let i = 1; i < ids.length; i++) {
      const id = ids[i]
      try {
        let urlFinal = url0
        const novoPath = `${empresaId}/${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error: copyError } = await sb.storage.from('produto-imagens').copy(path0, novoPath)
        if (!copyError) {
          const { data: { publicUrl } } = sb.storage.from('produto-imagens').getPublicUrl(novoPath)
          urlFinal = publicUrl
        }
        const { error: insertError } = await sb.from('produto_imagens').insert({
          empresa_id: empresaId, produto_id: id, url: urlFinal,
          ordem: contagem.get(id) ?? 0, principal: (contagem.get(id) ?? 0) === 0,
        })
        if (insertError) { falhas.push({ id, erro: insertError.message }); continue }
        sucesso++
      } catch (e: any) {
        falhas.push({ id, erro: e?.message ?? 'Erro desconhecido' })
      } finally {
        setProgresso(i + 1)
      }
    }

    setAplicando(false)
    setResultado({ sucesso, falhas })
  }

  function fechar() {
    if (resultado) onAplicado()
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={fechar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Adicionar imagem em massa</h2>
            <p className="text-xs text-gray-400">{ids.length} produto(s) selecionado(s)</p>
          </div>
          <button onClick={fechar} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {resultado ? (
            <div className="space-y-2">
              <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                ✓ {resultado.sucesso} de {ids.length} produto(s) atualizado(s).
              </p>
              {resultado.falhas.length > 0 && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="font-medium mb-1">{resultado.falhas.length} falharam:</p>
                  <ul className="text-xs space-y-0.5 list-disc list-inside">
                    {resultado.falhas.map(f => <li key={f.id}>{f.erro}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 border border-gray-200 rounded-lg p-1 w-fit">
                <button type="button" onClick={() => setModo('arquivo')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${modo === 'arquivo' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  Enviar arquivo
                </button>
                <button type="button" onClick={() => setModo('url')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${modo === 'url' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  Colar URL
                </button>
              </div>

              {modo === 'arquivo' ? (
                <div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={escolherArquivo}
                    className="text-sm text-gray-600" />
                  {previewArquivo && (
                    <img src={previewArquivo} alt="Prévia" className="w-24 h-24 object-cover rounded-lg border border-gray-200 mt-2" />
                  )}
                </div>
              ) : (
                <div>
                  <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                  {urlInput.trim() && (
                    <img src={urlInput.trim()} alt="Prévia" className="w-24 h-24 object-cover rounded-lg border border-gray-200 mt-2" />
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400">
                A mesma imagem será aplicada a todos os {ids.length} produtos selecionados — vira a imagem principal só nos que ainda não tiverem nenhuma.
              </p>

              {aplicando && (
                <p className="text-xs text-blue-500">Aplicando... {progresso} de {ids.length}</p>
              )}
              {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
          {resultado ? (
            <button onClick={fechar} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              Concluir
            </button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
              <button onClick={aplicar} disabled={aplicando}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {aplicando ? 'Aplicando...' : `Aplicar a ${ids.length} produto(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
