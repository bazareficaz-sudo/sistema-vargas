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

export type FormatoImpressao = 'a4' | 'bobina_80' | 'bobina_58'

export type ConfigImpressao = {
  formato: FormatoImpressao
  mensagem_rodape: string | null
  mostrar_sku: boolean
}

export const CONFIG_IMPRESSAO_PADRAO: ConfigImpressao = {
  formato: 'a4',
  mensagem_rodape: null,
  mostrar_sku: true,
}

const FORMA_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro', debito: 'Cartão de débito', credito: 'Cartão de crédito',
  pix: 'Pix', carteira: 'Carteira/crédito loja', fiado: 'Fiado', troca: 'Troca', multiplo: 'Múltiplo',
}

function fmt(v: number) { return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtQtd(v: number) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }) }

// Largura útil da bobina em pontos (1mm ≈ 2,8346pt), já descontando a margem
// que a maioria das térmicas não imprime nas laterais.
const LARGURA_BOBINA: Record<'bobina_80' | 'bobina_58', number> = {
  bobina_80: 226,
  bobina_58: 164,
}

// react-pdf exige altura fixa — não existe "papel contínuo". Os números abaixo
// saem da soma dos estilos usados no layout de bobina (fonte 10pt ≈ 12pt de
// linha), não de chute:
//
//   cabeçalho  padding 10 + nome 18 + CNPJ 10 + endereço 20 (2 linhas) +
//              telefone 10 + título 21 + separador 13 + data 12 + cliente 12
//   por item   marginTop 5 + nome 12 (24 quando quebra) + qtd/total 12
//   rodapé     totais 98 + separador 9 + pagamento 24 + rodapé 28 + padding 10
//
// Errar pra menos é pior que errar pra mais: o fim do cupom vai pra uma
// segunda página e a impressora avança a bobina duas vezes. Por isso o item
// usa 34 (assume que um nome longo quebra em duas linhas de vez em quando).
function alturaEstimadaBobina(qtdItens: number, temMensagem: boolean, temObs: boolean, temNfce: boolean) {
  const cabecalho = 135
  const porItem = 34
  const rodape = 170
  const extras = (temMensagem ? 26 : 0) + (temObs ? 34 : 0) + (temNfce ? 32 : 0)
  return Math.max(320, cabecalho + qtdItens * porItem + rodape + extras)
}

function estilos(formato: FormatoImpressao) {
  const bobina = formato !== 'a4'
  // Corpo em 10pt (bobina) / 10pt (A4): o comprovante antigo usava 9pt e
  // ficava difícil de ler no papel térmico, que já borra um pouco.
  const base = bobina ? 10 : 10
  return StyleSheet.create({
    page: {
      paddingVertical: bobina ? 10 : 32,
      paddingHorizontal: bobina ? 8 : 32,
      fontSize: base,
      fontFamily: 'Helvetica',
      color: '#000000', // preto puro: cinza sai lavado na térmica
    },
    centro: { textAlign: 'center' },
    nomeEmpresa: { fontSize: bobina ? 13 : 16, fontFamily: 'Helvetica-Bold', marginBottom: 2, textAlign: bobina ? 'center' : 'left' },
    dadosEmpresa: { fontSize: bobina ? 8 : 9, color: '#333333', textAlign: bobina ? 'center' : 'left' },

    tituloDoc: { fontSize: bobina ? 11 : 12, fontFamily: 'Helvetica-Bold', textAlign: bobina ? 'center' : 'left', marginTop: 8 },
    separador: { borderBottomWidth: 1, borderBottomColor: '#000000', marginVertical: 6 },
    separadorLeve: { borderBottomWidth: 0.5, borderBottomColor: '#999999', marginVertical: 4 },

    linha: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    rotulo: { fontFamily: 'Helvetica-Bold' },

    // Tabela (A4)
    thead: { flexDirection: 'row', backgroundColor: '#eeeeee', paddingVertical: 5, paddingHorizontal: 4, marginTop: 10 },
    trow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#dddddd' },
    colNome: { width: '46%' },
    colQtd: { width: '12%', textAlign: 'right' },
    colUnit: { width: '17%', textAlign: 'right' },
    colTotal: { width: '25%', textAlign: 'right' },
    negrito: { fontFamily: 'Helvetica-Bold' },

    // Itens (bobina) — nome numa linha, cálculo na linha de baixo
    itemBobina: { marginTop: 5 },
    itemNome: { fontFamily: 'Helvetica-Bold' },

    totais: { marginTop: 8, alignItems: bobina ? 'stretch' : 'flex-end' },
    totalLinha: { flexDirection: 'row', justifyContent: 'space-between', width: bobina ? '100%' : 240, marginTop: 2 },

    // Total destacado: caixa com borda grossa e fonte grande, o número que o
    // cliente e o operador precisam achar de relance.
    caixaTotal: {
      marginTop: 8,
      borderWidth: 2,
      borderColor: '#000000',
      paddingVertical: 6,
      paddingHorizontal: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: bobina ? '100%' : 240,
    },
    totalRotulo: { fontSize: bobina ? 13 : 14, fontFamily: 'Helvetica-Bold' },
    totalValor: { fontSize: bobina ? 15 : 17, fontFamily: 'Helvetica-Bold' },

    mensagem: { marginTop: 12, textAlign: 'center', fontSize: bobina ? 10 : 10, fontFamily: 'Helvetica-Bold' },
    rodape: { marginTop: 10, textAlign: 'center', color: '#555555', fontSize: 7.5 },
    chave: { fontSize: 7.5, color: '#333333' },
  })
}

export function ComprovanteVendaDocument({ empresa, cliente, venda, itens, config }: {
  empresa: EmpresaComprovante
  cliente: ClienteComprovante
  venda: VendaComprovante
  itens: ItemComprovante[]
  config?: ConfigImpressao
}) {
  const cfg = config ?? CONFIG_IMPRESSAO_PADRAO
  const bobina = cfg.formato !== 'a4'
  const s = estilos(cfg.formato)

  const endereco = [empresa.logradouro, empresa.numero, empresa.bairro, empresa.cidade, empresa.uf].filter(Boolean).join(', ')
  const itensVenda = itens.filter(i => i.tipo !== 'devolucao')
  const itensDevolvidos = itens.filter(i => i.tipo === 'devolucao')
  const temNfce = venda.nfce_status === 'autorizada'
  const mensagem = cfg.mensagem_rodape?.trim() || null

  const tamanhoPagina: [number, number] | 'A4' = bobina
    ? [
        LARGURA_BOBINA[cfg.formato as 'bobina_80' | 'bobina_58'],
        alturaEstimadaBobina(itensVenda.length + itensDevolvidos.length, !!mensagem, !!venda.observacao, temNfce),
      ]
    : 'A4'

  const nomeItem = (i: ItemComprovante) =>
    `${i.produto_nome}${cfg.mostrar_sku && i.produto_sku ? ` (${i.produto_sku})` : ''}`

  return (
    <Document>
      <Page size={tamanhoPagina} style={s.page}>
        <Text style={s.nomeEmpresa}>{empresa.nome}</Text>
        {empresa.cnpj && <Text style={s.dadosEmpresa}>CNPJ: {empresa.cnpj}</Text>}
        {endereco && <Text style={s.dadosEmpresa}>{endereco}</Text>}
        {empresa.telefone && <Text style={s.dadosEmpresa}>{empresa.telefone}</Text>}

        <Text style={s.tituloDoc}>Comprovante de venda #{venda.numero}</Text>
        <View style={s.separador} />

        {bobina ? (
          <>
            <Text>{new Date(venda.created_at).toLocaleString('pt-BR')}</Text>
            <Text>Cliente: {cliente?.nome ?? 'Consumidor'}</Text>
            {cliente?.cpf_cnpj && <Text>CPF/CNPJ: {cliente.cpf_cnpj}</Text>}
          </>
        ) : (
          <>
            <View style={s.linha}>
              <Text>Data: {new Date(venda.created_at).toLocaleString('pt-BR')}</Text>
              <Text>Status: {venda.status}</Text>
            </View>
            <View style={s.linha}>
              <Text>Cliente: {cliente?.nome ?? 'Consumidor'}</Text>
              {cliente?.cpf_cnpj && <Text>CPF/CNPJ: {cliente.cpf_cnpj}</Text>}
            </View>
          </>
        )}

        {bobina ? (
          <>
            <View style={s.separadorLeve} />
            {itensVenda.map((i, idx) => (
              <View key={idx} style={s.itemBobina}>
                <Text style={s.itemNome}>{nomeItem(i)}</Text>
                <View style={s.linha}>
                  <Text>{fmtQtd(i.quantidade)} x {fmt(i.preco_unitario)}</Text>
                  <Text style={s.negrito}>{fmt(i.total)}</Text>
                </View>
              </View>
            ))}
            {itensDevolvidos.length > 0 && (
              <>
                <View style={s.separadorLeve} />
                <Text style={s.rotulo}>Itens devolvidos</Text>
                {itensDevolvidos.map((i, idx) => (
                  <View key={idx} style={s.itemBobina}>
                    <Text style={s.itemNome}>{nomeItem(i)}</Text>
                    <View style={s.linha}>
                      <Text>{fmtQtd(i.quantidade)} x {fmt(i.preco_unitario)}</Text>
                      <Text style={s.negrito}>-{fmt(i.total)}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <View style={s.thead}>
              <Text style={[s.colNome, s.negrito]}>Produto</Text>
              <Text style={[s.colQtd, s.negrito]}>Qtd</Text>
              <Text style={[s.colUnit, s.negrito]}>Unitário</Text>
              <Text style={[s.colTotal, s.negrito]}>Total</Text>
            </View>
            {itensVenda.map((i, idx) => (
              <View key={idx} style={s.trow}>
                <Text style={s.colNome}>{nomeItem(i)}</Text>
                <Text style={s.colQtd}>{fmtQtd(i.quantidade)}</Text>
                <Text style={s.colUnit}>{fmt(i.preco_unitario)}</Text>
                <Text style={s.colTotal}>{fmt(i.total)}</Text>
              </View>
            ))}
            {itensDevolvidos.length > 0 && (
              <>
                <Text style={[s.rotulo, { marginTop: 10 }]}>Itens devolvidos</Text>
                {itensDevolvidos.map((i, idx) => (
                  <View key={idx} style={s.trow}>
                    <Text style={s.colNome}>{nomeItem(i)}</Text>
                    <Text style={s.colQtd}>{fmtQtd(i.quantidade)}</Text>
                    <Text style={s.colUnit}>{fmt(i.preco_unitario)}</Text>
                    <Text style={s.colTotal}>-{fmt(i.total)}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        <View style={s.totais}>
          <View style={s.totalLinha}><Text>Subtotal</Text><Text>{fmt(venda.subtotal)}</Text></View>
          {venda.desconto > 0 && (
            <View style={s.totalLinha}><Text>Desconto</Text><Text>-{fmt(venda.desconto)}</Text></View>
          )}

          <View style={s.caixaTotal}>
            <Text style={s.totalRotulo}>TOTAL</Text>
            <Text style={s.totalValor}>{fmt(venda.total)}</Text>
          </View>

          {venda.valor_pago != null && venda.valor_pago > 0 && (
            <View style={s.totalLinha}><Text>Pago</Text><Text>{fmt(venda.valor_pago)}</Text></View>
          )}
          {venda.troco != null && venda.troco > 0 && (
            <View style={s.totalLinha}><Text style={s.rotulo}>Troco</Text><Text style={s.rotulo}>{fmt(venda.troco)}</Text></View>
          )}
        </View>

        <View style={s.separadorLeve} />
        <Text style={s.rotulo}>Pagamento</Text>
        {(venda.pagamentos ?? []).length > 0 ? (
          venda.pagamentos!.map((p, idx) => (
            <View key={idx} style={s.linha}><Text>{FORMA_LABEL[p.forma] ?? p.forma}</Text><Text>{fmt(p.valor)}</Text></View>
          ))
        ) : (
          <Text>{FORMA_LABEL[venda.forma_pagamento] ?? venda.forma_pagamento}</Text>
        )}

        {temNfce && (
          <>
            <View style={s.separadorLeve} />
            <Text style={s.rotulo}>NFC-e nº {venda.nfce_numero}</Text>
            <Text style={s.chave}>{venda.nfce_chave}</Text>
          </>
        )}

        {venda.observacao && (
          <>
            <View style={s.separadorLeve} />
            <Text style={s.rotulo}>Observação</Text>
            <Text>{venda.observacao}</Text>
          </>
        )}

        {mensagem && <Text style={s.mensagem}>{mensagem}</Text>}

        <Text style={s.rodape}>
          {temNfce
            ? 'Comprovante de venda — a nota fiscal é a NFC-e informada acima.'
            : 'Documento gerado pelo sistema — não substitui nota fiscal quando esta não for emitida.'}
        </Text>
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
