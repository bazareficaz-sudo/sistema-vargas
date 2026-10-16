// Gera um arquivo .zip em memória — sem dependência externa.
//
// Usa o deflate do próprio Node (zlib) e escreve o formato ZIP à mão:
// cabeçalho local + dados de cada arquivo, diretório central e o registro
// de fim. É o mínimo do formato (sem ZIP64, sem criptografia), que é o que
// qualquer descompactador — Windows, macOS, WinRAR, 7-Zip — abre.
//
// Limite do formato sem ZIP64: 65.535 arquivos e 4 GB. O fechamento do mês
// fica muito abaixo disso (≈ 1.000 XMLs, poucos MB); passar do limite lança
// erro em vez de gerar um arquivo corrompido.

import { deflateRawSync } from 'node:zlib'

export type ArquivoZip = { nome: string; conteudo: string | Uint8Array; data?: Date }

const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Data e hora no formato MS-DOS que o ZIP usa (resolução de 2 s, hora local). */
function dataDos(d: Date): { hora: number; data: number } {
  const ano = Math.max(1980, d.getFullYear())
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export function gerarZip(arquivos: ArquivoZip[]): Buffer {
  if (arquivos.length > 0xffff) throw new Error(`Arquivos demais para um .zip simples (${arquivos.length})`)

  const partes: Buffer[] = []
  const central: Buffer[] = []
  let deslocamento = 0

  for (const a of arquivos) {
    const nome = Buffer.from(a.nome.replace(/\\/g, '/'), 'utf8')
    const bruto = typeof a.conteudo === 'string' ? Buffer.from(a.conteudo, 'utf8') : Buffer.from(a.conteudo)
    const comprimido = deflateRawSync(bruto, { level: 9 })
    // Arquivo que não encolhe (já comprimido) vai guardado como está.
    const guardar = comprimido.length >= bruto.length
    const dados = guardar ? bruto : comprimido
    const metodo = guardar ? 0 : 8
    const crc = crc32(bruto)
    const { hora, data } = dataDos(a.data ?? new Date())
    // Bit 11: nome em UTF-8 (acentos aparecem certos no Windows).
    const flags = 0x0800

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(data, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(bruto.length, 22)
    local.writeUInt16LE(nome.length, 26)
    local.writeUInt16LE(0, 28)
    partes.push(local, nome, dados)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(flags, 8)
    dir.writeUInt16LE(metodo, 10)
    dir.writeUInt16LE(hora, 12)
    dir.writeUInt16LE(data, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(dados.length, 20)
    dir.writeUInt32LE(bruto.length, 24)
    dir.writeUInt16LE(nome.length, 28)
    dir.writeUInt32LE(deslocamento, 42)
    central.push(dir, nome)

    deslocamento += local.length + nome.length + dados.length
    if (deslocamento > 0xffffffff) throw new Error('O .zip passou de 4 GB')
  }

  const tamanhoCentral = central.reduce((s, b) => s + b.length, 0)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(arquivos.length, 8)
  fim.writeUInt16LE(arquivos.length, 10)
  fim.writeUInt32LE(tamanhoCentral, 12)
  fim.writeUInt32LE(deslocamento, 16)

  return Buffer.concat([...partes, ...central, fim])
}
