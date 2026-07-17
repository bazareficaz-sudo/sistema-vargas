import { Document, Page, View, Text, Image, StyleSheet, pdf } from '@react-pdf/renderer'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import type { CampoEtiqueta, ModeloEtiqueta, ProdutoParaEtiqueta, TipoCampo } from './tipos'

const MM_PARA_PT = 2.83464567

function mm(v: number) { return v * MM_PARA_PT }

type Empresa = { nome: string; logo_url: string | null }

type Instancia = { produto: ProdutoParaEtiqueta }

function gerarBarcodeDataUrl(valor: string): string | null {
  if (!valor) return null
  const canvas = document.createElement('canvas')
  try {
    JsBarcode(canvas, valor, {
      format: /^\d{13}$/.test(valor) ? 'EAN13' : /^\d{8}$/.test(valor) ? 'EAN8' : 'CODE128',
      displayValue: false, margin: 0, height: 50,
    })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

async function gerarQrDataUrl(valor: string): Promise<string | null> {
  if (!valor) return null
  try {
    return await QRCode.toDataURL(valor, { margin: 0, width: 200 })
  } catch {
    return null
  }
}

function fmtPreco(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function valorCampo(campo: TipoCampo, produto: ProdutoParaEtiqueta): string {
  switch (campo) {
    case 'nome': return produto.nome
    case 'sku': return produto.sku ?? ''
    case 'ean': return produto.ean ?? ''
    case 'preco_venda': return fmtPreco(produto.preco_venda)
    case 'preco_promocional': return produto.preco_promocional ? fmtPreco(produto.preco_promocional) : ''
    case 'marca': return produto.marca ?? ''
    case 'unidade': return produto.unidade ?? ''
    case 'categoria': return produto.categoria ?? ''
    case 'localizacao': return produto.localizacao ?? ''
    case 'data_impressao': return new Date().toLocaleDateString('pt-BR')
    default: return ''
  }
}

const styles = StyleSheet.create({
  celula: { flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' },
  linha: { marginBottom: 1 },
  imagemBarras: { objectFit: 'contain' },
})

function EtiquetaConteudo({ modelo, produto, empresa, barcodes, qrcodes }: {
  modelo: ModeloEtiqueta; produto: ProdutoParaEtiqueta; empresa: Empresa
  barcodes: Map<string, string>; qrcodes: Map<string, string>
}) {
  return (
    <View style={[styles.celula, { width: mm(modelo.largura_mm), height: mm(modelo.altura_mm), padding: 2 }]}>
      {modelo.campos.map((c, i) => {
        if (c.campo === 'texto_livre') {
          return <Text key={i} style={[styles.linha, { fontSize: c.fontSize, fontFamily: c.bold ? 'Helvetica-Bold' : 'Helvetica', textAlign: c.align }]}>{c.textoLivre ?? ''}</Text>
        }
        if (c.campo === 'logo_empresa') {
          if (!empresa.logo_url) return null
          return <Image key={i} src={empresa.logo_url} style={{ height: mm(c.fontSize / 2), alignSelf: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start' }} />
        }
        if (c.campo === 'codigo_barras') {
          const valor = produto.ean || produto.sku || ''
          const dataUrl = barcodes.get(valor)
          if (!dataUrl) return null
          return <Image key={i} src={dataUrl} style={[styles.imagemBarras, { height: mm(modelo.altura_mm * 0.28), width: '100%' }]} />
        }
        if (c.campo === 'qrcode') {
          const valor = produto.ean || produto.sku || produto.nome
          const dataUrl = qrcodes.get(valor)
          if (!dataUrl) return null
          const tam = mm(Math.min(modelo.largura_mm, modelo.altura_mm) * 0.5)
          return <Image key={i} src={dataUrl} style={{ width: tam, height: tam, alignSelf: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start' }} />
        }
        const texto = valorCampo(c.campo, produto)
        if (!texto) return null
        return <Text key={i} style={[styles.linha, { fontSize: c.fontSize, fontFamily: c.bold ? 'Helvetica-Bold' : 'Helvetica', textAlign: c.align }]}>{texto}</Text>
      })}
    </View>
  )
}

function EtiquetasDocument({ modelo, instancias, empresa, barcodes, qrcodes }: {
  modelo: ModeloEtiqueta; instancias: Instancia[]; empresa: Empresa
  barcodes: Map<string, string>; qrcodes: Map<string, string>
}) {
  const larguraPt = mm(modelo.pagina_largura_mm)
  const alturaPt = mm(modelo.pagina_altura_mm)

  if (modelo.tipo_pagina === 'bobina') {
    return (
      <Document>
        {instancias.map((inst, i) => (
          <Page key={i} size={[larguraPt, alturaPt]} style={{ padding: 0 }}>
            <EtiquetaConteudo modelo={modelo} produto={inst.produto} empresa={empresa} barcodes={barcodes} qrcodes={qrcodes} />
          </Page>
        ))}
      </Document>
    )
  }

  const porPagina = Math.max(1, modelo.colunas * modelo.linhas)
  const paginas: Instancia[][] = []
  for (let i = 0; i < instancias.length; i += porPagina) paginas.push(instancias.slice(i, i + porPagina))

  return (
    <Document>
      {paginas.map((pagina, pIdx) => (
        <Page key={pIdx} size={[larguraPt, alturaPt]} style={{ padding: 0 }}>
          <View style={{
            position: 'absolute', top: mm(modelo.margem_topo_mm), left: mm(modelo.margem_esquerda_mm),
            flexDirection: 'row', flexWrap: 'wrap', width: mm(modelo.colunas * (modelo.largura_mm + modelo.espaco_horizontal_mm)),
          }}>
            {pagina.map((inst, i) => (
              <View key={i} style={{ marginRight: mm(modelo.espaco_horizontal_mm), marginBottom: mm(modelo.espaco_vertical_mm) }}>
                <EtiquetaConteudo modelo={modelo} produto={inst.produto} empresa={empresa} barcodes={barcodes} qrcodes={qrcodes} />
              </View>
            ))}
          </View>
        </Page>
      ))}
    </Document>
  )
}

export async function gerarEtiquetasPdfBlob(
  modelo: ModeloEtiqueta,
  itens: { produto: ProdutoParaEtiqueta; quantidade: number }[],
  empresa: Empresa,
): Promise<Blob> {
  const instancias: Instancia[] = []
  for (const item of itens) {
    for (let i = 0; i < Math.max(0, item.quantidade); i++) instancias.push({ produto: item.produto })
  }

  const usaBarcode = modelo.campos.some(c => c.campo === 'codigo_barras')
  const usaQr = modelo.campos.some(c => c.campo === 'qrcode')

  const barcodes = new Map<string, string>()
  const qrcodes = new Map<string, string>()

  if (usaBarcode || usaQr) {
    const valoresUnicos = Array.from(new Set<string>(
      itens.map(i => i.produto.ean || i.produto.sku || i.produto.nome).filter((v): v is string => Boolean(v))
    ))
    for (const valor of valoresUnicos) {
      if (usaBarcode) {
        const d = gerarBarcodeDataUrl(valor)
        if (d) barcodes.set(valor, d)
      }
      if (usaQr) {
        const d = await gerarQrDataUrl(valor)
        if (d) qrcodes.set(valor, d)
      }
    }
  }

  const doc = <EtiquetasDocument modelo={modelo} instancias={instancias} empresa={empresa} barcodes={barcodes} qrcodes={qrcodes} />
  return pdf(doc).toBlob()
}

export function abrirPdfEmNovaAba(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
