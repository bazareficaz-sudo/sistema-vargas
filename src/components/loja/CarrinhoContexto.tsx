'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// Carrinho do visitante — Fase 1: vive no navegador.
//
// É a escolha certa para agora: sem cadastro, sem cookie de sessão, sem
// escrita no banco a cada clique num item. As tabelas `loja_carrinhos` e
// `loja_carrinho_itens` já existem para a Fase 3 sincronizar o carrinho do
// cliente identificado — quando isso chegar, este módulo passa a espelhar,
// não a ser substituído.
//
// O que NÃO fica aqui, e é o ponto importante: a conferência. Preço e saldo
// guardados no navegador envelhecem. Quem confere é o servidor, em
// src/lib/commerce/carrinho.ts, toda vez que a página do carrinho abre.
// Este módulo guarda a INTENÇÃO do cliente; o valor de verdade vem do banco.

export type ItemLocal = {
  produtoId: string
  slug: string
  nome: string
  imagemUrl: string | null
  /** Preço no momento em que entrou. Serve para detectar mudança, não para cobrar. */
  precoVisto: number
  quantidade: number
}

type Carrinho = {
  itens: ItemLocal[]
  quantidadeTotal: number
  carregado: boolean
  adicionar: (item: Omit<ItemLocal, 'quantidade'>, quantidade?: number) => void
  alterar: (produtoId: string, quantidade: number) => void
  remover: (produtoId: string) => void
  limpar: () => void
}

const Ctx = createContext<Carrinho | null>(null)

/** Uma chave por loja: no mesmo navegador, duas lojas não podem se misturar. */
const chave = (lojaId: string) => `loja:${lojaId}:carrinho`

const MAX_ITENS = 100
const MAX_QTD = 9999

function ler(k: string): ItemLocal[] {
  try {
    const bruto = localStorage.getItem(k)
    if (!bruto) return []
    const dados = JSON.parse(bruto)
    if (!Array.isArray(dados)) return []
    // localStorage é entrada do usuário: pode ter sido editada à mão, ou ter
    // sobrado de uma versão anterior do formato. Validar item a item, e
    // descartar o que não serve, em vez de confiar e quebrar a página.
    return dados
      .filter((i: unknown): i is ItemLocal =>
        !!i && typeof i === 'object' &&
        typeof (i as ItemLocal).produtoId === 'string' &&
        typeof (i as ItemLocal).slug === 'string' &&
        Number.isFinite((i as ItemLocal).quantidade))
      .slice(0, MAX_ITENS)
      .map(i => ({ ...i, quantidade: Math.min(Math.max(Math.floor(i.quantidade), 1), MAX_QTD) }))
  } catch {
    return []
  }
}

export function CarrinhoProvider({ lojaId, children }: { lojaId: string; children: React.ReactNode }) {
  const [itens, setItens] = useState<ItemLocal[]>([])
  const [carregado, setCarregado] = useState(false)

  // Só depois da montagem: no servidor não existe localStorage, e ler durante
  // a renderização causaria diferença entre servidor e cliente (hidratação).
  useEffect(() => {
    setItens(ler(chave(lojaId)))
    setCarregado(true)
  }, [lojaId])

  useEffect(() => {
    if (!carregado) return
    try { localStorage.setItem(chave(lojaId), JSON.stringify(itens)) } catch {}
  }, [itens, lojaId, carregado])

  // Duas abas abertas na mesma loja não podem ter carrinhos diferentes.
  useEffect(() => {
    const k = chave(lojaId)
    const aoMudar = (e: StorageEvent) => { if (e.key === k) setItens(ler(k)) }
    window.addEventListener('storage', aoMudar)
    return () => window.removeEventListener('storage', aoMudar)
  }, [lojaId])

  const adicionar = useCallback((item: Omit<ItemLocal, 'quantidade'>, quantidade = 1) => {
    setItens(atual => {
      const i = atual.findIndex(x => x.produtoId === item.produtoId)
      if (i >= 0) {
        const copia = [...atual]
        copia[i] = { ...copia[i], quantidade: Math.min(copia[i].quantidade + quantidade, MAX_QTD) }
        return copia
      }
      if (atual.length >= MAX_ITENS) return atual
      return [...atual, { ...item, quantidade: Math.max(1, quantidade) }]
    })
  }, [])

  const alterar = useCallback((produtoId: string, quantidade: number) => {
    setItens(atual => quantidade <= 0
      ? atual.filter(x => x.produtoId !== produtoId)
      : atual.map(x => x.produtoId === produtoId
          ? { ...x, quantidade: Math.min(Math.floor(quantidade), MAX_QTD) } : x))
  }, [])

  const remover = useCallback((produtoId: string) => {
    setItens(atual => atual.filter(x => x.produtoId !== produtoId))
  }, [])

  const limpar = useCallback(() => setItens([]), [])

  const valor = useMemo<Carrinho>(() => ({
    itens,
    quantidadeTotal: itens.reduce((s, i) => s + i.quantidade, 0),
    carregado, adicionar, alterar, remover, limpar,
  }), [itens, carregado, adicionar, alterar, remover, limpar])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useCarrinho(): Carrinho {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCarrinho precisa estar dentro de <CarrinhoProvider>')
  return c
}
