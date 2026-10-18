import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { listaDeEmails } from '../../src/lib/email/enviar'
import { deveEnviarAutomatico, enviarFechamento, hojeEmBrasilia } from '../../src/lib/fiscal/enviarFechamento'

describe('e-mails', () => {
  test('aceita lista com ; , e espaço, descarta o inválido e repetido', () => {
    assert.deepEqual(listaDeEmails('Contador@Escritorio.com.br; outro@x.com, invalido  outro@x.com'), ['contador@escritorio.com.br', 'outro@x.com'])
    assert.deepEqual(listaDeEmails(null), [])
  })
})

describe('envio automático', () => {
  const base = { diaHoje: 2, diaEnvio: 2, envios: [] as { status: string; origem: string; created_at: string }[], hojeISO: '2026-11-02' }
  test('a partir do dia configurado, uma vez', () => {
    assert.equal(deveEnviarAutomatico({ ...base, diaHoje: 1 }), false)
    assert.equal(deveEnviarAutomatico(base), true)
    assert.equal(deveEnviarAutomatico({ ...base, diaHoje: 15 }), true)
  })
  test('mês já enviado (pelo botão ou automático) não vai de novo', () => {
    assert.equal(deveEnviarAutomatico({ ...base, envios: [{ status: 'enviado', origem: 'manual', created_at: '2026-11-01T12:00:00Z' }] }), false)
  })
  test('falhou hoje: tenta só amanhã', () => {
    const falha = { status: 'erro', origem: 'automatico', created_at: '2026-11-02T11:05:00Z' }
    assert.equal(deveEnviarAutomatico({ ...base, envios: [falha] }), false)
    assert.equal(deveEnviarAutomatico({ ...base, diaHoje: 3, hojeISO: '2026-11-03', envios: [falha] }), true)
  })
  test('dia e mês em Brasília', () => {
    assert.deepEqual(hojeEmBrasilia(new Date('2026-11-01T02:00:00Z')), { dia: 31, mes: '2026-10' })
  })
})

// Cliente de mentira: filtros eq/in/gte/lt/neq, insert guardado.
function fakeSb(tabelas: Record<string, Record<string, unknown>[]>) {
  return {
    from(nome: string) {
      const filtros: ((r: Record<string, unknown>) => boolean)[] = []
      let head = false
      const linhas = () => (tabelas[nome] ?? []).filter(r => filtros.every(f => f(r)))
      const q = {
        select(_c: string, o?: { head?: boolean }) { head = !!o?.head; return q },
        eq(c: string, v: unknown) { filtros.push(r => r[c] === v); return q },
        in(c: string, v: unknown[]) { filtros.push(r => v.includes(r[c])); return q },
        gte(c: string, v: string) { filtros.push(r => new Date(String(r[c])) >= new Date(v)); return q },
        lt(c: string, v: string) { filtros.push(r => new Date(String(r[c])) < new Date(v)); return q },
        order() { return q },
        range(de: number, ate: number) { return Promise.resolve({ data: linhas().slice(de, ate + 1), error: null }) },
        maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }) },
        insert(row: Record<string, unknown>) { (tabelas[nome] ??= []).push(row); return Promise.resolve({ error: null }) },
        then(res: (v: unknown) => unknown) {
          return Promise.resolve(head ? { count: linhas().length, error: null } : { data: linhas(), error: null }).then(res)
        },
      }
      return q
    },
  }
}

const xml = `<nfeProc><NFe><infNFe Id="NFe${'3'.repeat(44)}"><ide><mod>65</mod><serie>1</serie><nNF>7</nNF><dhEmi>2026-09-05T10:00:00-03:00</dhEmi><tpAmb>1</tpAmb></ide><emit><CNPJ>43103402000124</CNPJ><xNome>LOJA</xNome></emit><total><ICMSTot><vNF>12.50</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`

describe('enviar o fechamento', () => {
  const fetchOriginal = globalThis.fetch
  afterEach(() => { globalThis.fetch = fetchOriginal; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_REMETENTE })

  const tabelas = () => ({
    empresas: [{ id: 'ouro', nome_fantasia: 'OURO E PRATA', cnpj: '43103402000124', contador: 'Maria Silva', email_contador: 'maria@contab.com.br' }],
    fechamento_contador_config: [{ empresa_id: 'ouro', copia_para: 'dono@loja.com' }],
    empresa_config_fiscal: [],
    vendas: [{ id: 'v1', empresa_id: 'ouro', numero: 1, total: 12.5, nfce_status: 'autorizada', created_at: '2026-09-05T13:00:00Z', nfce_xml_url: `data:application/xml;base64,${Buffer.from(xml).toString('base64')}` }],
    marketplace_pedidos: [], nfe_entradas: [], entradas: [],
    fechamento_contador_envios: [] as Record<string, unknown>[],
  })

  test('manda o .zip ao contador com cópia e registra o envio', async () => {
    process.env.RESEND_API_KEY = 're_teste'; process.env.EMAIL_REMETENTE = 'Sistema <f@sistemavargas.com.br>'
    let corpo: Record<string, unknown> = {}
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      corpo = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })
    }) as typeof fetch
    const t = tabelas()
    const r = await enviarFechamento(fakeSb(t), 'ouro', '2026-09', { origem: 'manual', copiaExtra: 'Dono@Loja.com' })
    assert.equal(r.ok, true)
    assert.deepEqual(corpo.to, ['maria@contab.com.br'])
    assert.deepEqual(corpo.cc, ['dono@loja.com'])
    assert.match(String(corpo.subject), /setembro de 2026 — OURO E PRATA/)
    assert.match(String(corpo.html), /Olá, Maria!/)
    const anexos = corpo.attachments as { filename: string; content: string }[]
    assert.equal(anexos[0].filename, 'Fechamento_2026-09_43103402000124.zip')
    assert.equal(Buffer.from(anexos[0].content, 'base64').readUInt32LE(0), 0x04034b50)
    assert.equal(t.fechamento_contador_envios[0].status, 'enviado')
    assert.equal(t.fechamento_contador_envios[0].notas, 1)
  })

  test('sem e-mail do contador: não envia e registra o motivo', async () => {
    process.env.RESEND_API_KEY = 're_teste'; process.env.EMAIL_REMETENTE = 'x <f@x.com>'
    const t = tabelas(); t.empresas[0].email_contador = ''
    const r = await enviarFechamento(fakeSb(t), 'ouro', '2026-09', { origem: 'automatico' })
    assert.equal(r.ok, false)
    assert.equal(t.fechamento_contador_envios[0].status, 'erro')
  })

  test('erro do Resend vira erro registrado', async () => {
    process.env.RESEND_API_KEY = 're_teste'; process.env.EMAIL_REMETENTE = 'x <f@x.com>'
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 })) as typeof fetch
    const t = tabelas()
    const r = await enviarFechamento(fakeSb(t), 'ouro', '2026-09', { origem: 'manual' })
    assert.deepEqual(r, { ok: false, erro: 'domain not verified' })
    assert.equal(t.fechamento_contador_envios[0].erro, 'domain not verified')
  })
})
