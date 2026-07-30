'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gerarComprovanteVendaPdfBlob, abrirPdfEmNovaAba, type ConfigImpressao, type FormatoImpressao } from '@/lib/vendas/comprovantePdf'

const FORMATOS: { id: FormatoImpressao; nome: string; detalhe: string }[] = [
  { id: 'a4', nome: 'A4', detalhe: 'Folha comum, em impressora normal. Itens em tabela.' },
  { id: 'bobina_80', nome: 'Bobina 80mm', detalhe: 'Impressora térmica de cupom (a mais comum no balcão).' },
  { id: 'bobina_58', nome: 'Bobina 58mm', detalhe: 'Impressora térmica estreita, de mesa ou portátil.' },
]

export default function ImpressaoConfig({ empresaId, empresaNome, configInicial }: {
  empresaId: string
  empresaNome: string
  configInicial: ConfigImpressao | null
}) {
  const [formato, setFormato] = useState<FormatoImpressao>(configInicial?.formato ?? 'a4')
  const [mensagem, setMensagem] = useState(configInicial?.mensagem_rodape ?? '')
  const [mostrarSku, setMostrarSku] = useState(configInicial?.mostrar_sku ?? true)
  const [salvando, setSalvando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null)
  const [gerandoModelo, setGerandoModelo] = useState(false)

  const config: ConfigImpressao = { formato, mensagem_rodape: mensagem.trim() || null, mostrar_sku: mostrarSku }

  async function salvar() {
    setSalvando(true); setResultado(null)
    const sb = createClient()
    const { error } = await sb.from('empresa_config_impressao').upsert({
      empresa_id: empresaId,
      formato,
      mensagem_rodape: mensagem.trim() || null,
      mostrar_sku: mostrarSku,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'empresa_id' })
    setResultado(error
      ? { ok: false, msg: error.message }
      : { ok: true, msg: 'Preferências de impressão salvas.' })
    setSalvando(false)
  }

  // Gera um cupom de exemplo com os valores atuais do formulário (mesmo
  // gerador usado na venda de verdade), pra conferir no papel antes de salvar.
  async function verModelo() {
    setGerandoModelo(true)
    try {
      const blob = await gerarComprovanteVendaPdfBlob({
        empresa: {
          nome: empresaNome, cnpj: '00.000.000/0001-00', telefone: '(21) 90000-0000',
          logradouro: 'Rua de Exemplo', numero: '100', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ',
        },
        cliente: { nome: 'Cliente de exemplo', cpf_cnpj: null, telefone: null },
        venda: {
          numero: 1234, created_at: new Date().toISOString(), status: 'concluida', tipo_operacao: 'venda',
          forma_pagamento: 'dinheiro', pagamentos: [{ forma: 'dinheiro', valor: 87.4 }],
          subtotal: 92.4, desconto: 5, total: 87.4, valor_pago: 100, troco: 12.6,
          observacao: null, nfce_status: null, nfce_numero: null, nfce_chave: null,
        },
        itens: [
          { produto_nome: 'ARAME FARPADO 50MT', produto_sku: '3914', quantidade: 1, preco_unitario: 68.9, desconto: 0, total: 68.9, tipo: 'venda' },
          { produto_nome: 'BUCHA TRIFIX 10', produto_sku: '5412', quantidade: 20, preco_unitario: 0.35, desconto: 0, total: 7, tipo: 'venda' },
          { produto_nome: 'FITA ISOLANTE 10 METROS', produto_sku: '65', quantidade: 3, preco_unitario: 5.5, desconto: 0, total: 16.5, tipo: 'venda' },
        ],
        config,
      })
      abrirPdfEmNovaAba(blob)
    } catch (e: any) {
      setResultado({ ok: false, msg: 'Erro ao gerar o modelo: ' + (e?.message ?? e) })
    } finally {
      setGerandoModelo(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Impressão</h1>
      <p className="text-sm text-gray-500 mb-6">
        Como o comprovante de venda é impresso. Vale para o botão Imprimir da tela de Vendas,
        do PDV e para o comprovante enviado por WhatsApp.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-6">
        <div>
          <p className="text-sm font-medium text-gray-800 mb-2">Formato do papel</p>
          <div className="space-y-2">
            {FORMATOS.map(f => (
              <label key={f.id}
                className={`flex items-start gap-3 border rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                  formato === f.id ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'
                }`}>
                <input type="radio" name="formato" checked={formato === f.id} onChange={() => setFormato(f.id)}
                  className="mt-0.5 w-4 h-4 accent-blue-600" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{f.nome}</span>
                  <span className="block text-xs text-gray-500">{f.detalhe}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1">Mensagem final do cupom</label>
          <p className="text-xs text-gray-500 mb-2">
            Aparece em destaque no fim do comprovante. Ex.: agradecimento, prazo de troca, redes sociais.
          </p>
          <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={3} maxLength={200}
            placeholder="Obrigado pela preferência! Trocas em até 7 dias com este comprovante."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500 resize-y" />
          <p className="text-xs text-gray-400 mt-1">{mensagem.length}/200</p>
        </div>

        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={mostrarSku} onChange={e => setMostrarSku(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-600" />
            <span>
              <span className="block text-sm font-medium text-gray-900">Mostrar o código (SKU) ao lado do produto</span>
              <span className="block text-xs text-gray-500">
                Em bobina o espaço é curto — desligar deixa o nome do produto mais legível.
              </span>
            </span>
          </label>
        </div>

        {resultado && (
          <p className={`text-sm rounded-lg px-3 py-2 ${resultado.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            {resultado.ok ? '✓ ' : '⚠ '}{resultado.msg}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={salvar} disabled={salvando}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
          <button onClick={verModelo} disabled={gerandoModelo}
            className="px-4 py-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg">
            {gerandoModelo ? 'Gerando...' : '🖨️ Ver modelo'}
          </button>
          <span className="text-xs text-gray-400">O modelo usa os valores da tela, mesmo sem salvar.</span>
        </div>
      </div>
    </div>
  )
}
