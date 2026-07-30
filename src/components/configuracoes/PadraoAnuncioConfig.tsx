'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Config = {
  regra_titulo: string
  regra_descricao: string
  tom_voz: string
  evitar: string
}

const CAMPOS: { chave: keyof Config; label: string; ajuda: string; exemplo: string; linhas: number }[] = [
  {
    chave: 'regra_titulo',
    label: 'Como montar o título',
    ajuda: 'Vale para as 3 sugestões de título que a IA oferece ao criar ou enriquecer um anúncio.',
    exemplo: 'Ex.: comece pelo tipo do produto, nunca pela marca; escreva por extenso, sem "c/" nem "p/"; inclua a aplicação ou a forma de usar.',
    linhas: 4,
  },
  {
    chave: 'regra_descricao',
    label: 'O que não pode faltar na descrição',
    ajuda: 'A IA usa isso como checklist ao escrever a descrição do anúncio.',
    exemplo: 'Ex.: para que serve, material, medidas, o que acompanha, e uma frase sobre onde se usa.',
    linhas: 4,
  },
  {
    chave: 'tom_voz',
    label: 'Tom de voz',
    ajuda: 'Como o texto deve soar para o cliente.',
    exemplo: 'Ex.: direto e prático, como quem explica no balcão.',
    linhas: 2,
  },
  {
    chave: 'evitar',
    label: 'O que nunca usar',
    ajuda: 'Lista do que a IA deve evitar em qualquer texto de anúncio.',
    exemplo: 'Ex.: emoji, CAIXA ALTA, "melhor preço", "imperdível".',
    linhas: 3,
  },
]

export default function PadraoAnuncioConfig({ empresaId, configInicial }: {
  empresaId: string
  configInicial: Partial<Config> | null
}) {
  const [form, setForm] = useState<Config>({
    regra_titulo: configInicial?.regra_titulo ?? '',
    regra_descricao: configInicial?.regra_descricao ?? '',
    tom_voz: configInicial?.tom_voz ?? '',
    evitar: configInicial?.evitar ?? '',
  })
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true); setMsg(''); setErro('')
    const sb = createClient()
    const { error } = await sb.from('empresa_config_anuncio').upsert({
      empresa_id: empresaId,
      regra_titulo: form.regra_titulo.trim() || null,
      regra_descricao: form.regra_descricao.trim() || null,
      tom_voz: form.tom_voz.trim() || null,
      evitar: form.evitar.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'empresa_id' })
    setSalvando(false)
    if (error) { setErro('Erro ao salvar: ' + error.message); return }
    setMsg('✓ Padrão salvo — vale a partir da próxima vez que você usar a IA.')
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
        <span>início</span><span>›</span><span>configurações</span><span>›</span>
        <span className="text-gray-600 font-medium">Padrão de anúncios</span>
      </div>

      <h1 className="text-gray-900 text-xl font-semibold">Padrão de anúncios</h1>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Escreva aqui, com suas palavras, como a IA deve montar título e descrição dos seus anúncios.
        Essas regras acompanham todo pedido de IA — ao criar anúncio na Shopee, no Mercado Livre e ao
        preencher o cadastro do produto.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
        {CAMPOS.map(c => (
          <div key={c.chave}>
            <label className="block text-sm font-medium text-gray-800">{c.label}</label>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">{c.ajuda}</p>
            <textarea
              value={form[c.chave]}
              onChange={e => setForm(f => ({ ...f, [c.chave]: e.target.value }))}
              rows={c.linhas}
              placeholder={c.exemplo}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mt-4">
        <p className="text-xs text-amber-800">
          Duas coisas continuam valendo mesmo que você escreva o contrário aqui: os limites da plataforma
          (título de 120 caracteres na Shopee, 60 no Mercado Livre) e a proibição de inventar característica
          que não esteja no cadastro do produto. Anúncio com dado falso gera reclamação e devolução.
        </p>
      </div>

      {erro && <p className="text-sm text-red-600 mt-3">{erro}</p>}
      {msg && <p className="text-sm text-emerald-600 mt-3">{msg}</p>}

      <div className="flex justify-end mt-4">
        <button onClick={salvar} disabled={salvando}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          {salvando ? 'Salvando...' : 'Salvar padrão'}
        </button>
      </div>
    </div>
  )
}
