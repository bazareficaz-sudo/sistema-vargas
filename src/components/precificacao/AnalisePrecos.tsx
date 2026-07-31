'use client'

import { useState } from 'react'

// Análise: o que está errado nos preços hoje, em ordem de urgência, com o
// caminho para resolver cada coisa.

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ESTILO: Record<string, { cor: string; icone: string; rotulo: string }> = {
  critico:      { cor: 'border-red-200 bg-red-50',       icone: '🔴', rotulo: 'Crítico' },
  atencao:      { cor: 'border-amber-200 bg-amber-50',   icone: '🟠', rotulo: 'Atenção' },
  oportunidade: { cor: 'border-green-200 bg-green-50',   icone: '💰', rotulo: 'Oportunidade' },
  informativo:  { cor: 'border-gray-200 bg-gray-50',     icone: 'ℹ️', rotulo: 'Informativo' },
}

export default function AnalisePrecos() {
  const [comIA, setComIA] = useState(true)
  const [comCompetitividade, setComCompetitividade] = useState(true)
  const [analisando, setAnalisando] = useState(false)
  const [d, setD] = useState<any | null>(null)
  const [erro, setErro] = useState('')

  async function analisar() {
    setAnalisando(true); setErro(''); setD(null)
    try {
      const r = await fetch('/api/precificacao/analise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comIA, comCompetitividade }),
      }).then(x => x.json())
      if (!r.ok) { setErro(r.erro ?? 'Erro na análise'); return }
      setD(r)
    } catch (e: any) {
      setErro(e.message ?? 'Erro na análise')
    } finally {
      setAnalisando(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <p className="text-sm text-gray-600">
          Varre os anúncios, confere cada preço contra as suas regras e taxas, e lista o que precisa de atenção —
          do que está dando prejuízo agora ao que pode render mais.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={comCompetitividade} onChange={e => setComCompetitividade(e.target.checked)}
              className="w-4 h-4 accent-blue-600" />
            Consultar preço da concorrência no Mercado Livre
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={comIA} onChange={e => setComIA(e.target.checked)}
              className="w-4 h-4 accent-blue-600" />
            Resumo escrito pela IA
          </label>
        </div>
        <button onClick={analisar} disabled={analisando}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg">
          {analisando ? 'Analisando... pode levar um minuto' : 'Analisar meus preços'}
        </button>
        {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
      </div>

      {d?.resumoIA && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl px-5 py-4">
          <p className="text-xs font-medium text-violet-700 mb-1">✨ Em resumo</p>
          <p className="text-sm text-violet-900 leading-relaxed">{d.resumoIA}</p>
        </div>
      )}
      {d?.erroIA && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Os achados abaixo estão completos — só o resumo escrito falhou: {d.erroIA}
        </p>
      )}

      {d && d.achados.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-8">
          Nenhum problema encontrado nos preços analisados.
        </p>
      )}

      {d?.achados.map((a: any) => {
        const e = ESTILO[a.severidade]
        return (
          <div key={a.id} className={`border rounded-xl px-4 py-3.5 ${e.cor}`}>
            <div className="flex items-start gap-2.5">
              <span className="text-lg leading-none mt-0.5">{e.icone}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{a.titulo}</p>
                <p className="text-sm text-gray-700 mt-0.5">{a.detalhe}</p>
                {a.acao && <p className="text-xs text-gray-500 mt-1.5">→ {a.acao}</p>}
              </div>
            </div>
          </div>
        )
      })}

      {/* Competitividade */}
      {d && (d.competitivos?.length > 0 || d.competitividadeIndisponivel) && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Comparação com a concorrência (Mercado Livre)
          </p>

          {d.competitividadeIndisponivel && (
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              {d.competitividadeIndisponivel}
            </p>
          )}

          {d.competitivos?.length > 0 && (
            <>
              <div className="space-y-2">
                {d.competitivos.map((c: any) => (
                  <div key={c.anuncioId} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                    <p className="text-sm text-gray-900 truncate">{c.titulo}</p>
                    <p className="text-xs text-gray-400 mb-2">{c.canalNome} · {c.statusRotulo}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      <span className="text-gray-600">Seu preço: <strong className="text-gray-900">{brl(c.precoAtual)}</strong></span>
                      <span className="text-gray-600">ML sugere: <strong className="text-gray-900">{brl(c.precoSugerido)}</strong></span>
                      {c.margemNoSugerido != null && (
                        <span className="text-gray-600">
                          Margem se adotar: <strong className={c.margemNoSugerido < 0 ? 'text-red-700' : 'text-gray-900'}>
                            {c.margemNoSugerido.toFixed(1)}%
                          </strong>
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-1.5 ${c.sugestaoCabe ? 'text-green-700' : 'text-amber-800'}`}>
                      {c.precoMinimoViavel == null
                        ? 'A regra deste produto não tem margem mínima definida — sem piso, não dá para dizer se o preço sugerido é seguro.'
                        : c.sugestaoCabe
                          ? `Dá para adotar o preço sugerido: ainda fica acima do seu piso de ${brl(c.precoMinimoViavel)}.`
                          : `Não dá para adotar: o seu piso de margem exige no mínimo ${brl(c.precoMinimoViavel)}. Baixar até o sugerido furaria a margem que você definiu.`}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Comparação oficial do Mercado Livre, limitada aos {d.limiteCompetitividade} anúncios de maior impacto.
                A Shopee não publica esse dado.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
