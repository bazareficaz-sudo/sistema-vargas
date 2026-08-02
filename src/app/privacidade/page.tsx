import Link from 'next/link'
import type { Metadata } from 'next'

// Página pública de Privacidade e Segurança.
//
// Duas regras que valem para tudo aqui:
//
// 1. Só afirma o que existe. A tentação numa página dessas é listar o que
//    "deveria" haver. Um cliente que descobre uma promessa vazia perde a
//    confiança no resto — e, sob a LGPD, informação enganosa sobre tratamento
//    de dado é problema jurídico, não só de imagem.
// 2. Nomeia fornecedor só onde ele já é visível para o cliente (marketplace,
//    WhatsApp, provedor fiscal). Hospedagem e banco entram por função. A lista
//    nominal completa fica disponível a quem pedir — é o que a transparência
//    do Art. 9º exige, sem virar mapa da infraestrutura.

export const metadata: Metadata = {
  title: 'Privacidade e Segurança — Sistema Vargas',
  description: 'Como o Sistema Vargas trata, protege e compartilha dados pessoais, de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018).',
}

const ATUALIZADO_EM = '2 de agosto de 2026'

// Cada linha declara finalidade e base legal — é o mínimo que o Art. 9º exige
// que o titular consiga descobrir sem precisar perguntar.
const DADOS = [
  {
    categoria: 'Cadastro de quem contrata',
    exemplos: 'Nome, e-mail, telefone, CNPJ e dados da empresa',
    finalidade: 'Criar e manter a conta, cobrar a assinatura, prestar suporte',
    base: 'Execução de contrato (Art. 7º, V)',
  },
  {
    categoria: 'Uso do sistema',
    exemplos: 'Registro de acesso, ações realizadas, data e hora',
    finalidade: 'Segurança, auditoria e investigação de incidente',
    base: 'Obrigação legal e legítimo interesse (Art. 7º, II e IX)',
  },
  {
    categoria: 'Clientes finais da empresa contratante',
    exemplos: 'Nome, CPF ou CNPJ, endereço, telefone, histórico de compra',
    finalidade: 'Emitir documento fiscal, controlar crédito, atender o comprador',
    base: 'Definida pela empresa contratante — atuamos a pedido dela',
  },
  {
    categoria: 'Pedidos vindos de marketplaces',
    exemplos: 'Dados do comprador e endereço de entrega repassados pela plataforma',
    finalidade: 'Registrar o pedido, baixar estoque e emitir a nota',
    base: 'Execução do contrato entre a empresa e o comprador',
  },
  {
    categoria: 'Documentos fiscais',
    exemplos: 'NF-e e NFC-e emitidas, com os dados que a legislação exige',
    finalidade: 'Cumprir a obrigação fiscal brasileira',
    base: 'Obrigação legal (Art. 7º, II)',
  },
]

const DIREITOS = [
  ['Confirmação e acesso', 'Saber se tratamos dados seus e obter cópia deles.'],
  ['Correção', 'Corrigir dado incompleto, desatualizado ou errado.'],
  ['Anonimização ou eliminação', 'Pedir a remoção de dado desnecessário ou tratado fora da lei.'],
  ['Portabilidade', 'Receber seus dados em formato que outro sistema consiga ler.'],
  ['Informação sobre compartilhamento', 'Saber com quem compartilhamos e por quê.'],
  ['Revogação do consentimento', 'Retirar consentimento quando ele for a base do tratamento.'],
  ['Oposição', 'Se opor a tratamento que você considere irregular.'],
  ['Revisão de decisão automatizada', 'Pedir revisão humana de decisão tomada só por sistema.'],
]

// Só entra aqui o que foi verificado funcionando em produção. Controle que
// ainda está sendo implantado fica na seção "o que ainda estamos construindo" —
// separado de propósito, para o leitor não precisar adivinhar qual é qual.
const SEGURANCA = [
  {
    titulo: 'Tudo trafega criptografado',
    texto: 'Toda comunicação com o sistema usa HTTPS. O navegador é instruído a recusar conexão sem criptografia com nosso endereço, então nem uma tentativa de acesso por engano trafega aberta.',
  },
  {
    titulo: 'Dado guardado também é criptografado',
    texto: 'O banco de dados e o armazenamento de arquivos cifram o conteúdo em disco, incluindo as cópias de segurança.',
  },
  {
    titulo: 'Cada empresa enxerga só o que é dela',
    texto: 'Todo registro carrega a empresa dona, e toda consulta é filtrada pela empresa de quem está logado. Uma empresa nunca vê o cliente, a venda ou o preço de outra. Compartilhamento entre CNPJs só existe quando o próprio administrador cria a parceria, e nunca entre clientes diferentes da plataforma.',
  },
  {
    titulo: 'Proteção dentro do próprio banco',
    texto: 'As tabelas mais sensíveis — credenciais de integração, histórico de pedidos, registros de auditoria — são protegidas no banco de dados, e não apenas pelo sistema. Um erro de programação, sozinho, não é suficiente para expor esse conteúdo.',
  },
  {
    titulo: 'Senha não é guardada',
    texto: 'Senhas nunca são armazenadas de forma legível nem passam pelo código do sistema: ficam sob guarda de um serviço especializado de identidade, em formato irreversível. A senha do operador de caixa é conferida dentro do banco, que jamais devolve o valor guardado.',
  },
  {
    titulo: 'Perfis de acesso conferidos no servidor',
    texto: 'Existem seis perfis com permissões definidas em um único lugar do código, que não podem ser alteradas por engano pela tela. Nas operações sensíveis, a permissão é conferida no servidor — esconder um botão nunca é tratado como controle de acesso.',
  },
  {
    titulo: 'Ações importantes ficam registradas',
    texto: 'Convite de usuário, mudança de perfil, bloqueio de conta, acesso de suporte e emissão fiscal são gravados com autor, data, valor anterior e valor novo. A movimentação de estoque é um extrato que só recebe lançamentos: correção entra como novo registro, nunca apagando o anterior.',
  },
  {
    titulo: 'Suporte não entra sem deixar rastro',
    texto: 'Quando nossa equipe precisa acessar a conta de um cliente para resolver um chamado, o acesso exige justificativa por escrito, expira sozinho em duas horas, fica registrado, e o cliente é avisado por um aviso na tela no próximo acesso dele.',
  },
]

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Cabeçalho */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-black text-sm">V</span>
            </div>
            <span className="font-black text-gray-900 text-base tracking-tight">Vargas ERP</span>
          </Link>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            ← Voltar ao site
          </Link>
        </div>
      </header>

      {/* Capa */}
      <section className="border-b border-gray-100" style={{ background: '#0f172a' }}>
        <div className="max-w-5xl mx-auto px-6 py-14">
          <p className="text-blue-300 text-xs font-bold tracking-widest uppercase mb-3">
            Lei Geral de Proteção de Dados · Lei 13.709/2018
          </p>
          <h1 className="text-3xl lg:text-4xl font-black text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>
            Privacidade e Segurança
          </h1>
          <p className="text-slate-300 mt-4 max-w-3xl leading-relaxed">
            Esta página explica quais dados o Sistema Vargas trata, por que trata, com quem
            compartilha e como protege. Está escrita para ser entendida por quem usa o sistema,
            não só por advogado.
          </p>
          <p className="text-slate-500 text-xs mt-6">Última atualização: {ATUALIZADO_EM}</p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-14">

        {/* Papéis */}
        <section id="papeis">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Quem responde pelo quê</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            A LGPD separa dois papéis, e a diferença muda quem você deve procurar. No Sistema
            Vargas, ocupamos os dois — dependendo de qual dado se trata.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="font-bold text-gray-900 mb-2">Somos controladores</p>
              <p className="text-sm text-gray-600 leading-relaxed">
                dos dados de quem contrata o sistema: cadastro da empresa, dados dos usuários,
                cobrança e registros de uso. Aqui as decisões sobre o tratamento são nossas, e a
                responsabilidade também.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="font-bold text-gray-900 mb-2">Somos operadores</p>
              <p className="text-sm text-gray-600 leading-relaxed">
                dos dados que a empresa contratante cadastra no sistema — os clientes finais dela.
                Tratamos esses dados a pedido dela e conforme a instrução dela. Quem decide o que
                fazer com esse dado é a empresa, não nós.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-blue-50 border border-blue-100 p-5">
            <p className="text-sm text-blue-900 leading-relaxed">
              <strong>Na prática:</strong> se você é consumidor e comprou numa loja que usa o
              Sistema Vargas, quem responde pelos seus dados é a loja. Procure ela primeiro. Se
              não obtiver resposta, pode falar conosco — vamos encaminhar e apoiar, dentro do
              nosso papel de operador.
            </p>
          </div>
        </section>

        {/* Dados tratados */}
        <section id="dados">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Que dados tratamos, e por quê</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Não coletamos dado &quot;por precaução&quot;. Cada categoria abaixo existe porque uma
            função do sistema depende dela, e vem acompanhada da base legal que autoriza o
            tratamento.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Categoria</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Exemplos</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Para quê</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Base legal</th>
                </tr>
              </thead>
              <tbody>
                {DADOS.map(d => (
                  <tr key={d.categoria} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-4 py-3 font-semibold text-gray-900">{d.categoria}</td>
                    <td className="px-4 py-3 text-gray-600">{d.exemplos}</td>
                    <td className="px-4 py-3 text-gray-600">{d.finalidade}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{d.base}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-500 mt-4 leading-relaxed">
            Não vendemos dado pessoal. Não usamos o dado do cliente de uma empresa contratante para
            publicidade, formação de perfil comercial nem treinamento de inteligência artificial.
          </p>
        </section>

        {/* Segurança */}
        <section id="seguranca">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Como protegemos</h2>
          <p className="text-gray-600 leading-relaxed mb-6">
            Abaixo está o que está em funcionamento hoje — não o que pretendemos fazer. O que ainda
            está sendo construído aparece logo depois, separado de propósito.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {SEGURANCA.map(s => (
              <div key={s.titulo} className="rounded-2xl border border-gray-200 p-5">
                <p className="font-bold text-gray-900 mb-2">{s.titulo}</p>
                <p className="text-sm text-gray-600 leading-relaxed">{s.texto}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="font-bold text-amber-900 mb-2">O que ainda estamos construindo</p>
            <p className="text-sm text-amber-900 leading-relaxed mb-3">
              Segurança não tem linha de chegada. Preferimos declarar o que falta a deixar
              subentendido que está tudo pronto:
            </p>
            <ul className="text-sm text-amber-900 space-y-1.5 list-disc pl-5">
              <li>
                Ampliação da conferência de permissão no servidor para todas as operações do
                sistema — hoje ela cobre as sensíveis, e estamos estendendo às demais.
              </li>
              <li>
                Autenticação em duas etapas obrigatória em todas as contas administrativas.
              </li>
              <li>
                Política de conteúdo do navegador em modo de observação, antes de passar a bloquear.
              </li>
              <li>
                Teste de invasão por empresa independente.
              </li>
            </ul>
          </div>
        </section>

        {/* Compartilhamento */}
        <section id="compartilhamento">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Com quem compartilhamos</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Compartilhamos apenas o necessário para a função pedida, e só com quem tem contrato
            conosco prevendo confidencialidade e segurança.
          </p>
          <div className="rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {[
              ['Provedores de nota fiscal', 'Dados exigidos pela legislação para emitir NF-e e NFC-e junto à SEFAZ.'],
              ['Marketplaces', 'Mercado Livre, Shopee e demais canais que a empresa conectar — troca de anúncios, pedidos e dados de entrega.'],
              ['Serviço de mensagens', 'Envio de orçamento, cobrança e pós-venda por WhatsApp, quando a empresa ativa o recurso.'],
              ['Meio de pagamento', 'Processamento da assinatura do sistema. Não recebemos nem guardamos número de cartão.'],
              ['Infraestrutura em nuvem', 'Hospedagem da aplicação, banco de dados e armazenamento de arquivos.'],
            ].map(([quem, oque]) => (
              <div key={quem} className="p-5">
                <p className="font-semibold text-gray-900 text-sm">{quem}</p>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">{oque}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-4 leading-relaxed">
            Parte da infraestrutura fica fora do Brasil. A transferência internacional observa o
            Art. 33 da LGPD e ocorre sob cláusulas contratuais de proteção. A lista nominal completa
            dos fornecedores, com finalidade e localidade, está disponível a qualquer contratante
            que solicitar pelo canal abaixo.
          </p>
        </section>

        {/* Direitos */}
        <section id="direitos">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Seus direitos</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            O Art. 18 da LGPD garante os direitos abaixo a qualquer titular. Exercê-los é gratuito.
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {DIREITOS.map(([titulo, desc]) => (
              <div key={titulo} className="rounded-xl border border-gray-200 p-4">
                <p className="font-semibold text-gray-900 text-sm">{titulo}</p>
                <p className="text-sm text-gray-600 mt-1">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl bg-gray-50 border border-gray-200 p-5">
            <p className="font-bold text-gray-900 mb-2 text-sm">Como pedir</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              Escreva para o canal de contato abaixo dizendo qual direito quer exercer. Respondemos
              em até 15 dias. Podemos pedir informação adicional para confirmar sua identidade —
              não entregamos dado pessoal a quem não conseguimos identificar como titular. Se o
              pedido envolver dado que está sob responsabilidade de uma empresa contratante,
              encaminhamos a ela e informamos você.
            </p>
          </div>
        </section>

        {/* Retenção */}
        <section id="retencao">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Por quanto tempo guardamos</h2>
          <div className="rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {[
              ['Dados da conta', 'Enquanto a assinatura estiver ativa.'],
              ['Documento fiscal e o que o sustenta', 'Pelo prazo que a legislação tributária brasileira exige — em regra, cinco anos. Esse prazo se sobrepõe a pedido de exclusão, porque a guarda é obrigação legal.'],
              ['Registros de auditoria', 'No mínimo doze meses.'],
              ['Demais dados operacionais', 'Até o encerramento do contrato, com prazo adicional para a empresa exportar o que precisar.'],
            ].map(([o, q]) => (
              <div key={o} className="p-5">
                <p className="font-semibold text-gray-900 text-sm">{o}</p>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">{q}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Cookies */}
        <section id="cookies">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Cookies</h2>
          <p className="text-gray-600 leading-relaxed">
            Usamos cookies para manter você conectado com segurança e para guardar preferências
            de tela, como o modo de exibição do menu. São necessários ao funcionamento — sem eles
            você seria desconectado a cada página. O cookie de sessão é acessível apenas pelo
            servidor e trafega somente por conexão criptografada.
          </p>
          <p className="text-gray-600 leading-relaxed mt-3">
            Não usamos cookie de publicidade nem de rastreamento entre sites.
          </p>
        </section>

        {/* Incidentes */}
        <section id="incidentes">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Se acontecer um incidente</h2>
          <p className="text-gray-600 leading-relaxed">
            Temos um procedimento escrito de resposta, com prazos definidos: conter em até 4 horas
            a partir da confirmação, avaliar o alcance em 24 horas, e comunicar as empresas
            afetadas e as plataformas envolvidas no mesmo prazo. A comunicação à ANPD e aos
            titulares segue o Art. 48 da LGPD. Em até 10 dias úteis produzimos um registro escrito
            do que houve, da causa e do que mudou para não se repetir.
          </p>
          <p className="text-gray-600 leading-relaxed mt-3">
            Se você identificou uma falha de segurança no Sistema Vargas, escreva para o canal
            abaixo. Recebemos relatos de boa-fé sem retaliação e respondemos.
          </p>
        </section>

        {/* Contato */}
        <section id="contato">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Encarregado e contato</h2>
          <div className="rounded-2xl border border-gray-200 p-6">
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              O encarregado pelo tratamento de dados pessoais (Art. 41 da LGPD) é o canal entre
              você, a empresa e a Autoridade Nacional de Proteção de Dados.
            </p>
            <div className="space-y-2 text-sm">
              <p className="text-gray-900"><strong>Encarregado:</strong> [NOME DO ENCARREGADO]</p>
              <p className="text-gray-900">
                <strong>E-mail:</strong>{' '}
                <a href="mailto:privacidade@sistemavargas.com.br" className="text-blue-600 hover:underline">
                  privacidade@sistemavargas.com.br
                </a>
              </p>
              <p className="text-gray-900">
                <strong>Segurança:</strong>{' '}
                <a href="mailto:security@sistemavargas.com.br" className="text-blue-600 hover:underline">
                  security@sistemavargas.com.br
                </a>
              </p>
              <p className="text-gray-900"><strong>Razão social:</strong> [RAZÃO SOCIAL] — CNPJ [XX.XXX.XXX/0001-XX]</p>
            </div>
            <p className="text-xs text-gray-500 mt-5 leading-relaxed">
              Você também pode apresentar reclamação diretamente à Autoridade Nacional de Proteção
              de Dados (ANPD), pelo site gov.br/anpd.
            </p>
          </div>
        </section>

        {/* Mudanças */}
        <section id="mudancas">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Mudanças nesta página</h2>
          <p className="text-gray-600 leading-relaxed">
            Revisamos este documento pelo menos uma vez por ano, e sempre que houver mudança
            relevante no tratamento de dados. Alteração significativa é comunicada às empresas
            contratantes por e-mail e por aviso dentro do sistema, antes de passar a valer.
          </p>
        </section>
      </div>

      {/* Rodapé */}
      <footer className="border-t border-gray-100 mt-8">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">© 2026 Sistema Vargas ERP</p>
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
            Voltar ao site →
          </Link>
        </div>
      </footer>
    </main>
  )
}
