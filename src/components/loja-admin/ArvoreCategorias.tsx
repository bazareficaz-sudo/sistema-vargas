'use client'

import { useMemo, useState } from 'react'
import { botao } from '@/components/ui/botao'

// Arrastar para ordenar e para aninhar categoria.
//
// ── Por que arrastar E botões ────────────────────────────────
//
// Arrastar é o gesto certo para "põe isto dentro daquilo", e péssimo para
// mover um item 30 posições numa lista de 48 — vira rolagem com o botão
// preso. E o arrastar nativo do HTML5 não existe no celular.
//
// Então cada linha tem os dois caminhos: arrasta, ou usa ↑ ↓ para andar entre
// irmãs e → ← para entrar e sair de uma categoria. Os botões também são o que
// faz isto funcionar por teclado.
//
// ── Onde se solta ────────────────────────────────────────────
//
// Em cima de uma linha  → vira subcategoria dela.
// Na FAIXA entre linhas → vai para aquela posição, no nível daquela faixa.
//
// As faixas são elementos de verdade, com altura própria, e não uma conta de
// "soltou nos 25% de cima". Cálculo de borda erra, e errar aqui move a
// categoria para o lugar errado sem o operador entender por quê.
//
// ── Nada é salvo enquanto não se manda salvar ────────────────
//
// A árvore vive no estado da tela até o Salvar, e vai inteira numa gravação
// só. Salvar a cada gesto encheria a vitrine de estados intermediários — e
// desfazer um arrasto errado viraria outro arrasto.

export type CatArvore = {
  id: string
  nome: string
  slug: string
  paiId: string | null
  ativo: boolean
  ordem: number
  produtos: number
}

/** Onde um arrasto pode terminar. */
type Alvo =
  | { tipo: 'dentro'; id: string }
  | { tipo: 'faixa'; paiId: string | null; indice: number }

export default function ArvoreCategorias({ categorias, onSalvar, ocupado }: {
  categorias: CatArvore[]
  onSalvar: (arvore: { id: string; paiId: string | null; ordem: number }[]) => Promise<void>
  ocupado: boolean
}) {
  const [itens, setItens] = useState<CatArvore[]>(categorias)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<Alvo | null>(null)

  const sujo = useMemo(() => {
    const antes = new Map(categorias.map(c => [c.id, `${c.paiId ?? ''}|${c.ordem}`]))
    return itens.some((c, i) => antes.get(c.id) !== `${c.paiId ?? ''}|${i}`)
  }, [itens, categorias])

  const raizes = itens.filter(c => !c.paiId)
  const filhosDe = (id: string) => itens.filter(c => c.paiId === id)

  /** Reconstrói a lista linearizada na ordem em que a árvore é desenhada. */
  function linearizar(lista: CatArvore[]): CatArvore[] {
    const saida: CatArvore[] = []
    for (const r of lista.filter(c => !c.paiId)) {
      saida.push(r)
      for (const f of lista.filter(c => c.paiId === r.id)) saida.push(f)
    }
    return saida
  }

  function mover(id: string, destino: Alvo) {
    setItens(atual => {
      const eu = atual.find(c => c.id === id)
      if (!eu) return atual

      // Uma categoria com filhas não pode virar subcategoria: a vitrine
      // desenha dois níveis, e isso criaria um terceiro. Em vez de recusar
      // em silêncio, as filhas sobem para a raiz junto — que é o que o
      // operador quis dizer ao mover a mãe para dentro de outra.
      const minhasFilhas = atual.filter(c => c.paiId === id)

      let novoPai: string | null
      let posicao: number

      if (destino.tipo === 'dentro') {
        if (destino.id === id) return atual
        const destinoTemPai = atual.find(c => c.id === destino.id)?.paiId
        // Soltar numa subcategoria vira "irmã dela", não "neta".
        novoPai = destinoTemPai ?? destino.id
        posicao = Number.MAX_SAFE_INTEGER
      } else {
        novoPai = destino.paiId
        posicao = destino.indice
      }

      const sobem = novoPai !== null ? minhasFilhas : []

      const resto = atual.filter(c => c.id !== id && !sobem.some(f => f.id === c.id))
      const irmas = resto.filter(c => (c.paiId ?? null) === novoPai)
      const outras = resto.filter(c => (c.paiId ?? null) !== novoPai)

      const alvoIdx = Math.min(Math.max(posicao, 0), irmas.length)
      const novasIrmas = [...irmas]
      novasIrmas.splice(alvoIdx, 0, { ...eu, paiId: novoPai })

      return linearizar([
        ...outras,
        ...novasIrmas,
        ...sobem.map(f => ({ ...f, paiId: null })),
      ])
    })
  }

  /** ↑ ↓ entre irmãs. */
  function andar(id: string, direcao: -1 | 1) {
    const eu = itens.find(c => c.id === id)
    if (!eu) return
    const irmas = itens.filter(c => (c.paiId ?? null) === (eu.paiId ?? null))
    const i = irmas.findIndex(c => c.id === id)
    const j = i + direcao
    if (j < 0 || j >= irmas.length) return
    mover(id, { tipo: 'faixa', paiId: eu.paiId, indice: j })
  }

  /** → entra na irmã de cima. ← volta para a raiz. */
  function aninhar(id: string) {
    const eu = itens.find(c => c.id === id)
    if (!eu || eu.paiId) return
    const raizesAgora = itens.filter(c => !c.paiId)
    const i = raizesAgora.findIndex(c => c.id === id)
    if (i <= 0) return
    mover(id, { tipo: 'dentro', id: raizesAgora[i - 1].id })
  }

  function desaninhar(id: string) {
    const eu = itens.find(c => c.id === id)
    if (!eu?.paiId) return
    const raizesAgora = itens.filter(c => !c.paiId)
    const posDoPai = raizesAgora.findIndex(c => c.id === eu.paiId)
    mover(id, { tipo: 'faixa', paiId: null, indice: posDoPai + 1 })
  }

  // `Faixa` e `Linha` moram FORA deste componente de propósito. Definidas
  // aqui dentro, elas seriam funções novas a cada render — e o React
  // remontaria a árvore inteira a cada `dragOver`, que dispara dezenas de
  // vezes por segundo durante um arrasto. O arrasto simplesmente não
  // funcionaria.
  const ctx: CtxArvore = { alvo, setAlvo, arrastando, setArrastando, mover, andar, aninhar, desaninhar }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900">Ordem e subcategorias</h2>
        <p className="mt-1 text-sm text-gray-500">
          Arraste para mover. Soltando <strong>em cima</strong> de uma categoria, ela vira
          subcategoria; soltando <strong>entre</strong> duas, muda de posição. No celular,
          use os botões ↑ ↓ → ←.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          A vitrine mostra dois níveis: categoria e subcategoria. Por isso uma subcategoria
          não pode ter outra dentro.
        </p>
      </div>

      <ul className="space-y-0.5">
        <Faixa ctx={ctx} paiId={null} indice={0} />
        {raizes.map((c, i) => (
          <div key={c.id}>
            <Linha ctx={ctx} c={c} nivel={0} />
            <ul className="space-y-0.5">
              <Faixa ctx={ctx} paiId={c.id} indice={0} />
              {filhosDe(c.id).map((f, j) => (
                <div key={f.id}>
                  <Linha ctx={ctx} c={f} nivel={1} />
                  <Faixa ctx={ctx} paiId={c.id} indice={j + 1} />
                </div>
              ))}
            </ul>
            <Faixa ctx={ctx} paiId={null} indice={i + 1} />
          </div>
        ))}
      </ul>

      {/* Barra fixa: com 48 categorias o fim da lista fica longe, e o botão
          de salvar não pode estar a uma rolagem inteira do último arrasto. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-xl md:border">
        <button
          onClick={() => onSalvar(itens.map((c, n) => ({ id: c.id, paiId: c.paiId, ordem: n })))}
          disabled={!sujo || ocupado}
          className={botao('primario')}
        >
          {ocupado ? 'Salvando…' : 'Salvar ordem'}
        </button>
        {sujo && !ocupado && (
          <>
            <span className="text-sm text-gray-500">Alterações não salvas</span>
            <button onClick={() => setItens(categorias)} className={botao('sutil', 'sm')}>
              Desfazer
            </button>
          </>
        )}
      </div>
    </div>
  )
}

type CtxArvore = {
  alvo: Alvo | null
  setAlvo: (a: Alvo | null) => void
  arrastando: string | null
  setArrastando: (id: string | null) => void
  mover: (id: string, destino: Alvo) => void
  andar: (id: string, direcao: -1 | 1) => void
  aninhar: (id: string) => void
  desaninhar: (id: string) => void
}

/**
 * A faixa entre duas linhas — onde se solta para mudar de POSIÇÃO.
 *
 * É um elemento de verdade, com altura própria, e não uma conta de "soltou
 * nos 25% de cima da linha". Cálculo de borda erra, e errar aqui move a
 * categoria para o lugar errado sem o operador entender por quê.
 */
function Faixa({ ctx, paiId, indice }: { ctx: CtxArvore; paiId: string | null; indice: number }) {
  const ativa = ctx.alvo?.tipo === 'faixa' && ctx.alvo.paiId === paiId && ctx.alvo.indice === indice
  return (
    <li
      onDragOver={e => { e.preventDefault(); ctx.setAlvo({ tipo: 'faixa', paiId, indice }) }}
      onDrop={e => {
        e.preventDefault()
        if (ctx.arrastando) ctx.mover(ctx.arrastando, { tipo: 'faixa', paiId, indice })
        ctx.setArrastando(null); ctx.setAlvo(null)
      }}
      className={`h-2 rounded transition-colors ${ativa ? 'bg-blue-500' : ''}`}
      style={{ marginLeft: paiId ? 28 : 0 }}
      aria-hidden
    />
  )
}

/** A categoria. Soltar EM CIMA dela é o gesto de "põe isto dentro". */
function Linha({ ctx, c, nivel }: { ctx: CtxArvore; c: CatArvore; nivel: number }) {
  const dentro = ctx.alvo?.tipo === 'dentro' && ctx.alvo.id === c.id
  const eEuArrastando = ctx.arrastando === c.id
  return (
    <li
      draggable
      onDragStart={() => ctx.setArrastando(c.id)}
      onDragEnd={() => { ctx.setArrastando(null); ctx.setAlvo(null) }}
      onDragOver={e => { e.preventDefault(); ctx.setAlvo({ tipo: 'dentro', id: c.id }) }}
      onDrop={e => {
        e.preventDefault()
        if (ctx.arrastando) ctx.mover(ctx.arrastando, { tipo: 'dentro', id: c.id })
        ctx.setArrastando(null); ctx.setAlvo(null)
      }}
      style={{ marginLeft: nivel * 28 }}
      className={`flex cursor-grab items-center gap-2 rounded-lg border p-2.5 ${
        eEuArrastando ? 'opacity-40' : ''} ${
        dentro ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'} ${
        c.ativo ? '' : 'opacity-60'}`}
    >
      <span className="select-none text-gray-400" aria-hidden>⠿</span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">{c.nome}</span>
        <span className="block text-xs text-gray-400">
          {c.produtos} {c.produtos === 1 ? 'produto' : 'produtos'}
          {!c.ativo && ' · escondida'}
          {nivel > 0 && ' · subcategoria'}
        </span>
      </span>

      {/* O caminho sem arrastar: celular, teclado, e mover longe. */}
      <span className="flex shrink-0 items-center gap-0.5">
        <Botao rotulo="Subir"  simbolo="↑" onClick={() => ctx.andar(c.id, -1)} />
        <Botao rotulo="Descer" simbolo="↓" onClick={() => ctx.andar(c.id, 1)} />
        {nivel === 0
          ? <Botao rotulo="Virar subcategoria da de cima" simbolo="→" onClick={() => ctx.aninhar(c.id)} />
          : <Botao rotulo="Tirar de dentro"               simbolo="←" onClick={() => ctx.desaninhar(c.id)} />}
      </span>
    </li>
  )
}

function Botao({ rotulo, simbolo, onClick }: {
  rotulo: string; simbolo: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={rotulo}
      aria-label={rotulo}
      className="h-8 w-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
    >
      {simbolo}
    </button>
  )
}
