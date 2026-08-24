import { NextResponse } from 'next/server'
import { contextoAdmin } from '@/lib/commerce/admin'

// Criação da loja de uma empresa.
//
// Cria DUAS coisas, nesta ordem, porque a segunda depende da primeira:
//   1. o canal em `marketplace_canais` com plataforma='loja_online';
//   2. a configuração em `loja_config`, apontando para ele.
//
// O canal nasce SEM `access_token` e com sincronização desligada. Não é
// descuido: é o que mantém a loja fora dos crons de marketplace, que filtram
// justamente por token e por plataforma. Ver src/lib/marketplace/canais.ts.

export const dynamic = 'force-dynamic'

const SUBDOMINIO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const RESERVADOS = new Set(['www', 'app', 'admin', 'api', 'painel', 'sistema', 'suporte', 'loja'])

export async function POST(req: Request) {
  const ctx = await contextoAdmin()
  if (!ctx) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  if (ctx.lojaId) return NextResponse.json({ erro: 'Esta empresa já tem uma loja' }, { status: 409 })

  const c = await req.json().catch(() => null) as { nome?: string; subdominio?: string } | null
  const nome = (c?.nome ?? '').trim().slice(0, 120)
  const subdominio = (c?.subdominio ?? '').trim().toLowerCase()

  if (nome.length < 2) return NextResponse.json({ erro: 'Informe o nome da loja' }, { status: 400 })
  if (!SUBDOMINIO.test(subdominio)) {
    return NextResponse.json({ erro: 'Endereço inválido: use letras minúsculas, números e hífen' }, { status: 400 })
  }
  if (RESERVADOS.has(subdominio)) {
    return NextResponse.json({ erro: 'Este endereço é reservado pela plataforma' }, { status: 400 })
  }

  const { data: canal, error: erroCanal } = await ctx.sb
    .from('marketplace_canais')
    .insert({
      empresa_id: ctx.empresaId,
      nome: 'Loja Online',
      plataforma: 'loja_online',
      ativo: true,
      sincronizar_estoque: false,
      sincronizar_preco: false,
      atualizar_estoque_canal: false,
      debitar_estoque_vendas: true,
    })
    .select('id').single()

  if (erroCanal || !canal) {
    console.error('[loja-admin] criar canal falhou', erroCanal?.message)
    return NextResponse.json({ erro: 'Não foi possível criar o canal' }, { status: 500 })
  }

  // Depósito padrão: o principal ativo da empresa. Sem isto a loja nasceria
  // com estoque zero em tudo e pareceria quebrada.
  const { data: deposito } = await ctx.sb
    .from('depositos').select('id')
    .eq('empresa_id', ctx.empresaId).eq('ativo', true).eq('principal', true)
    .order('created_at').limit(1).maybeSingle()

  const { error: erroLoja } = await ctx.sb.from('loja_config').insert({
    empresa_id: ctx.empresaId,
    canal_id: canal.id,
    subdominio,
    nome,
    // Fechada. Sempre.
    ativo: false,
    em_manutencao: true,
    indexavel: false,
    estoque_modo: 'deposito_unico',
    estoque_deposito_id: deposito?.id ?? null,
    estoque_fonte: 'produto_estoque',
    sem_estoque_comportamento: 'mostrar_indisponivel',
  })

  if (erroLoja) {
    // Sem transação entre as duas inserções (PostgREST não oferece uma), então
    // desfazer o canal à mão. Canal órfão com plataforma='loja_online'
    // apareceria no seletor de canais dos Pedidos sem loja nenhuma atrás.
    await ctx.sb.from('marketplace_canais').delete().eq('id', canal.id)
    const duplicado = erroLoja.code === '23505'
    console.error('[loja-admin] criar loja falhou', erroLoja.message)
    return NextResponse.json(
      { erro: duplicado ? 'Este endereço já está em uso por outra loja.' : 'Não foi possível criar a loja' },
      { status: duplicado ? 409 : 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
