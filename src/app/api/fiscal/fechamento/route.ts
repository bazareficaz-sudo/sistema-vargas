import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermissao } from '@/lib/auth/permissoes'
import { empresasDoUsuario } from '@/lib/auth/empresaAtiva'
import { montarCsv, montarFechamento, nomeDoZip, periodoDoMes, type Partes } from '@/lib/fiscal/fechamento'
import { gerarZip } from '@/lib/zip/zip'

// Fechamento do contador — GET ?mes=AAAA-MM
//   &formato=resumo  → números do mês e pendências (a tela)
//   &formato=zip     → o .zip com os XMLs e a planilha resumo.csv
//   &partes=vendas | compras  → só uma parte (padrão: as duas)
//
// Lê com o cliente de serviço, mas só DEPOIS de validar a permissão e a
// empresa ativa do usuário: as NFC-e de uma empresa podem ter sido lançadas
// nas vendas de outra do grupo (ver fechamento.ts), e a política das tabelas
// nem sempre deixa enxergar a outra empresa.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const sb = await createClient()
  const guarda = await exigirPermissao(sb, 'exportar_dados')
  if (!guarda.ok) return NextResponse.json({ ok: false, erro: guarda.erro }, { status: guarda.status })

  const url = req.nextUrl
  const mes = url.searchParams.get('mes') ?? ''
  if (!periodoDoMes(mes)) return NextResponse.json({ ok: false, erro: 'Mês inválido — use AAAA-MM' }, { status: 400 })
  const formato = url.searchParams.get('formato') === 'zip' ? 'zip' : 'resumo'
  const p = url.searchParams.get('partes')
  const partes: Partes = { vendas: p !== 'compras', compras: p !== 'vendas' }

  const permitidas = (await empresasDoUsuario(sb, guarda.userId)).map(e => e.id)

  try {
    const f = await montarFechamento(createAdminClient(), guarda.empresaId, mes, {
      partes, comXml: formato === 'zip', empresasPermitidas: permitidas,
    })

    if (formato === 'resumo') {
      return NextResponse.json({
        ok: true, empresa: f.empresa, periodo: f.periodo,
        vendasNfce: f.vendasNfce, vendasNfe: f.vendasNfe, compras: f.compras,
        pendencias: f.pendencias,
        // A tela mostra as notas de compra uma a uma (são poucas); as de venda
        // só em número — passam de 600 por mês.
        notasCompra: f.linhas.filter(l => l.grupo === 'Compra NF-e'),
      })
    }

    const leiaMe = [
      `Fechamento fiscal — ${f.empresa.nome} (CNPJ ${f.empresa.cnpj})`,
      `Competência: ${f.periodo.rotulo}`,
      '',
      `Vendas NFC-e: ${f.vendasNfce.quantidade} notas — R$ ${f.vendasNfce.valor.toFixed(2).replace('.', ',')}`,
      `Vendas NF-e: ${f.vendasNfe.quantidade} notas — R$ ${f.vendasNfe.valor.toFixed(2).replace('.', ',')}`,
      `Compras NF-e: ${f.compras.quantidade} notas — R$ ${f.compras.valor.toFixed(2).replace('.', ',')}`,
      '',
      ...(f.pendencias.length ? ['Pendências:', ...f.pendencias.map(x => `- ${x.tipo}: ${x.quantidade}. ${x.detalhe}`)] : ['Sem pendências.']),
      '',
      `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    ].join('\r\n')

    const zip = gerarZip([
      ...f.arquivos,
      { nome: 'resumo.csv', conteudo: montarCsv(f.linhas) },
      { nome: 'LEIA-ME.txt', conteudo: leiaMe },
    ])
    const nome = nomeDoZip(f, partes)
    return new Response(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nome}"`,
        'Content-Length': String(zip.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 })
  }
}
