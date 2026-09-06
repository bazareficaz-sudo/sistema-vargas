'use client'

import { useState, useEffect } from 'react'
import { FORMAS_PAGAMENTO } from '@/lib/pdv/formasPagamento'
import { listar } from '@/lib/pdv/promocaoPagamento'

// Como a loja trabalha no balcão. Hoje, uma regra só: promoção condicionada à
// forma de pagamento.
//
// A tela mostra a FRASE RESULTANTE enquanto o gestor marca as caixas. Uma
// configuração de preço cujo efeito só aparece depois, no caixa, com o cliente
// esperando, é o tipo de coisa que se descobre errada tarde demais.

export default function ConfigPdvClient() {
  const [exigir, setExigir] = useState(false)
  const [formas, setFormas] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetch('/api/pdv/config')
      .then(r => r.json())
      .then(d => {
        if (d?.ok) { setExigir(!!d.config.exigirFormaPagamento); setFormas(d.config.formasPermitidas ?? []) }
      })
      .finally(() => setCarregando(false))
  }, [])

  function alternar(id: string) {
    setFormas(p => p.includes(id) ? p.filter(f => f !== id) : [...p, id])
    setErro(''); setAviso('')
  }

  async function salvar() {
    setSalvando(true); setErro(''); setAviso('')
    try {
      const d = await fetch('/api/pdv/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exigirFormaPagamento: exigir, formasPermitidas: formas }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível salvar'); return }
      setAviso('Salvo. Os caixas abertos passam a usar a nova regra ao recarregar o PDV.')
    } catch {
      setErro('Não foi possível salvar — verifique a conexão.')
    } finally {
      setSalvando(false)
    }
  }

  // A recusa é a mesma do servidor. Aqui ela existe para o botão poder
  // explicar o que falta antes de a pessoa clicar.
  const incompleta = exigir && formas.length === 0

  if (carregando) return <p className="text-sm text-gray-400">Carregando...</p>

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-2xl border border-gray-200 p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={exigir}
            onChange={e => { setExigir(e.target.checked); setErro(''); setAviso('') }}
            className="w-4 h-4 mt-0.5 accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-900">
              Preço promocional só em formas de pagamento específicas
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Cartão custa taxa de adquirente; Pix e dinheiro não. Com esta regra ligada, o preço
              promocional do produto só vale quando a venda é paga nas formas escolhidas abaixo —
              nas demais, o PDV cobra o preço normal e avisa o vendedor.
            </p>
          </div>
        </label>

        <div className={`mt-5 ml-7 transition-opacity ${exigir ? '' : 'opacity-40 pointer-events-none'}`}>
          <p className="text-xs font-medium text-gray-600 mb-2">
            Formas que dão direito ao preço promocional
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FORMAS_PAGAMENTO.map(f => (
              <label key={f.id}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-colors ${
                  formas.includes(f.id) ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <input type="checkbox" checked={formas.includes(f.id)}
                  onChange={() => alternar(f.id)} className="w-4 h-4 accent-emerald-600" />
                <span className="text-lg">{f.icon}</span>
                <span className="text-sm text-gray-700">{f.label}</span>
              </label>
            ))}
          </div>

          {/* A frase que o vendedor vai ler, montada aqui. Configuração de
              preço cujo efeito só aparece no caixa se descobre errada tarde. */}
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">O vendedor vai ver, no PDV:</p>
            {formas.length > 0 ? (
              <p className="text-sm text-emerald-800 font-medium">
                🏷 Preços promocionais valem só em {listar(formas)}.
              </p>
            ) : (
              <p className="text-sm text-gray-400">— escolha ao menos uma forma —</p>
            )}
          </div>
        </div>
      </div>

      {incompleta && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            Com a regra ligada e nenhuma forma escolhida, nenhuma venda cumpriria a condição e todo
            desconto sumiria em silêncio. Escolha ao menos uma forma, ou desligue a regra.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={salvar} disabled={salvando || incompleta}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
        {aviso && <span className="text-xs text-emerald-700">{aviso}</span>}
        {erro && <span className="text-xs text-red-600">{erro}</span>}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm font-medium text-gray-900 mb-2">Como fica no caixa</p>
        <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-5 leading-relaxed">
          <li>Enquanto os itens entram, o preço mostrado é o promocional — é o da etiqueta, e é o que o cliente já viu.</li>
          <li>O rodapé do PDV avisa a condição e quanto o total sobe fora dela, antes de qualquer escolha.</li>
          <li>Na tela de pagamento, as formas que mantêm o desconto ficam marcadas com <strong>promo</strong>.</li>
          <li>Ao escolher uma forma sem direito, os preços passam para o normal e o PDV diz o quanto aumentou e como recuperar.</li>
          <li>Pagamento dividido só mantém o desconto se <strong>todas</strong> as formas derem direito — meia venda no cartão não cumpre a condição.</li>
          <li>Faixa de atacado não muda: quem leva 60 paga o preço de 60 em qualquer forma de pagamento.</li>
        </ul>
      </div>
    </div>
  )
}
