'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { EmpresaDoUsuario } from '@/lib/auth/empresaAtiva'

// Troca da empresa em que a sessão está trabalhando.
//
// Não aparece para quem tem uma empresa só — que é o caso da maioria. Só
// existe quando o usuário tem vínculo com duas ou mais em `usuario_empresas`.
//
// Duas decisões de tela que não são enfeite:
//
// 1. A empresa ativa fica escrita por extenso, sempre, com uma faixa de cor
//    derivada do nome. Dar entrada de nota na empresa errada é erro que só
//    aparece no fechamento — o nome no canto é o que evita.
// 2. A troca recarrega a página inteira (`router.refresh()`). Metade das
//    telas carrega dados no servidor; trocar a empresa sem recarregar
//    deixaria a tela mostrando dados da empresa anterior com o nome da nova
//    no cabeçalho, que é pior do que não trocar.

/** Cor estável a partir do nome — a mesma empresa tem sempre a mesma faixa. */
function corDaEmpresa(nome: string): string {
  const cores = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2']
  let soma = 0
  for (let i = 0; i < nome.length; i++) soma += nome.charCodeAt(i)
  return cores[soma % cores.length]
}

export default function SeletorEmpresa({ empresas, ativaId, compacto = false }: {
  empresas: EmpresaDoUsuario[]
  ativaId: string
  /** Barra lateral recolhida: só cabe a faixa de cor. */
  compacto?: boolean
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  // A barra lateral tem `overflow-hidden`: um menu posicionado dentro dela
  // seria recortado e simplesmente não apareceria. Por isso o painel é
  // `fixed`, com a posição medida a partir do botão.
  const botaoRef = useRef<HTMLButtonElement>(null)
  const [posicao, setPosicao] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  function alternar() {
    const r = botaoRef.current?.getBoundingClientRect()
    if (r) {
      const largura = 256
      setPosicao({
        top: r.bottom + 6,
        // Não deixa passar da borda direita da janela.
        left: Math.min(r.left, window.innerWidth - largura - 8),
      })
    }
    setAberto(a => !a)
  }
  const [trocando, setTrocando] = useState(false)
  const [erro, setErro] = useState('')

  const ativa = empresas.find(e => e.id === ativaId) ?? empresas[0]
  if (!ativa || empresas.length < 2) return null

  async function trocar(id: string) {
    if (id === ativaId) { setAberto(false); return }
    setTrocando(true); setErro('')
    try {
      const d = await fetch('/api/empresa-ativa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: id }),
      }).then(r => r.json())
      if (!d.ok) { setErro(d.erro ?? 'Não foi possível trocar'); return }
      setAberto(false)
      router.refresh()
    } catch {
      setErro('Falha de rede')
    } finally {
      setTrocando(false)
    }
  }

  return (
    <div className="relative">
      <button ref={botaoRef} onClick={alternar} disabled={trocando}
        title={`${ativa.nome} — clique para trocar de empresa`}
        className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 ${
          compacto ? 'px-1.5 py-1 justify-center' : 'px-2.5 py-1.5 max-w-[220px] w-full'
        }`}>
        <span className="w-1.5 h-5 rounded-full shrink-0" style={{ background: corDaEmpresa(ativa.nome) }} />
        {!compacto && <span className="text-xs font-semibold text-slate-800 truncate">{ativa.nome}</span>}
        <span className="text-[10px] text-slate-400 shrink-0">{trocando ? '…' : '▾'}</span>
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setAberto(false)} />
          <div className="fixed w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-[61] overflow-hidden"
            style={{ top: posicao.top, left: posicao.left }}>
            <p className="px-3 py-2 text-[11px] text-slate-400 border-b border-slate-100">
              Trabalhando em
            </p>
            {empresas.map(e => (
              <button key={e.id} onClick={() => trocar(e.id)} disabled={trocando}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50 ${
                  e.id === ativaId ? 'bg-slate-50' : ''
                }`}>
                <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: corDaEmpresa(e.nome) }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-slate-800 truncate">{e.nome}</span>
                  <span className="block text-[10px] text-slate-400">
                    {e.perfil}{e.padrao ? ' · padrão' : ''}
                  </span>
                </span>
                {e.id === ativaId && <span className="text-emerald-600 text-xs shrink-0">✓</span>}
              </button>
            ))}
            {erro && <p className="px-3 py-2 text-[11px] text-red-600 border-t border-slate-100">{erro}</p>}
            <p className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100">
              Vale para tudo: PDV, entradas, relatórios. Confira antes de lançar.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
