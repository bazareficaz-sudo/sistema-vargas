'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import EnviarWhatsAppModal, { type EnviarWppPayload } from '@/components/integracoes/EnviarWhatsAppModal'
import { botao } from '@/components/ui/botao'

// A compra que originou a conta a receber.
//
// Existe pra responder a pergunta que o cliente faz no balcão: "por que tem
// R$ 23,50 na minha conta?". Mostra o que foi comprado, item a item, e deixa
// imprimir ou mandar o comprovante pro WhatsApp dele na hora.
//
// Só leitura: alterar a venda continua sendo na tela de Vendas, que tem as
// travas certas (NFC-e emitida, devolução, estoque).

type ItemVenda = {
  id: string
  produto_nome: string | null
  produto_sku: string | null
  quantidade: number
  preco_unitario: number
  desconto: number | null
  total: number
}

type VendaOrigem = {
  id: string
  numero: number | null
  created_at: string
  subtotal: number | null
  desconto: number | null
  total: number
  forma_pagamento: string | null
  canal: string | null
  observacao: string | null
  vendedor_nome: string | null
  nfce_numero: number | null
  nfce_url_pdf: string | null
}

const fmt = (v: number | null | undefined) =>
  (Number(v ?? 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function VendaDaContaModal({
  vendaId, clienteNome, clienteTelefone, contaDoc, onClose,
}: {
  vendaId: string
  clienteNome: string
  clienteTelefone?: string | null
  /** Documento da conta a receber (ex.: CART-835930), só pra situar quem abriu. */
  contaDoc?: string | null
  onClose: () => void
}) {
  const [venda, setVenda] = useState<VendaOrigem | null>(null)
  const [itens, setItens] = useState<ItemVenda[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const [wppAberto, setWppAberto] = useState(false)
  const [wppPayload, setWppPayload] = useState<EnviarWppPayload>({ telefone: '', mensagem: '' })

  useEffect(() => {
    let ativo = true
    ;(async () => {
      const sb = createClient()
      const { data: v, error: e1 } = await sb
        .from('vendas')
        .select('id, numero, created_at, subtotal, desconto, total, forma_pagamento, canal, observacao, vendedor_nome, nfce_numero, nfce_url_pdf')
        .eq('id', vendaId).maybeSingle()
      if (!ativo) return
      if (e1 || !v) {
        // Acontece com conta lançada à mão, sem venda por trás. Dizer isso é
        // melhor que mostrar um modal vazio.
        setErro('A venda de origem não foi encontrada. Esta conta pode ter sido lançada manualmente.')
        setCarregando(false)
        return
      }
      setVenda(v as VendaOrigem)

      const { data: its } = await sb
        .from('venda_itens')
        .select('id, produto_nome, produto_sku, quantidade, preco_unitario, desconto, total')
        .eq('venda_id', vendaId).eq('tipo', 'venda').order('created_at', { ascending: true })
      if (!ativo) return
      setItens(its ?? [])
      setCarregando(false)
    })()
    return () => { ativo = false }
  }, [vendaId])

  // Mesmo caminho que a tela de Vendas usa: o PDF é gerado no servidor e sobe
  // pro storage, então a mesma URL serve pra abrir e pra anexar no WhatsApp.
  async function gerarPdf(): Promise<string | null> {
    setGerandoPdf(true)
    try {
      const res = await fetch(`/api/vendas/${vendaId}/comprovante-pdf`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) { setErro(data.erro ?? 'Não foi possível gerar o comprovante'); return null }
      return data.url as string
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Falha ao gerar o comprovante')
      return null
    } finally {
      setGerandoPdf(false)
    }
  }

  async function imprimir() {
    const url = await gerarPdf()
    if (url) window.open(url, '_blank')
  }

  async function enviarWhatsapp() {
    const url = await gerarPdf()
    if (!url) return
    setWppPayload({
      telefone: clienteTelefone ?? '',
      mensagem: `Olá, ${clienteNome}! Segue o comprovante da compra${venda?.numero ? ` #${venda.numero}` : ''} de ${venda ? dataHora(venda.created_at).slice(0, 10) : ''} — total ${fmt(venda?.total)}.`,
      tipo: 'comprovante_venda',
      cliente_nome: clienteNome,
      referencia_tipo: 'venda',
      referencia_id: vendaId,
      pdf_url: url,
    })
    setWppAberto(true)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">
                Compra que gerou esta conta
                {venda?.numero ? <span className="text-gray-400 font-normal"> · venda #{venda.numero}</span> : null}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {clienteNome}
                {contaDoc ? <span className="text-gray-400"> · {contaDoc}</span> : null}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>

          <div className="px-6 py-5 overflow-y-auto space-y-4">
            {carregando && <p className="text-sm text-gray-400 text-center py-8">Carregando…</p>}

            {erro && !carregando && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{erro}</p>
            )}

            {venda && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Data</p>
                    <p className="text-gray-800">{dataHora(venda.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Pagamento</p>
                    <p className="text-gray-800 capitalize">{venda.forma_pagamento ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Canal</p>
                    <p className="text-gray-800 capitalize">{venda.canal ?? 'PDV'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Vendedor</p>
                    <p className="text-gray-800">{venda.vendedor_nome ?? '—'}</p>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Produto</th>
                        <th className="px-3 py-2 text-right font-medium">Qtd</th>
                        <th className="px-3 py-2 text-right font-medium">Unit.</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {itens.map(i => (
                        <tr key={i.id}>
                          <td className="px-3 py-2 text-gray-800">
                            {i.produto_nome ?? '—'}
                            {i.produto_sku && <span className="text-xs text-gray-400"> · {i.produto_sku}</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">{i.quantidade}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{fmt(i.preco_unitario)}</td>
                          <td className="px-3 py-2 text-right text-gray-800">{fmt(i.total)}</td>
                        </tr>
                      ))}
                      {itens.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">Sem itens registrados nesta venda.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col items-end gap-0.5 text-sm">
                  {Number(venda.desconto ?? 0) > 0 && (
                    <>
                      <p className="text-gray-500">Subtotal <span className="text-gray-800 ml-2">{fmt(venda.subtotal)}</span></p>
                      <p className="text-gray-500">Desconto <span className="text-emerald-700 ml-2">− {fmt(venda.desconto)}</span></p>
                    </>
                  )}
                  <p className="text-base font-semibold text-gray-900">Total {fmt(venda.total)}</p>
                </div>

                {venda.observacao && (
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">{venda.observacao}</p>
                )}

                {venda.nfce_numero && (
                  <p className="text-xs text-gray-500">
                    NFC-e {venda.nfce_numero}
                    {venda.nfce_url_pdf && (
                      <>{' · '}<a href={venda.nfce_url_pdf} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">ver documento</a></>
                    )}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/vendas?venda=${vendaId}`} className={botao('sutil', 'sm')}>Abrir na tela de Vendas</Link>
            <div className="flex-1" />
            <button onClick={onClose} className={botao('secundario', 'sm')}>Fechar</button>
            <button onClick={imprimir} disabled={!venda || gerandoPdf} className={botao('secundario', 'sm')}>
              {gerandoPdf ? 'Gerando…' : 'Imprimir'}
            </button>
            <button onClick={enviarWhatsapp} disabled={!venda || gerandoPdf} className={botao('primario', 'sm')}>
              Enviar por WhatsApp
            </button>
          </div>
        </div>
      </div>

      <EnviarWhatsAppModal
        aberto={wppAberto}
        titulo="Enviar comprovante"
        payload={wppPayload}
        onChange={setWppPayload}
        onClose={() => setWppAberto(false)}
      />
    </>
  )
}
