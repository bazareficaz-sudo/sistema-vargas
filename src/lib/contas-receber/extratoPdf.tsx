import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

// Relatório da conta do cliente, para mandar por WhatsApp na cobrança.
//
// É o papel que o cliente confere no balcão: cada compra com a data, quem
// vendeu e quanto foi, e no fim quanto ele deve — separando o que ainda vai
// vencer do que já venceu. Vencido em destaque, porque é sobre isso que a
// conversa vai ser.

export type EmpresaExtrato = {
  nome: string; cnpj: string | null; telefone: string | null
  logradouro?: string | null; numero?: string | null; bairro?: string | null
  cidade?: string | null; uf?: string | null
}

export type LinhaExtrato = {
  /** Dia da compra — da venda de origem quando existe, senão a emissão. */
  dataCompra: string
  vendedor: string | null
  documento: string | null
  vencimento: string
  valorOriginal: number
  valorAberto: number
  vencida: boolean
}

const s = StyleSheet.create({
  pagina: { padding: 32, fontSize: 9, fontFamily: 'Helvetica' },
  empresaNome: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  empresaLinha: { fontSize: 8, color: '#666', marginTop: 2 },
  titulo: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 16 },
  sub: { fontSize: 9, color: '#666', marginTop: 2 },
  divisor: { borderBottomWidth: 1, borderBottomColor: '#ddd', marginVertical: 10 },

  cabecalho: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 5, paddingHorizontal: 4 },
  linha: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  linhaVencida: { backgroundColor: '#fef2f2' },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#444' },

  cData: { width: '14%' },
  cVend: { width: '24%' },
  cDoc: { width: '20%' },
  cVenc: { width: '14%' },
  cValor: { width: '14%', textAlign: 'right' },
  cAberto: { width: '14%', textAlign: 'right' },

  totais: { marginTop: 14, alignSelf: 'flex-end', width: '55%' },
  totalLinha: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalForte: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#333', marginTop: 4 },
  negrito: { fontFamily: 'Helvetica-Bold' },
  vermelho: { color: '#b91c1c' },
  rodape: { marginTop: 24, fontSize: 8, color: '#888', textAlign: 'center' },
})

const fmt = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBr = (v: string) => { const [a, m, d] = String(v).slice(0, 10).split('-'); return `${d}/${m}/${a}` }

export function ExtratoClienteDocument({ empresa, clienteNome, clienteDoc, linhas, emitidoEm }: {
  empresa: EmpresaExtrato
  clienteNome: string
  clienteDoc: string | null
  linhas: LinhaExtrato[]
  emitidoEm: string
}) {
  const totalOriginal = linhas.reduce((t, l) => t + l.valorOriginal, 0)
  const aVencer = linhas.filter(l => !l.vencida).reduce((t, l) => t + l.valorAberto, 0)
  const vencido = linhas.filter(l => l.vencida).reduce((t, l) => t + l.valorAberto, 0)
  const emAberto = aVencer + vencido

  const endereco = [empresa.logradouro, empresa.numero, empresa.bairro, empresa.cidade, empresa.uf]
    .filter(Boolean).join(', ')

  return (
    <Document>
      <Page size="A4" style={s.pagina}>
        <Text style={s.empresaNome}>{empresa.nome}</Text>
        {empresa.cnpj && <Text style={s.empresaLinha}>CNPJ {empresa.cnpj}</Text>}
        {endereco && <Text style={s.empresaLinha}>{endereco}</Text>}
        {empresa.telefone && <Text style={s.empresaLinha}>Telefone {empresa.telefone}</Text>}

        <Text style={s.titulo}>Situação da sua conta</Text>
        <Text style={s.sub}>
          {clienteNome}{clienteDoc ? ` · ${clienteDoc}` : ''} · emitido em {emitidoEm}
        </Text>

        <View style={s.divisor} />

        <View style={s.cabecalho}>
          <Text style={[s.th, s.cData]}>Compra</Text>
          <Text style={[s.th, s.cVend]}>Vendedor</Text>
          <Text style={[s.th, s.cDoc]}>Documento</Text>
          <Text style={[s.th, s.cVenc]}>Vencimento</Text>
          <Text style={[s.th, s.cValor]}>Valor</Text>
          <Text style={[s.th, s.cAberto]}>Em aberto</Text>
        </View>

        {linhas.map((l, i) => (
          <View key={i} style={l.vencida ? [s.linha, s.linhaVencida] : s.linha} wrap={false}>
            <Text style={s.cData}>{dataBr(l.dataCompra)}</Text>
            <Text style={s.cVend}>{l.vendedor ?? '—'}</Text>
            <Text style={s.cDoc}>{l.documento ?? '—'}</Text>
            <Text style={l.vencida ? [s.cVenc, s.vermelho] : s.cVenc}>{dataBr(l.vencimento)}</Text>
            <Text style={s.cValor}>{fmt(l.valorOriginal)}</Text>
            <Text style={l.vencida ? [s.cAberto, s.vermelho] : s.cAberto}>{fmt(l.valorAberto)}</Text>
          </View>
        ))}

        {linhas.length === 0 && (
          <Text style={{ marginTop: 12, color: '#666' }}>Não há compras em aberto nesta conta.</Text>
        )}

        <View style={s.totais}>
          <View style={s.totalLinha}>
            <Text>Total comprado ({linhas.length} compra{linhas.length === 1 ? '' : 's'})</Text>
            <Text>{fmt(totalOriginal)}</Text>
          </View>
          <View style={s.totalLinha}>
            <Text>A vencer</Text>
            <Text>{fmt(aVencer)}</Text>
          </View>
          <View style={s.totalLinha}>
            <Text style={vencido > 0 ? s.vermelho : undefined}>Vencido</Text>
            <Text style={vencido > 0 ? [s.vermelho, s.negrito] : undefined}>{fmt(vencido)}</Text>
          </View>
          <View style={s.totalForte}>
            <Text style={s.negrito}>Total em aberto</Text>
            <Text style={s.negrito}>{fmt(emAberto)}</Text>
          </View>
        </View>

        <Text style={s.rodape}>
          Documento gerado pelo sistema em {emitidoEm}. Em caso de divergência, procure a loja.
        </Text>
      </Page>
    </Document>
  )
}

export async function gerarExtratoClientePdfBuffer(
  args: Parameters<typeof ExtratoClienteDocument>[0],
): Promise<Buffer> {
  return await renderToBuffer(<ExtratoClienteDocument {...args} />)
}
