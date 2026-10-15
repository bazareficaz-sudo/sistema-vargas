import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { midiaDaMensagem, semMarca, textoDaMensagem, tipoPelaMarca } from '../../src/lib/whatsapp/contatos'
import { caminhoGuardado, comoMostrar, extensaoDoArquivo, referenciaGuardada } from '../../src/lib/whatsapp/midias'

describe('arquivos das conversas', () => {
  test('tipo e link do arquivo que veio na mensagem', () => {
    assert.deepEqual(midiaDaMensagem({ image: { imageUrl: 'https://z/a.jpeg', caption: ' esse ' } }), { tipo: 'foto', url: 'https://z/a.jpeg', legenda: 'esse' })
    assert.equal(midiaDaMensagem({ audio: { audioUrl: 'https://z/a.ogg' } })?.tipo, 'audio')
    assert.equal(midiaDaMensagem({ video: { videoUrl: 'https://z/a.mp4' } })?.tipo, 'video')
    assert.deepEqual(midiaDaMensagem({ document: { documentUrl: 'https://z/o.pdf', fileName: 'orcamento.pdf' } }), { tipo: 'documento', url: 'https://z/o.pdf', legenda: 'orcamento.pdf' })
    assert.equal(midiaDaMensagem({ sticker: { stickerUrl: 'https://z/s.webp' } })?.tipo, 'figurinha')
    // Só https: link estranho não é baixado.
    assert.equal(midiaDaMensagem({ image: { imageUrl: 'http://10.0.0.1/x.jpg' } }), null)
    assert.equal(midiaDaMensagem({ text: { message: 'oi' } }), null)
  })
  test('texto do histórico com a marca do arquivo', () => {
    assert.equal(textoDaMensagem({ audio: { audioUrl: 'https://z/a.ogg' } }), '[áudio]')
    assert.equal(textoDaMensagem({ video: { videoUrl: 'https://z/a.mp4', caption: 'olha' } }), '[vídeo] olha')
    assert.equal(textoDaMensagem({ document: { documentUrl: 'https://z/o.pdf', fileName: 'nota.pdf' } }), '[documento] nota.pdf')
    assert.equal(tipoPelaMarca('[foto] *TINTA*'), 'foto')
    assert.equal(tipoPelaMarca('[fotografia]'), null)
    assert.equal(semMarca('[foto] *TINTA*\nCód. 1'), '*TINTA*\nCód. 1')
    assert.equal(semMarca('[áudio]'), '')
    assert.equal(semMarca('oi'), 'oi')
  })
  test('referência do arquivo guardado no bucket', () => {
    const ref = referenciaGuardada('emp/cont/m.jpg')
    assert.equal(caminhoGuardado(ref), 'emp/cont/m.jpg')
    assert.equal(caminhoGuardado('https://x/y.jpg'), null)
    assert.equal(caminhoGuardado(null), null)
  })
  test('extensão pelo tipo, senão pelo link', () => {
    assert.equal(extensaoDoArquivo('image/jpeg; charset=x', 'https://z/a'), 'jpg')
    assert.equal(extensaoDoArquivo('application/octet-stream', 'https://z/a.OGG?x=1'), 'ogg')
    assert.equal(extensaoDoArquivo(null, 'https://z/arquivo'), 'bin')
  })
  test('como mostrar: marca primeiro, depois extensão', () => {
    assert.equal(comoMostrar('[áudio]', 'storage:whatsapp-midias/e/c/m.bin'), 'audio')
    assert.equal(comoMostrar('[figurinha]', 'https://z/s.webp'), 'foto')
    assert.equal(comoMostrar('*TINTA*', 'https://x/produto.webp'), 'foto')
    assert.equal(comoMostrar('Orçamento 12', 'https://x/orc.pdf'), 'documento')
    assert.equal(comoMostrar('oi', null), null)
  })
})
