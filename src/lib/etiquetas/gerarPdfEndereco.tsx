import { Document, Page, View, Text, StyleSheet, Image, pdf } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { PRESETS } from './tipos'
import type { EnderecoParaEtiqueta, LayoutEtiquetaEndereco } from './tiposEndereco'

// Clone de gerarPdf.tsx pra endereço em vez de produto — layout fixo (sem
// designer configurável), reaproveitando só a geometria de página dos
// PRESETS já existentes e o motor @react-pdf/renderer.

const MM_PARA_PT = 2.83464567
function mm(v: number) { return v * MM_PARA_PT }

async function gerarQrDataUrl(valor: string): Promise<string | null> {
  if (!valor) return null
  try { return await QRCode.toDataURL(valor, { margin: 0, width: 200 }) } catch { return null }
}

const styles = StyleSheet.create({
  celula: { flexDirection: 'column', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
})

function linhaHierarquia(e: EnderecoParaEtiqueta): string {
  return [e.corredor && `Corredor ${e.corredor}`, e.estante && `Estante ${e.estante}`, e.nivel && `Nível ${e.nivel}`, e.posicao && `Posição ${e.posicao}`]
    .filter(Boolean).join(' · ')
}

function EtiquetaEnderecoConteudo({ largura, altura, endereco, qr }: { largura: number; altura: number; endereco: EnderecoParaEtiqueta; qr: string | null }) {
  return (
    <View style={[styles.celula, { width: mm(largura), height: mm(altura), padding: 3 }]}>
      <Text style={{ fontSize: Math.max(10, altura * 0.28), fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{endereco.codigoLegivel}</Text>
      {linhaHierarquia(endereco) && (
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica', textAlign: 'center', marginTop: 1 }}>{linhaHierarquia(endereco)}</Text>
      )}
      <Text style={{ fontSize: 6, fontFamily: 'Helvetica', textAlign: 'center', color: '#666' }}>{endereco.depositoNome}</Text>
      {qr && <Image src={qr} style={{ width: mm(Math.min(largura, altura) * 0.45), height: mm(Math.min(largura, altura) * 0.45), marginTop: 2 }} />}
    </View>
  )
}

export async function gerarEtiquetasEnderecoPdfBlob(enderecos: EnderecoParaEtiqueta[], layout: LayoutEtiquetaEndereco): Promise<Blob> {
  const geo = PRESETS[layout]!
  const qrPorEndereco = new Map<string, string>()
  for (const e of enderecos) {
    const d = await gerarQrDataUrl(e.codigoInterno)
    if (d) qrPorEndereco.set(e.id, d)
  }

  const larguraPt = mm(geo.pagina_largura_mm!)
  const alturaPt = mm(geo.pagina_altura_mm!)

  if (geo.tipo_pagina === 'bobina') {
    return pdf(
      <Document>
        {enderecos.map(e => (
          <Page key={e.id} size={[larguraPt, alturaPt]} style={{ padding: 0 }}>
            <EtiquetaEnderecoConteudo largura={geo.largura_mm!} altura={geo.altura_mm!} endereco={e} qr={qrPorEndereco.get(e.id) ?? null} />
          </Page>
        ))}
      </Document>
    ).toBlob()
  }

  const porPagina = Math.max(1, geo.colunas! * geo.linhas!)
  const paginas: EnderecoParaEtiqueta[][] = []
  for (let i = 0; i < enderecos.length; i += porPagina) paginas.push(enderecos.slice(i, i + porPagina))

  return pdf(
    <Document>
      {paginas.map((pagina, pIdx) => (
        <Page key={pIdx} size={[larguraPt, alturaPt]} style={{ padding: 0 }}>
          <View style={{
            position: 'absolute', top: mm(geo.margem_topo_mm!), left: mm(geo.margem_esquerda_mm!),
            flexDirection: 'row', flexWrap: 'wrap', width: mm(geo.colunas! * (geo.largura_mm! + geo.espaco_horizontal_mm!)),
          }}>
            {pagina.map(e => (
              <View key={e.id} style={{ marginRight: mm(geo.espaco_horizontal_mm!), marginBottom: mm(geo.espaco_vertical_mm!) }}>
                <EtiquetaEnderecoConteudo largura={geo.largura_mm!} altura={geo.altura_mm!} endereco={e} qr={qrPorEndereco.get(e.id) ?? null} />
              </View>
            ))}
          </View>
        </Page>
      ))}
    </Document>
  ).toBlob()
}

export function abrirPdfEnderecoEmNovaAba(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
