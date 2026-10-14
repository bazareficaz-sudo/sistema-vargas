// Chamado pelas telas de entrada (navegador) assim que a nota termina de
// gravar: pede ao servidor o boletim "Chegou na loja" desta nota.
//
// Não espera nem trata resposta de propósito — o boletim nunca pode travar
// nem derrubar a finalização da nota. Se esta chamada não chegar (aba
// fechada, rede caiu), o cron da Betina manda o boletim em até 15 min.
export function avisarChegada(referenciaTipo: 'entrada' | 'entrada_xml', referenciaId: string): void {
  try {
    fetch('/api/getulio/chegadas/disparar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referencia_tipo: referenciaTipo, referencia_id: referenciaId }),
      // Sobrevive à navegação para a próxima tela.
      keepalive: true,
    }).catch(() => { /* rede de segurança: cron */ })
  } catch { /* idem */ }
}
