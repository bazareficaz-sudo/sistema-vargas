'use client'

import { usePathname } from 'next/navigation'
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { EntregaVitrine } from '@/lib/commerce/frete/vitrine'
import { textoDaOpcao, type PoliticaDestino } from '@/lib/commerce/frete/politica'
import { classesBotao, estiloPrimario } from './ds'

// "Para onde entregamos?" — o cliente escolhe o bairro (ou informa o CEP) uma
// vez, e a loja inteira passa a falar do frete para aquele lugar: a faixa do
// topo, a página do produto, o carrinho.
//
// O QUE FICA SALVO é só o lugar (bairro, cidade, CEP), no navegador do cliente.
// Valores e regras vêm sempre da rota `/api/loja/entrega`, lidos no servidor:
// um valor guardado no navegador envelheceria no dia em que o gestor mudasse
// a tabela de frete.

export type Selecao = {
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
}

type Resposta = { politica: PoliticaDestino; local: Selecao }

type Contexto = {
  config: EntregaVitrine
  selecao: Selecao | null
  /** Política do lugar escolhido. `null` enquanto carrega ou sem escolha. */
  politica: PoliticaDestino | null
  abrir: () => void
  limpar: () => void
  /** Abre a janela se o gatilho configurado for este momento e ainda não há escolha. */
  pedirLocal: (momento: 'carrinho') => void
}

const Ctx = createContext<Contexto | null>(null)

export function useEntrega(): Contexto {
  const c = useContext(Ctx)
  if (!c) throw new Error('useEntrega fora do EntregaProvider')
  return c
}

const chaveSalva = (lojaId: string) => `loja:${lojaId}:entrega`
const chaveDispensada = (lojaId: string) => `loja:${lojaId}:entrega-dispensada`

function lerSalva(lojaId: string): Selecao | null {
  try {
    const bruto = localStorage.getItem(chaveSalva(lojaId))
    if (!bruto) return null
    const o = JSON.parse(bruto) as Partial<Selecao>
    if (!o.bairro && !o.cep) return null
    return { bairro: o.bairro ?? null, cidade: o.cidade ?? null, uf: o.uf ?? null, cep: o.cep ?? null }
  } catch {
    return null
  }
}

const soDigitos = (v: string) => v.replace(/\D/g, '')
const mascaraCep = (v: string) => {
  const d = soDigitos(v).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export function EntregaProvider({
  lojaId, config, children,
}: {
  lojaId: string
  config: EntregaVitrine
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [selecao, setSelecao] = useState<Selecao | null>(null)
  const [politica, setPolitica] = useState<PoliticaDestino | null>(null)
  const [aberta, setAberta] = useState(false)
  const [pronto, setPronto] = useState(false)

  // Lê a escolha salva só no navegador (depois da hidratação), para o HTML do
  // servidor e o primeiro render do cliente serem iguais.
  useEffect(() => {
    setSelecao(lerSalva(lojaId))
    setPronto(true)
  }, [lojaId])

  // A política do lugar escolhido, sempre fresca do servidor.
  useEffect(() => {
    if (!config.ativo || !selecao) { setPolitica(null); return }
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const r = await fetch('/api/loja/entrega', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selecao),
        })
        const d = await r.json().catch(() => null) as ({ ativo?: boolean } & Partial<Resposta>) | null
        if (r.ok && d?.ativo && d.politica) setPolitica(d.politica)
        else setPolitica(null)
      } catch { /* sem rede: a faixa só fica sem o resumo */ }
    })()
    return () => ctrl.abort()
  }, [config.ativo, selecao])

  const abrir = useCallback(() => setAberta(true), [])
  const fechar = useCallback(() => {
    setAberta(false)
    // Dispensou sem escolher: não insiste de novo nesta visita.
    try { sessionStorage.setItem(chaveDispensada(lojaId), '1') } catch { /* modo privado */ }
  }, [lojaId])

  const escolher = useCallback((s: Selecao) => {
    setSelecao(s)
    try { localStorage.setItem(chaveSalva(lojaId), JSON.stringify(s)) } catch { /* modo privado */ }
  }, [lojaId])

  const limpar = useCallback(() => {
    setSelecao(null)
    setPolitica(null)
    try { localStorage.removeItem(chaveSalva(lojaId)) } catch { /* modo privado */ }
  }, [lojaId])

  const dispensada = () => {
    try { return sessionStorage.getItem(chaveDispensada(lojaId)) === '1' } catch { return false }
  }

  // Gatilho "entrada": abre sozinha na primeira visita. Fora do checkout e dos
  // pedidos, onde interromper atrapalha quem já está fechando a compra.
  const jaTentou = useRef(false)
  useEffect(() => {
    if (!pronto || jaTentou.current) return
    if (!config.ativo || config.gatilho !== 'entrada' || selecao || dispensada()) return
    if (/^\/(checkout|pedido)/.test(pathname)) return
    jaTentou.current = true
    const id = setTimeout(() => setAberta(true), 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, config.ativo, config.gatilho, selecao, pathname])

  const pedirLocal = useCallback((momento: 'carrinho') => {
    if (!pronto || !config.ativo || config.gatilho !== momento || selecao || dispensada()) return
    setAberta(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, config.ativo, config.gatilho, selecao])

  const valor = useMemo<Contexto>(
    () => ({ config, selecao, politica, abrir, limpar, pedirLocal }),
    [config, selecao, politica, abrir, limpar, pedirLocal],
  )

  return (
    <Ctx.Provider value={valor}>
      {children}
      {aberta && config.ativo && (
        <JanelaEntrega
          config={config} selecao={selecao}
          aoEscolher={escolher} aoFechar={fechar} aoLimpar={limpar}
        />
      )}
    </Ctx.Provider>
  )
}

// ─── Janela ──────────────────────────────────────────────────────────────────

function JanelaEntrega({
  config, selecao, aoEscolher, aoFechar, aoLimpar,
}: {
  config: EntregaVitrine
  selecao: Selecao | null
  aoEscolher: (s: Selecao) => void
  aoFechar: () => void
  aoLimpar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [cep, setCep] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resposta | null>(null)
  const botaoFechar = useRef<HTMLButtonElement>(null)

  const comBairro = config.identificacao !== 'cep'
  const comCep = config.identificacao !== 'bairro'

  useEffect(() => {
    botaoFechar.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    document.addEventListener('keydown', tecla)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = antes }
  }, [aoFechar])

  async function consultar(destino: { bairro?: string; cidade?: string | null; cep?: string }) {
    setConsultando(true); setErro(null)
    try {
      const r = await fetch('/api/loja/entrega', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(destino),
      })
      const d = await r.json().catch(() => ({})) as Partial<Resposta> & { erro?: string; ativo?: boolean }
      if (!r.ok || !d.ativo || !d.politica || !d.local) {
        setErro(d.erro ?? 'Não foi possível consultar agora. Tente de novo.')
        return
      }
      const local: Selecao = {
        bairro: d.local.bairro, cidade: d.local.cidade, uf: d.local.uf,
        cep: destino.cep ? soDigitos(destino.cep) : null,
      }
      aoEscolher(local)
      setResultado({ politica: d.politica, local })
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally {
      setConsultando(false)
    }
  }

  const termo = busca.trim().toLowerCase()
  const bairros = config.bairros.filter(b => !termo || b.bairro.toLowerCase().includes(termo))
  const cidades = [...new Set(config.bairros.map(b => b.cidade ?? ''))]
  const agrupar = cidades.length > 1

  const titulo = config.titulo?.trim() || 'Para onde entregamos?'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) aoFechar() }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={titulo}
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--borda)] p-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--tinta-forte)]">{titulo}</h2>
            <p className="mt-0.5 text-sm text-[var(--tinta-media)]">
              Veja o frete e o prazo do seu endereço — sem cadastro.
            </p>
          </div>
          <button ref={botaoFechar} onClick={aoFechar} aria-label="Fechar" className="compacto -mr-1 rounded-full p-2 text-[var(--tinta-media)] hover:bg-[var(--fundo-suave)]">
            ✕
          </button>
        </div>

        {resultado ? (
          <div className="space-y-3 overflow-y-auto p-4">
            <ResumoEntrega local={resultado.local} politica={resultado.politica} />
            <button onClick={aoFechar} className={classesBotao('primario', 'w-full')} style={estiloPrimario}>
              Continuar comprando
            </button>
            <button onClick={() => { setResultado(null); aoLimpar() }} className={classesBotao('sutil', 'w-full')}>
              Escolher outro endereço
            </button>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto p-4">
            {selecao && (
              <p className="rounded-[10px] bg-[var(--fundo-suave)] p-3 text-sm text-[var(--tinta-media)]">
                Entregando em <strong className="text-[var(--tinta-forte)]">{[selecao.bairro, selecao.cidade].filter(Boolean).join(', ') || selecao.cep}</strong>. Escolha outro para trocar.
              </p>
            )}

            {comBairro && (
              <div>
                <p className="text-sm font-semibold text-[var(--tinta-forte)]">Escolha seu bairro</p>
                {config.bairros.length > 10 && (
                  <input
                    value={busca} onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar bairro" aria-label="Buscar bairro"
                    className="mt-2 h-10 w-full rounded-[10px] border border-[var(--borda)] px-3 text-sm outline-none focus:border-[var(--loja-primaria)]"
                  />
                )}
                <div className="mt-2 max-h-56 overflow-y-auto">
                  {bairros.length === 0 && <p className="text-sm text-[var(--tinta-media)]">Nenhum bairro com esse nome.</p>}
                  {(agrupar ? cidades : ['']).map(cidade => {
                    const doGrupo = agrupar ? bairros.filter(b => (b.cidade ?? '') === cidade) : bairros
                    if (doGrupo.length === 0) return null
                    return (
                      <div key={cidade || 'todos'} className="mb-2">
                        {agrupar && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--tinta-fraca)]">{cidade || 'Outras'}</p>}
                        <div className="flex flex-wrap gap-2">
                          {doGrupo.map(b => (
                            <button
                              key={`${b.cidade}|${b.bairro}`} disabled={consultando}
                              onClick={() => consultar({ bairro: b.bairro, cidade: b.cidade })}
                              className="compacto rounded-full border border-[var(--borda)] bg-white px-3.5 py-2 text-sm font-medium text-[var(--tinta-media)] hover:border-[var(--loja-primaria)] hover:text-[var(--tinta-forte)] disabled:opacity-50"
                            >
                              {b.bairro}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {comBairro && comCep && (
              <p className="text-center text-xs text-[var(--tinta-fraca)]">— ou —</p>
            )}

            {comCep && (
              <form
                onSubmit={e => { e.preventDefault(); if (soDigitos(cep).length === 8) consultar({ cep: soDigitos(cep) }) }}
              >
                <label htmlFor="entrega-cep" className="text-sm font-semibold text-[var(--tinta-forte)]">
                  {comBairro ? 'Não achou o seu bairro? Informe o CEP' : 'Informe o seu CEP'}
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="entrega-cep" inputMode="numeric" autoComplete="postal-code"
                    placeholder="00000-000" value={cep} onChange={e => setCep(mascaraCep(e.target.value))}
                    className="h-10 min-w-0 flex-1 rounded-[10px] border border-[var(--borda)] px-3 text-sm outline-none focus:border-[var(--loja-primaria)]"
                  />
                  <button
                    type="submit" disabled={soDigitos(cep).length !== 8 || consultando}
                    className="h-10 shrink-0 rounded-[10px] border border-[var(--borda)] bg-white px-4 text-sm font-semibold text-[var(--tinta-forte)] disabled:opacity-40"
                  >
                    Consultar
                  </button>
                </div>
              </form>
            )}

            <p aria-live="polite" className="min-h-5 text-sm">
              {consultando && <span className="text-[var(--tinta-media)]">Consultando…</span>}
              {erro && <span className="text-[var(--alerta)]">{erro}</span>}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** O que o cliente precisa saber, em linguagem de balcão. */
export function ResumoEntrega({ local, politica }: { local: Selecao; politica: PoliticaDestino }) {
  const onde = [local.bairro, local.cidade].filter(Boolean).join(', ') || 'seu endereço'
  return (
    <div className="rounded-[var(--raio)] border border-[var(--borda)] p-3 text-sm">
      <p className="font-semibold text-[var(--tinta-forte)]">Entrega para {onde}</p>
      {politica.status === 'opcoes' ? (
        <ul className="mt-2 space-y-2">
          {politica.opcoes.map(o => (
            <li key={o.servico}>
              <span className="font-medium text-[var(--tinta-forte)]">{o.servico}</span>
              <span className="block text-[var(--tinta-media)]">{textoDaOpcao(o)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[var(--tinta-media)]">{politica.motivo}</p>
      )}
    </div>
  )
}
