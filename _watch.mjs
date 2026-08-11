import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ate = Date.now() + 26*60*1000
while (Date.now() < ate) {
  const { data } = await sb.from('marketplace_sync_log').select('canal_id, status, mensagem, created_at')
    .eq('tipo','varredura').order('created_at',{ascending:false}).limit(12)
  if (data?.length) {
    const { data: cs } = await sb.from('marketplace_canais')
      .select('id, nome, plataforma, varredura_status, varredura_itens, varredura_rodadas, varredura_cursor, varredura_erro')
      .not('access_token','is',null)
    const nome = new Map((cs??[]).map(c=>[c.id,c.nome]))
    console.log('=== LOGS DE VARREDURA ===')
    for (const l of data) console.log(` ${l.created_at.slice(11,19)} ${String(nome.get(l.canal_id)).padEnd(12)} ${l.status.padEnd(10)} ${l.mensagem}`)
    console.log('\n=== ESTADO DOS CANAIS ===')
    for (const c of cs??[]) console.log(` ${c.nome.padEnd(12)} ${String(c.varredura_status).padEnd(13)} itens:${String(c.varredura_itens).padEnd(6)} rodadas:${c.varredura_rodadas} cursor:${JSON.stringify(c.varredura_cursor)} ${c.varredura_erro ?? ''}`)
    process.exit(0)
  }
  await new Promise(r=>setTimeout(r, 60000))
}
console.log('NENHUM LOG DE VARREDURA EM 26 MINUTOS — o cron nao disparou ou nao chegou a abrir log.')
