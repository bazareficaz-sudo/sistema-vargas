// O segredo que assina o token do terminal.
//
// Vive só no servidor, em variável de ambiente. NUNCA vai para o Electron —
// qualquer coisa embutida num aplicativo distribuído deve ser considerada
// recuperável, e um segredo de assinatura recuperado é a capacidade de forjar
// a identidade de qualquer terminal de qualquer empresa.
//
// Falha alto na ausência: um segredo vazio assinaria tokens que qualquer um
// reproduz, e o sistema pareceria funcionar. É a pior falha possível aqui.
export function segredoDeAssinatura(): string {
  const s = process.env.PDV_TOKEN_SECRET
  if (!s || s.length < 32) {
    throw new Error(
      'PDV_TOKEN_SECRET ausente ou curto demais. Defina uma variável de ambiente ' +
      'com pelo menos 32 caracteres aleatórios antes de emitir token de terminal.',
    )
  }
  return s
}
