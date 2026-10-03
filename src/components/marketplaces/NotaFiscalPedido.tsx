'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Bloco "Nota Fiscal" do pedido de marketplace: NF-e modelo 55.
//
// Em dois passos, de propósito: "Conferir nota" mostra o que vai sair
// (situação da venda, CFOP e CSOSN/CST de cada item, destinatário) e o que
// impede a emissão — sem enviar nada. Só depois aparece "Emitir". Quem
// emite vê a nota antes, e um bloqueio (produto sem perfil, endereço
// mascarado) aparece com o nome do produto em vez de virar rejeição da SEFAZ.
//
// O estado da emissão é lido aqui, e não na listagem de pedidos: o registro
// traz DANFE e XML, pesados demais para vir em centenas de linhas.

type Emissao = {
  status?: string; ambiente?: 'producao' | 'homologacao'; numero?: string | null; chave?: string | null
  danfeUrl?: string | null; motivoRejeicao?: string | null; emitenteNome?: string; em?: string
}

type Linha = { nome: string; sku: string | null; quantidade: number; valor: number; perfil: string | null; cfop: string | null; icmsSituacao: string | null; aliquotaIcms: number | null }

type Previa = {
  podeEmitir: boolean
  erros: string[]
  resumo: { situacaoRotulo: string | null; regime: 'simples' | 'normal'; difal: boolean; total: number; linhas: Linha[] }
  emitente: { nome: string; ambiente: 'producao' | 'homologacao' }
  destinatario: { nome: string | null; cpfCnpj: string | null; endereco: { municipio: string | null; uf: string | null } }
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// CPF/CNPJ na tela só com o começo e o fim — o suficiente para conferir.
function documentoParcial(doc: string | null): string {
  if (!doc) return '—'
  return doc.length <= 6 ? doc : `${doc.slice(0, 3)}…${doc.slice(-2)}`
}

function SeloAmbiente({ ambiente }: { ambiente?: string }) {
  if (ambiente !== 'homologacao') return null
  return <span className="ml-1 text-[10px] font-semibold uppercase bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">homologação · sem valor fiscal</span>
}

async function lerEstado(pedidoId: string, vendaId: string | null): Promise<{
  emissao: Emissao | null
  nfceAntiga: { numero: string; danfeUrl: string | null } | null
}> {
  const sb = createClient()
  const { data } = await sb.from('marketplace_pedidos').select('nfe_status, nfe_emissao').eq('id', pedidoId).maybeSingle()
  const emissao = data?.nfe_emissao ? { ...data.nfe_emissao, status: data.nfe_status ?? data.nfe_emissao.status } : null
  // Pedido faturado antes desta tela, pelo caminho antigo (NFC-e via venda).
  if (!vendaId) return { emissao, nfceAntiga: null }
  const { data: v } = await sb.from('vendas').select('nfce_status, nfce_numero, nfce_url_pdf').eq('id', vendaId).maybeSingle()
  return { emissao, nfceAntiga: v?.nfce_status === 'autorizada' ? { numero: v.nfce_numero, danfeUrl: v.nfce_url_pdf } : null }
}

export default function NotaFiscalPedido({ pedido, emitidaPor, onFaturado }: {
  pedido: { id: string; venda_id?: string | null; nfe_numero?: string | null }
  emitidaPor: string
  onFaturado: (patch: { nfe_numero: string | null; nfe_chave: string | null }) => void
}) {
  const [emissao, setEmissao] = useState<Emissao | null>(null)
  const [nfceAntiga, setNfceAntiga] = useState<{ numero: string; danfeUrl: string | null } | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [emitindo, setEmitindo] = useState(false)
  const [erro, setErro] = useState('')

  const carregarEstado = useCallback(async () => {
    const r = await lerEstado(pedido.id, pedido.venda_id ?? null)
    setEmissao(r.emissao)
    setNfceAntiga(r.nfceAntiga)
  }, [pedido.id, pedido.venda_id])

  // Trocar de pedido remonta o componente (key no pai), então prévia e erro
  // nunca vazam de um pedido para outro; aqui só se lê o estado salvo.
  useEffect(() => {
    let vivo = true
    lerEstado(pedido.id, pedido.venda_id ?? null).then(r => {
      if (!vivo) return
      setEmissao(r.emissao)
      setNfceAntiga(r.nfceAntiga)
    })
    return () => { vivo = false }
  }, [pedido.id, pedido.venda_id])

  async function conferir() {
    setCarregando(true); setErro(''); setPrevia(null)
    try {
      const resp = await fetch(`/api/marketplaces/pedidos/${pedido.id}/nfe`)
      const data = await resp.json()
      if (!data.ok) setErro(data.erro ?? 'Não foi possível montar a nota')
      else setPrevia(data)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao conferir a nota')
    } finally {
      setCarregando(false)
    }
  }

  async function emitir() {
    setEmitindo(true); setErro('')
    try {
      const resp = await fetch(`/api/marketplaces/pedidos/${pedido.id}/nfe`, { method: 'POST' })
      const data = await resp.json()
      if (data.erros?.length) setErro(data.erros.join('\n'))
      else if (!data.ok && data.erro) setErro(data.erro)
      if (data.ok && data.ambiente === 'producao') onFaturado({ nfe_numero: data.numero ?? null, nfe_chave: data.chave ?? null })
      setPrevia(null)
      await carregarEstado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao emitir')
    } finally {
      setEmitindo(false)
    }
  }

  const autorizadaProducao = emissao?.status === 'autorizada' && emissao.ambiente === 'producao'
  const informadaPorFora = !!pedido.nfe_numero && !autorizadaProducao

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-600">Nota Fiscal (NF-e)</p>
        <p className="text-[11px] text-gray-400 truncate" title="Configurável por canal em Marketplaces → canal → Configurar">
          emitida por {emitidaPor}
        </p>
      </div>

      {nfceAntiga && (
        <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
          NFC-e nº <span className="font-mono">{nfceAntiga.numero}</span> emitida anteriormente para este pedido.
          {nfceAntiga.danfeUrl && <> <a href={nfceAntiga.danfeUrl} target="_blank" rel="noreferrer" className="underline">Ver</a></>}
        </p>
      )}

      {emissao?.status === 'autorizada' && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
          <p>✓ Autorizada — Nº <span className="font-mono">{emissao.numero}</span><SeloAmbiente ambiente={emissao.ambiente} /></p>
          {emissao.chave && <p className="font-mono text-[10px] break-all mt-0.5">{emissao.chave}</p>}
          {emissao.danfeUrl && <a href={emissao.danfeUrl} target="_blank" rel="noreferrer" className="underline">Ver DANFE</a>}
        </div>
      )}
      {emissao && emissao.status !== 'autorizada' && emissao.status !== 'processando' && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 whitespace-pre-line">
          ⚠ {emissao.status === 'bloqueada'
            ? 'A emissão automática não conseguiu montar a nota'
            : `Última tentativa ${emissao.status === 'erro' ? 'com erro' : 'rejeitada'}`}<SeloAmbiente ambiente={emissao.ambiente} />
          {emissao.motivoRejeicao ? ` — ${emissao.motivoRejeicao}` : ''}
        </p>
      )}

      {informadaPorFora && (
        <p className="text-[11px] text-gray-500">NF-e nº {pedido.nfe_numero} informada manualmente — não é possível emitir outra.</p>
      )}

      {erro && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 whitespace-pre-line">{erro}</p>}

      {previa && (
        <div className="text-xs space-y-2 border-t border-gray-100 pt-2">
          <div className="text-gray-600 space-y-0.5">
            <p><span className="text-gray-400">Emitente:</span> {previa.emitente.nome}<SeloAmbiente ambiente={previa.emitente.ambiente} /></p>
            <p>
              <span className="text-gray-400">Comprador:</span> {previa.destinatario.nome ?? '—'} · {documentoParcial(previa.destinatario.cpfCnpj)}
              {previa.destinatario.endereco.municipio && <> · {previa.destinatario.endereco.municipio}/{previa.destinatario.endereco.uf}</>}
            </p>
            {previa.resumo.situacaoRotulo && <p><span className="text-gray-400">Venda:</span> {previa.resumo.situacaoRotulo}</p>}
            {previa.resumo.difal && (
              <p className="text-amber-700">Leva DIFAL (regime normal, consumidor final de outro estado).</p>
            )}
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-400 text-left">
                <th className="font-normal">Item</th><th className="font-normal">CFOP</th>
                <th className="font-normal">{previa.resumo.regime === 'simples' ? 'CSOSN' : 'CST'}</th><th className="font-normal text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {previa.resumo.linhas.map((l, i) => (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="py-1 pr-2">
                    <p className="text-gray-800">{l.quantidade}× {l.nome}</p>
                    <p className="text-[10px] text-gray-400">{l.perfil ?? 'sem perfil fiscal'}</p>
                  </td>
                  <td className="py-1 font-mono">{l.cfop ?? '—'}</td>
                  <td className="py-1 font-mono">{l.icmsSituacao ?? '—'}{l.aliquotaIcms != null && <span className="text-gray-400"> {l.aliquotaIcms}%</span>}</td>
                  <td className="py-1 text-right">{fmt(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-right font-semibold text-gray-800">Total da nota: {fmt(previa.resumo.total)}</p>
          {previa.erros.length > 0 && (
            <ul className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 space-y-1 list-disc pl-5">
              {previa.erros.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {!autorizadaProducao && !informadaPorFora && (
        previa?.podeEmitir ? (
          <button onClick={emitir} disabled={emitindo}
            className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors">
            {emitindo ? 'Emitindo...' : previa.emitente.ambiente === 'homologacao' ? '🧪 Emitir NF-e de teste (homologação)' : '🧾 Emitir NF-e'}
          </button>
        ) : (
          <button onClick={conferir} disabled={carregando || emissao?.status === 'processando'}
            className="w-full py-1.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 text-xs font-medium rounded-lg transition-colors">
            {carregando ? 'Conferindo...' : emissao?.status === 'processando' ? 'Emissão em andamento...' : previa ? '↻ Conferir de novo' : '🔎 Conferir nota antes de emitir'}
          </button>
        )
      )}
    </div>
  )
}
