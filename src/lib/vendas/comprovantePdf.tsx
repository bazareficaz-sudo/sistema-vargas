import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer'

// Sem Image/canvas de propósito — precisa rodar tanto no browser (botão
// "Imprimir") quanto em uma API route Node (pra anexar no WhatsApp via
// Z-API, que exige uma URL, não um blob local).

export type EmpresaComprovante = {
  nome: string
  cnpj: string | null
  telefone: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}

export type ClienteComprovante = { nome: string; cpf_cnpj: string | null; telefone: string | null } | null

export type ItemComprovante = {
  produto_nome: string
  produto_sku: string | null
  quantidade: number
  preco_unitario: number
  desconto: number | null
  total: number
  tipo: string
}

export type VendaComprovante = {
  numero: number | string
  created_at: string
  status: string
  tipo_operacao: string
  forma_pagamento: string
  pagamentos: { forma: string; valor: number }[] | null
  subtotal: number
  desconto: number
  total: number
  valor_pago: number | null
  troco: number | null
  observacao: string | null
  nfce_status: string | null
  nfce_numero: string | null
  nfce_chave: string | null
}

const FORMA_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito',
  pix: 'Pix', carteira: 'Carteira/crédito loja', fiado: 'Fiado', troca: 'Troca', multiplo: 'Múltiplo',
}

function fmt(v: number) { return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: 'Helvetica', color: '#1f2937' },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  muted: { color: '#6b7280', fontSize: 8 },
  section: { marginTop: 12, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 3 },
  sectionTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', color: '#374151' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 4, paddingHorizontal: 4, marginTop: 8 },
  tableRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  colNome: { width: '46%' },
  colQtd: { width: '12%', textAlign: 'right' },
  colUnit: { width: '17%', textAlign: 'right' },
  colTotal: { width: '25%', textAlign: 'right' },
  totais: { marginTop: 10, alignItems: 'flex-end' },
  totalLinha: { flexDirection: 'row', width: 220, justifyContent: 'space-between', marginTop: 2 },
  totalFinal: { flexDirection: 'row', width: 220, justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#1f2937' },
  totalFinalLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  totalFinalValor: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  footer: { marginTop: 24, textAlign: 'center', color: '#9ca3af', fontSize: 8 },
})

export function ComprovanteVendaDocument({ empresa, cliente, venda, itens }: {
  empresa: EmpresaComprovante; cliente: ClienteComprovante; venda: VendaComprovante; itens: ItemComprovante[]
}) {
  const endereco = [empresa.logradouro, empresa.numero, empresa.bairro, empresa.cidade, empresa.uf].filter(Boolean).join(', ')
  const itensVenda = itens.filter(i => i.tipo !== 'devolucao')
  const itensDevolvidos = itens.filter(i => i.tipo === 'devolucao')

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>{empresa.nome}</Text>
        {empresa.cnpj && <Text style={s.muted}>CNPJ: {empresa.cnpj}</Text>}
        {endereco && <Text style={s.muted}>{endereco}</Text>}
        {empresa.telefone && <Text style={s.muted}>{empresa.telefone}</Text>}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Comprovante de venda #{venda.numero}</Text>
        </View>
        <View style={s.row}>
          <Text>Data: {new Date(venda.created_at).toLocaleString('pt-BR')}</Text>
          <Text>Status: {venda.status}</Text>
        </View>
        <View style={s.row}>
          <Text>Cliente: {cliente?.nome ?? 'Consumidor'}</Text>
          {cliente?.cpf_cnpj && <Text>CPF/CNPJ: {cliente.cpf_cnpj}</Text>}
        </View>

        <View style={s.tableHeader}>
          <Text style={[s.colNome, { fontFamily: 'Helvetica-Bold' }]}>Produto</Text>
          <Text style={[s.colQtd, { fontFamily: 'Helvetica-Bold' }]}>Qtd</Text>
          <Text style={[s.colUnit, { fontFamily: 'Helvetica-Bold' }]}>Unitário</Text>
          <Text style={[s.colTotal, { fontFamily: 'Helvetica-Bold' }]}>Total</Text>
        </View>
        {itensVenda.map((i, idx) => (
          <View key={idx} style={s.tableRow}>
            <Text style={s.colNome}>{i.produto_nome}{i.produto_sku ? ` (${i.produto_sku})` : ''}</Text>
            <Text style={s.colQtd}>{i.quantidade}</Text>
            <Text style={s.colUnit}>{fmt(i.preco_unitario)}</Text>
            <Text style={s.colTotal}>{fmt(i.total)}</Text>
          </View>
        ))}

        {itensDevolvidos.length > 0 && (
          <>
            <View style={[s.section, { marginTop: 10 }]}>
              <Text style={s.sectionTitle}>Itens devolvidos</Text>
            </View>
            {itensDevolvidos.map((i, idx) => (
              <View key={idx} style={s.tableRow}>
                <Text style={s.colNome}>{i.produto_nome}{i.produto_sku ? ` (${i.produto_sku})` : ''}</Text>
                <Text style={s.colQtd}>{i.quantidade}</Text>
                <Text style={s.colUnit}>{fmt(i.preco_unitario)}</Text>
                <Text style={s.colTotal}>-{fmt(i.total)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={s.totais}>
          <View style={s.totalLinha}><Text>Subtotal</Text><Text>{fmt(venda.subtotal)}</Text></View>
          {venda.desconto > 0 && <View style={s.totalLinha}><Text>Desconto</Text><Text>-{fmt(venda.desconto)}</Text></View>}
          <View style={s.totalFinal}>
            <Text style={s.totalFinalLabel}>Total</Text>
            <Text style={s.totalFinalValor}>{fmt(venda.total)}</Text>
          </View>
          {venda.valor_pago != null && venda.valor_pago > 0 && (
            <View style={s.totalLinha}><Text>Pago</Text><Text>{fmt(venda.valor_pago)}</Text></View>
          )}
          {venda.troco != null && venda.troco > 0 && (
            <View style={s.totalLinha}><Text>Troco</Text><Text>{fmt(venda.troco)}</Text></View>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Forma de pagamento</Text>
        </View>
        {(venda.pagamentos ?? []).length > 0 ? (
          venda.pagamentos!.map((p, idx) => (
            <View key={idx} style={s.row}><Text>{FORMA_LABEL[p.forma] ?? p.forma}</Text><Text>{fmt(p.valor)}</Text></View>
          ))
        ) : (
          <Text>{FORMA_LABEL[venda.forma_pagamento] ?? venda.forma_pagamento}</Text>
        )}

        {venda.nfce_status === 'autorizada' && (
          <>
            <View style={s.section}><Text style={s.sectionTitle}>NFC-e</Text></View>
            <Text>Número: {venda.nfce_numero}</Text>
            <Text style={s.muted}>Chave: {venda.nfce_chave}</Text>
          </>
        )}

        {venda.observacao && (
          <>
            <View style={s.section}><Text style={s.sectionTitle}>Observação</Text></View>
            <Text>{venda.observacao}</Text>
          </>
        )}

        <Text style={s.footer}>Documento gerado pelo sistema — não substitui nota fiscal quando esta não for emitida.</Text>
      </Page>
    </Document>
  )
}

export async function gerarComprovanteVendaPdfBlob(args: Parameters<typeof ComprovanteVendaDocument>[0]): Promise<Blob> {
  return pdf(<ComprovanteVendaDocument {...args} />).toBlob()
}

export async function gerarComprovanteVendaPdfBuffer(args: Parameters<typeof ComprovanteVendaDocument>[0]): Promise<Buffer> {
  const instance = pdf(<ComprovanteVendaDocument {...args} />)
  const blob = await instance.toBlob()
  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export function abrirPdfEmNovaAba(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
