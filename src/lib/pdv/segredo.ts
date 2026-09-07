// O segredo que assina o token do terminal.
//
// Vive só no servidor, em variável de ambiente. NUNCA vai para o Electron —
// qualquer coisa embutida num aplicativo distribuído deve ser considerada
// recuperável, e um segredo de assinatura recuperado é a capacidade de forjar
// a identidade de qualquer terminal de qualquer empresa.
//
// Falha alto na ausência: um segredo vazio assinaria tokens que qualquer um
// reproduz, e o sistema pareceria funcionar. É a pior falha possível aqui.

const TAMANHO_MINIMO = 32

export function segredoDeAssinatura(): string {
  const s = process.env.PDV_TOKEN_SECRET
  if (!s || s.length < TAMANHO_MINIMO) {
    throw new Error(
      'PDV_TOKEN_SECRET ausente ou curto demais. Defina uma variável de ambiente ' +
      'com pelo menos 32 caracteres aleatórios antes de emitir token de terminal.',
    )
  }
  return s
}

/**
 * Os segredos aceitos na VERIFICAÇÃO, em ordem de preferência.
 *
 * Assinar é sempre com um só — o atual. Verificar aceita também o anterior,
 * quando `PDV_TOKEN_SECRET_ANTERIOR` está definido, e é isso que torna a
 * rotação possível sem derrubar terminal:
 *
 *   1. copia o segredo atual para PDV_TOKEN_SECRET_ANTERIOR
 *   2. põe um segredo novo em PDV_TOKEN_SECRET
 *   3. espera passar a validade do token mais longo em circulação (12 h)
 *   4. remove PDV_TOKEN_SECRET_ANTERIOR
 *
 * Sem os passos 1 e 3, os tokens já emitidos morreriam no instante do deploy
 * e todo terminal ativo renovaria ao mesmo tempo. Funcionaria — e seria uma
 * indisponibilidade auto-infligida sem motivo nenhum.
 */
export function segredosDeVerificacao(): string[] {
  const segredos = [segredoDeAssinatura()]
  const anterior = process.env.PDV_TOKEN_SECRET_ANTERIOR
  if (anterior && anterior.length >= TAMANHO_MINIMO) segredos.push(anterior)
  return segredos
}

/**
 * O ambiente está pronto para emitir token? Serve para a tela administrativa
 * poder dizer "o servidor ainda não tem o segredo configurado" ANTES de
 * alguém gerar um código de ativação e descobrir isso no balcão.
 *
 * Devolve booleano. Nunca o segredo, nem o tamanho dele.
 */
export function segredoConfigurado(): boolean {
  try { segredoDeAssinatura(); return true } catch { return false }
}
