import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { perfilDaSessao } from '@/lib/auth/empresaAtiva'
import {
  minutosValidos, INATIVIDADE_MIN_MINIMO, INATIVIDADE_MIN_MAXIMO, type ConfigSessao,
} from '@/lib/auth/configSessao'

// Encerramento automático da sessão do painel, por empresa. A leitura que
// importa (a do SessaoVigia) acontece no layout do dashboard; aqui fica só a
// escrita, restrita a quem administra configurações — senão o próprio
// funcionário desligaria a regra que existe para protegê-lo.

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'gerenciar_configuracoes')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  // Grava na empresa ATIVA (a mesma que a tela mostrou e que o layout lê),
  // não na do cadastro — com o seletor de empresas as duas podem diferir.
  const profile = await perfilDaSessao(sb, guarda.userId)
  const empresaId = profile?.empresa_id
  if (!empresaId) return NextResponse.json({ ok: false, erro: 'Empresa não identificada' }, { status: 403 })

  const inatividadeAtiva = body.inatividadeAtiva !== false
  const viradaDiaAtiva = body.viradaDiaAtiva !== false
  const inatividadeMin = Number(body.inatividadeMin)

  // O tempo só é exigido válido com a regra ligada. Desligada, guarda o que
  // veio se fizer sentido (para religar voltando ao mesmo número) e cai no
  // padrão se não fizer.
  if (inatividadeAtiva && !minutosValidos(inatividadeMin)) {
    return NextResponse.json({
      ok: false,
      erro: `Informe um tempo inteiro entre ${INATIVIDADE_MIN_MINIMO} e ${INATIVIDADE_MIN_MAXIMO} minutos.`,
    }, { status: 400 })
  }

  const config: ConfigSessao = {
    inatividadeAtiva,
    inatividadeMin: minutosValidos(inatividadeMin) ? inatividadeMin : 30,
    viradaDiaAtiva,
  }

  const { error } = await sb.from('empresa_config_sessao').upsert({
    empresa_id: empresaId,
    logout_inatividade_ativo: config.inatividadeAtiva,
    logout_inatividade_min: config.inatividadeMin,
    logout_virada_dia_ativo: config.viradaDiaAtiva,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'empresa_id' })

  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, config })
}
