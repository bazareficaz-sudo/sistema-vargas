'use client'

import { useEffect, useState } from 'react'

// Romaneio de separação — a folha que a pessoa leva para o galpão.
//
// Duas listas, porque são dois momentos do trabalho:
//   1. Separação: uma linha por produto, somada, na ordem da localização.
//      Anda-se uma vez pelo corredor em vez de uma vez por pedido.
//   2. Conferência: cada pedido com seus itens, para embalar sem trocar
//      caixa.
//
// Impressão por window.print() com CSS que esconde o resto da página. É o
// mesmo caminho que a impressora térmica e a laser do escritório entendem,
// sem depender de gerar PDF no servidor.

type ItemAgregado = {
  produtoId: string | null; nome: string; sku: string | null
  quantidade: number; pedidos: string[]; localizacao: string | null; saldo: number | null
}
type PedidoRomaneio = {
  fonte: string; id: string; numero: string; cliente: string | null; data: string | null
  canal: string; etapa: string | null; entrega: string | null; rastreio: string | null
  transportadora: string | null; prazoPostagem?: string | null; observacao: string | null
  itens: { produtoId: string | null; nome: string; sku: string | null; quantidade: number }[]
}

export default function RomaneioModal({ itens, onFechar }: {
  itens: { fonte: string; id: string }[]
  onFechar: () => void
}) {
  const [dados, setDados] = useState<{
    pedidos: PedidoRomaneio[]; agregado: ItemAgregado[]
    totalItens: number; temDeposito: boolean; empresaNome: string | null
  } | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetch('/api/pedidos/romaneio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens }),
    }).then(r => r.json()).then(d => {
      if (d.ok) setDados(d); else setErro(d.erro ?? 'Não foi possível montar o romaneio')
    }).catch(() => setErro('Falha de conexão ao montar o romaneio'))
  }, [])

  const emitidoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto print:bg-white print:p-0 print:block">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #romaneio, #romaneio * { visibility: visible; }
          #romaneio { position: absolute; left: 0; top: 0; width: 100%; }
          .sem-impressao { display: none !important; }
          .quebra-pagina { break-before: page; }
        }
      `}</style>

      <div className="bg-white rounded-xl w-full max-w-4xl my-8 print:my-0 print:rounded-none print:max-w-none">
        <div className="sem-impressao flex items-center justify-between px-5 py-3 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Romaneio de separação</h2>
            <p className="text-xs text-gray-500">{itens.length} pedido(s) selecionado(s)</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!dados}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
              🖨 Imprimir
            </button>
            <button onClick={onFechar} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Fechar
            </button>
          </div>
        </div>

        <div id="romaneio" className="p-5 text-[13px] text-black">
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          {!dados && !erro && <p className="text-sm text-gray-400">Montando o romaneio...</p>}

          {dados && (
            <>
              <div className="flex justify-between items-end border-b-2 border-black pb-2 mb-4">
                <div>
                  <h1 className="text-lg font-bold">Romaneio de separação</h1>
                  {dados.empresaNome && <p className="text-xs">{dados.empresaNome}</p>}
                </div>
                <div className="text-right text-xs">
                  <p>Emitido em {emitidoEm}</p>
                  <p>{dados.pedidos.length} pedido(s) · {dados.totalItens} peça(s)</p>
                </div>
              </div>

              {!dados.temDeposito && (
                <p className="text-xs text-amber-700 mb-3">
                  Sem depósito principal configurado — a coluna de localização fica vazia.
                </p>
              )}

              {/* 1. Separação */}
              <h2 className="text-sm font-bold mb-1">1. Lista de separação</h2>
              <p className="text-xs text-gray-600 mb-2">
                Total somado de todos os pedidos, na ordem da localização no depósito.
              </p>
              <table className="w-full border-collapse mb-6">
                <thead>
                  <tr className="border-y border-black">
                    <th className="text-left py-1 pr-2 text-xs font-semibold w-6"></th>
                    <th className="text-left py-1 pr-2 text-xs font-semibold">Local</th>
                    <th className="text-left py-1 pr-2 text-xs font-semibold">Produto</th>
                    <th className="text-left py-1 pr-2 text-xs font-semibold">SKU</th>
                    <th className="text-right py-1 pr-2 text-xs font-semibold">Pegar</th>
                    <th className="text-right py-1 text-xs font-semibold">Em estoque</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.agregado.map((a, idx) => {
                    const falta = a.saldo !== null && a.saldo < a.quantidade
                    return (
                      <tr key={idx} className="border-b border-gray-300 align-top">
                        <td className="py-1 pr-2"><span className="inline-block w-3 h-3 border border-black" /></td>
                        <td className="py-1 pr-2 font-mono text-xs">{a.localizacao ?? '—'}</td>
                        <td className="py-1 pr-2">
                          {a.nome}
                          {a.pedidos.length > 1 && (
                            <span className="block text-[10px] text-gray-600">pedidos {a.pedidos.join(', ')}</span>
                          )}
                          {!a.produtoId && <span className="block text-[10px]">⚠ sem produto vinculado no cadastro</span>}
                        </td>
                        <td className="py-1 pr-2 font-mono text-xs">{a.sku ?? '—'}</td>
                        <td className="py-1 pr-2 text-right font-bold">{a.quantidade}</td>
                        <td className={`py-1 text-right text-xs ${falta ? 'font-bold' : ''}`}>
                          {a.saldo === null ? '—' : a.saldo}{falta ? ' ⚠' : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* 2. Conferência */}
              <h2 className="text-sm font-bold mb-1 quebra-pagina">2. Conferência por pedido</h2>
              <p className="text-xs text-gray-600 mb-3">Use na hora de embalar, para o item certo entrar na caixa certa.</p>

              <div className="space-y-4">
                {dados.pedidos.map(p => (
                  <div key={`${p.fonte}-${p.id}`} className="border border-black break-inside-avoid">
                    <div className="flex justify-between items-start px-2 py-1 border-b border-black bg-gray-100">
                      <div>
                        <p className="font-bold">Pedido {p.numero}</p>
                        <p className="text-xs">
                          {p.canal}
                          {p.cliente && <> · {p.cliente}</>}
                          {p.entrega && <> · {p.entrega}</>}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        {p.data && <p>{new Date(p.data).toLocaleDateString('pt-BR')}</p>}
                        {p.transportadora && <p>{p.transportadora}</p>}
                        {p.rastreio && <p className="font-mono">{p.rastreio}</p>}
                      </div>
                    </div>
                    <table className="w-full border-collapse">
                      <tbody>
                        {p.itens.map((i, idx) => (
                          <tr key={idx} className="border-b border-gray-300 last:border-0">
                            <td className="py-1 px-2 w-6"><span className="inline-block w-3 h-3 border border-black" /></td>
                            <td className="py-1 pr-2">{i.nome}</td>
                            <td className="py-1 pr-2 font-mono text-xs">{i.sku ?? '—'}</td>
                            <td className="py-1 px-2 text-right font-bold w-16">{i.quantidade}</td>
                          </tr>
                        ))}
                        {p.itens.length === 0 && (
                          <tr><td colSpan={4} className="py-2 px-2 text-xs">Pedido sem itens registrados.</td></tr>
                        )}
                      </tbody>
                    </table>
                    {p.observacao && <p className="px-2 py-1 text-xs border-t border-gray-300">Obs.: {p.observacao}</p>}
                    <div className="px-2 py-1.5 border-t border-black text-xs flex gap-6">
                      <span>Separado por: ______________________</span>
                      <span>Conferido por: ______________________</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
