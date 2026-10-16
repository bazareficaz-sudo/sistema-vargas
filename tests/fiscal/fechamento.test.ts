import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import {
  lerXmlNota, mesAnterior, montarCsv, montarFechamento, periodoDoMes, xmlDoCampo,
} from '../../src/lib/fiscal/fechamento'
import { crc32, gerarZip } from '../../src/lib/zip/zip'

const OURO = '43103402000124'
const EFICAZ = '05362352000100'

const xmlNota = (o: { cnpj: string; mod?: string; nNF: string; vNF: string; dhEmi: string; tpAmb?: string; chave?: string; xNome?: string }) => {
  const chave = o.chave ?? `33261${o.cnpj}65001${o.nNF.padStart(9, '0')}1000000001`.slice(0, 44).padEnd(44, '0')
  return `<nfeProc versao="4.00"><NFe><infNFe versao="4.00" Id="NFe${chave}"><ide><cUF>33</cUF><mod>${o.mod ?? '65'}</mod>` +
    `<serie>1</serie><nNF>${o.nNF}</nNF><dhEmi>${o.dhEmi}</dhEmi><tpAmb>${o.tpAmb ?? '1'}</tpAmb></ide>` +
    `<emit><CNPJ>${o.cnpj}</CNPJ><xNome>${o.xNome ?? 'LOJA'}</xNome></emit><dest><CNPJ>11111111000111</CNPJ></dest>` +
    `<total><ICMSTot><vProd>1</vProd><vNF>${o.vNF}</vNF></ICMSTot></total></infNFe></NFe>` +
    `<protNFe><infProt><chNFe>${chave}</chNFe></infProt></protNFe></nfeProc>`
}
const dataUri = (xml: string) => `data:application/xml;base64,${Buffer.from(xml).toString('base64')}`

describe('mês de competência', () => {
  test('intervalo no horário de Brasília, virada de ano', () => {
    assert.deepEqual(periodoDoMes('2026-12'), {
      mes: '2026-12', inicio: '2026-12-01T00:00:00-03:00', fim: '2027-01-01T00:00:00-03:00', rotulo: 'dezembro de 2026',
    })
    assert.equal(periodoDoMes('2026-13'), null)
    assert.equal(periodoDoMes('setembro'), null)
  })

  test('mês anterior: em 1º de outubro às 01h (UTC) ainda é setembro em Brasília', () => {
    assert.equal(mesAnterior(new Date('2026-10-16T12:00:00Z')), '2026-09')
    assert.equal(mesAnterior(new Date('2026-10-01T01:00:00Z')), '2026-08')
    assert.equal(mesAnterior(new Date('2026-01-10T12:00:00Z')), '2025-12')
  })
})

describe('leitura do XML', () => {
  test('data URI em base64 e texto puro', () => {
    const xml = xmlNota({ cnpj: OURO, nNF: '10', vNF: '5.00', dhEmi: '2026-09-02T10:00:00-03:00' })
    assert.equal(xmlDoCampo(dataUri(xml)), xml)
    assert.equal(xmlDoCampo(xml), xml)
    assert.equal(xmlDoCampo('https://emissor/nota.xml'), null)
    assert.equal(xmlDoCampo(null), null)
  })

  test('campos do resumo, com o CNPJ do emitente e não o do destinatário', () => {
    const d = lerXmlNota(xmlNota({ cnpj: OURO, nNF: '123', vNF: '45.90', dhEmi: '2026-09-02T10:00:00-03:00' }))
    assert.equal(d.cnpjEmitente, OURO)
    assert.equal(d.numero, '123')
    assert.equal(d.modelo, '65')
    assert.equal(d.valor, 45.9)
    assert.equal(d.ambiente, '1')
    assert.equal(d.chave?.length, 44)
  })
})

describe('planilha resumo', () => {
  test('";" e vírgula decimal, BOM, chave protegida do Excel', () => {
    const csv = montarCsv([{ grupo: 'Venda NFC-e', numero: '1', serie: '1', chave: '3'.repeat(44), emissao: '2026-09-02T10:00:00-03:00', valor: 1234.5, contraparte: 'Cliente; "VIP"', origem: 'Venda #1' }])
    assert.ok(csv.startsWith('﻿Tipo;'))
    assert.match(csv, /;1234,50;/)
    assert.match(csv, /02\/09\/2026/)
    assert.match(csv, /"=""3{44}"""/)
    assert.match(csv, /"Cliente; ""VIP"""/)
  })
})

describe('zip', () => {
  test('cabeçalhos válidos e conteúdo recuperável', () => {
    const conteudo = '<a>' + 'x'.repeat(3000) + '</a>'
    const zip = gerarZip([{ nome: 'Vendas/NFC-e/á.xml', conteudo }, { nome: 'vazio.txt', conteudo: '' }])
    assert.equal(zip.readUInt32LE(0), 0x04034b50)
    const fim = zip.length - 22
    assert.equal(zip.readUInt32LE(fim), 0x06054b50)
    assert.equal(zip.readUInt16LE(fim + 10), 2)
    // Primeiro arquivo: deflate, CRC confere depois de descomprimir.
    const tamNome = zip.readUInt16LE(26), tamComp = zip.readUInt32LE(18)
    assert.equal(zip.toString('utf8', 30, 30 + tamNome), 'Vendas/NFC-e/á.xml')
    const dados = inflateRawSync(zip.subarray(30 + tamNome, 30 + tamNome + tamComp)).toString('utf8')
    assert.equal(dados, conteudo)
    assert.equal(zip.readUInt32LE(14), crc32(Buffer.from(conteudo)))
  })

  test('crc32 conhecido', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  })
})

// Cliente Supabase de mentira: guarda os filtros e devolve as linhas que passam.
function fakeSb(tabelas: Record<string, Record<string, unknown>[]>) {
  return {
    from(nome: string) {
      const filtros: ((r: Record<string, unknown>) => boolean)[] = []
      let head = false
      const q = {
        select(_c: string, o?: { count?: string; head?: boolean }) { head = !!o?.head; return q },
        eq(c: string, v: unknown) { filtros.push(r => r[c] === v); return q },
        in(c: string, v: unknown[]) { filtros.push(r => v.includes(r[c])); return q },
        gte(c: string, v: string) { filtros.push(r => String(r[c]) >= v || new Date(String(r[c])) >= new Date(v)); return q },
        lt(c: string, v: string) { filtros.push(r => new Date(String(r[c])) < new Date(v)); return q },
        order() { return q },
        range(de: number, ate: number) { return Promise.resolve({ data: linhas().slice(de, ate + 1), error: null }) },
        maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }) },
        then(res: (v: unknown) => unknown) {
          const l = linhas()
          return Promise.resolve(head ? { count: l.length, data: null, error: null } : { data: l, error: null }).then(res)
        },
      }
      const linhas = () => (tabelas[nome] ?? []).filter(r => filtros.every(f => f(r)))
      return q
    },
  }
}

describe('fechamento', () => {
  const tabelas = {
    empresas: [{ id: 'ouro', nome_fantasia: 'OURO E PRATA', cnpj: OURO }, { id: 'eficaz', nome_fantasia: 'EFICAZ', cnpj: EFICAZ }],
    // A Eficaz emite as NFC-e no CNPJ da Ouro e Prata.
    empresa_config_fiscal: [{ empresa_id: 'eficaz', empresa_fiscal_id: 'ouro' }],
    vendas: [
      { id: 'v1', empresa_id: 'eficaz', numero: 1, total: 10, nfce_status: 'autorizada', created_at: '2026-09-05T15:00:00Z', nfce_xml_url: dataUri(xmlNota({ cnpj: OURO, nNF: '1', vNF: '10.00', dhEmi: '2026-09-05T12:00:00-03:00' })) },
      { id: 'v2', empresa_id: 'eficaz', numero: 2, total: 20, nfce_status: 'autorizada', created_at: '2026-09-06T15:00:00Z', nfce_xml_url: dataUri(xmlNota({ cnpj: OURO, nNF: '2', vNF: '20.00', dhEmi: '2026-09-06T12:00:00-03:00', tpAmb: '2' })) },
      // Fora do mês (1º de outubro 00:30 em Brasília).
      { id: 'v3', empresa_id: 'eficaz', numero: 3, total: 30, nfce_status: 'autorizada', created_at: '2026-10-01T03:30:00Z', nfce_xml_url: dataUri(xmlNota({ cnpj: OURO, nNF: '3', vNF: '30.00', dhEmi: '2026-10-01T00:30:00-03:00' })) },
      { id: 'v4', empresa_id: 'ouro', numero: 4, total: 5, nfce_status: 'rejeitada', created_at: '2026-09-07T15:00:00Z', nfce_xml_url: null },
    ],
    marketplace_pedidos: [],
    nfe_entradas: [
      { id: 'c1', empresa_id: 'ouro', numero: '900', serie: '1', data_emissao: '2026-09-10', valor_total: 300, nome_fornecedor: 'FORN', status: 'finalizada', xml_content: xmlNota({ cnpj: '22222222000122', mod: '55', nNF: '900', vNF: '300.00', dhEmi: '2026-09-10T08:00:00-03:00', xNome: 'FORNECEDOR SA' }) },
      { id: 'c2', empresa_id: 'ouro', numero: '901', serie: '1', data_emissao: '2026-09-11', valor_total: 50, nome_fornecedor: 'OUTRO', status: 'manifesto_pendente', xml_content: null },
    ],
    entradas: [],
  }

  test('NFC-e pelo CNPJ do XML: as vendas da Eficaz entram no fechamento da Ouro e Prata', async () => {
    const f = await montarFechamento(fakeSb(tabelas), 'ouro', '2026-09')
    assert.equal(f.vendasNfce.quantidade, 1)
    assert.equal(f.vendasNfce.valor, 10)
    assert.equal(f.compras.quantidade, 1)
    assert.deepEqual(f.arquivos.map(a => a.nome.split('/').slice(0, 2).join('/')).sort(), ['Compras/NF-e', 'Vendas/NFC-e'])
    const tipos = f.pendencias.map(p => p.tipo)
    assert.ok(tipos.includes('NFC-e de homologação (teste)'))
    assert.ok(tipos.includes('Vendas com NFC-e rejeitada ou com erro'))
    assert.ok(tipos.includes('Notas de compra sem XML'))
  })

  test('…e nenhuma delas no fechamento da Eficaz', async () => {
    const f = await montarFechamento(fakeSb(tabelas), 'eficaz', '2026-09')
    assert.equal(f.vendasNfce.quantidade, 0)
  })

  test('só o resumo não guarda XML; só compras não lê vendas', async () => {
    const r = await montarFechamento(fakeSb(tabelas), 'ouro', '2026-09', { comXml: false })
    assert.equal(r.arquivos.length, 0)
    assert.equal(r.vendasNfce.quantidade, 1)
    const c = await montarFechamento(fakeSb(tabelas), 'ouro', '2026-09', { partes: { vendas: false, compras: true } })
    assert.equal(c.vendasNfce.quantidade, 0)
    assert.equal(c.compras.quantidade, 1)
  })

  test('empresa fora das permitidas não tem as vendas lidas', async () => {
    const f = await montarFechamento(fakeSb(tabelas), 'ouro', '2026-09', { empresasPermitidas: ['ouro'] })
    assert.equal(f.vendasNfce.quantidade, 0)
  })
})
