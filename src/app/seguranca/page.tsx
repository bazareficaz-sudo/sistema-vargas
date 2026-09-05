import Link from 'next/link'
import type { Metadata } from 'next'

// Página pública de Política de Segurança da Informação.
//
// POR QUE ELA É SEPARADA DE /privacidade, e não uma seção dentro dela:
//
// A primeira submissão à TikTok Shop foi recusada, e um dos motivos apontados
// pelo revisor foi que a pergunta sobre política de segurança havia sido
// respondida com o link da política de privacidade. São documentos diferentes,
// com públicos diferentes: a privacidade responde ao TITULAR do dado sobre o
// que é feito com ele; esta responde ao PARCEIRO sobre como o ambiente é
// protegido. Apontar uma para a outra é o erro que já custou uma reprovação.
//
// AS DUAS REGRAS DA PÁGINA, herdadas de /privacidade:
//
// 1. Só afirma o que existe HOJE. Controle em implantação vai para "o que
//    ainda estamos construindo", visível e datado. Página que promete o que
//    não tem é problema jurídico sob a LGPD e, diante de um parceiro, é a
//    inexatidão que faz o revisor duvidar de todo o resto.
// 2. Fornecedor é nomeado só onde já é visível ao cliente. Hospedagem e banco
//    entram por função, com a lista nominal disponível a quem pedir.
//
// O texto integral, assinado e em inglês, continua sendo
// docs/security/INFORMATION-SECURITY-POLICY.md — é ele que vai anexado ao
// questionário. Esta página é a versão pública e verificável do mesmo
// conteúdo, no endereço que o parceiro consegue abrir sozinho.

export const metadata: Metadata = {
  title: 'Política de Segurança da Informação — Sistema Vargas',
  description: 'Como o Sistema Vargas protege o ambiente: controle de acesso, criptografia, segregação entre empresas, credenciais, registros, backups, vulnerabilidades e resposta a incidentes.',
}

const VERSAO = '1.0'
const VIGENCIA = '2 de agosto de 2026'
const REVISAO = 'Anual, ou após qualquer incidente de severidade 1'
const RESPONSAVEL = 'Silvano Nunes Vargas'

const CLASSES = [
  {
    classe: 'Restrito',
    exemplos: 'Credenciais e tokens de API das plataformas, chaves de serviço do banco, certificado digital A1, hashes de senha',
    regra: 'Nunca em código-fonte, nunca em registro de log, nunca em canal de suporte. Cifrado em repouso e em trânsito. Acesso limitado ao responsável pela segurança.',
  },
  {
    classe: 'Confidencial',
    exemplos: 'Clientes da empresa contratante (nome, CPF/CNPJ, endereço, telefone), pedidos, pagamentos, custo e margem',
    regra: 'Acessível apenas a usuários autenticados da empresa dona do dado. Nunca cruza de uma empresa para outra.',
  },
  {
    classe: 'Interno',
    exemplos: 'Catálogo de produtos, saldo de estoque, anúncios em marketplace',
    regra: 'Acessível a usuários autenticados da empresa dona.',
  },
  {
    classe: 'Público',
    exemplos: 'Conteúdo do site institucional',
    regra: 'Sem restrição.',
  },
]

// Só entra aqui o que foi verificado funcionando em produção.
const CONTROLES = [
  {
    id: 'acesso',
    titulo: 'Controle de acesso',
    itens: [
      'Menor privilégio: cada conta recebe o mínimo necessário para a sua função, por papel e não por exceção.',
      'Seis papéis fixos — administrador, gerente, financeiro, estoque, vendas e leitura — mapeados numa matriz de permissões definida em um único arquivo do código, que não pode ser alterada pela tela. Isso elimina uma classe inteira de erro de configuração.',
      'A permissão é conferida no servidor a cada requisição privilegiada. Esconder um botão na interface nunca é aceito como controle de acesso.',
      'Revogação no mesmo dia em que o vínculo da pessoa termina. Bloquear uma conta encerra a sessão na requisição seguinte, e não no próximo login.',
      'Revisão trimestral de todos os acessos de produção e de terceiros pelo responsável pela segurança.',
    ],
  },
  {
    id: 'segregacao',
    titulo: 'Segregação entre empresas',
    itens: [
      'Todo registro carrega a empresa dona, e toda consulta é filtrada pela empresa do usuário autenticado. Uma empresa nunca enxerga cliente, venda, custo ou pedido de outra.',
      'Compartilhamento entre CNPJs existe apenas quando o próprio administrador cria explicitamente uma parceria entre duas empresas sob o mesmo titular — nunca entre clientes diferentes da plataforma.',
      'A separação também é imposta dentro do banco de dados, por políticas de linha, nas tabelas de credenciais, integrações, histórico de pedidos e auditoria. Um erro na aplicação, sozinho, não basta para atravessar essa fronteira.',
    ],
  },
  {
    id: 'autenticacao',
    titulo: 'Autenticação e acesso administrativo',
    itens: [
      'Senhas nunca são armazenadas de forma legível nem passam pelo código da aplicação: ficam sob guarda de um serviço especializado de identidade, em formato irreversível.',
      'A senha do operador de caixa é conferida dentro do banco por uma função dedicada, que jamais devolve o valor guardado ao cliente.',
      'Sessões trafegam em cookie HTTP-only sobre TLS. Toda rota do painel e do PDV exige sessão válida; requisição sem autenticação é redirecionada ao login antes de qualquer leitura de dado.',
      'Acesso de suporte à conta de um cliente exige justificativa por escrito, expira sozinho em duas horas, fica registrado em auditoria e é informado ao cliente por aviso na tela no próximo acesso dele.',
      'A chave de serviço que ignora a autorização do banco é usada apenas em código de servidor, nunca é exposta ao navegador e não está presente no pacote enviado ao cliente.',
    ],
  },
  {
    id: 'criptografia',
    titulo: 'Criptografia',
    itens: [
      'Em trânsito: todo tráfego é HTTPS, com TLS 1.2 como versão mínima. O cabeçalho Strict-Transport-Security é enviado com validade de um ano incluindo subdomínios, então o navegador recusa conexão em texto aberto com o nosso endereço. Certificados são emitidos e renovados automaticamente.',
      'Em repouso: o banco de dados e o armazenamento de arquivos cifram o conteúdo em disco com AES-256 do provedor, incluindo as cópias de segurança.',
      'Certificado digital A1 usado para emissão fiscal é transmitido diretamente ao provedor fiscal licenciado sobre TLS e não fica retido no armazenamento da aplicação.',
    ],
  },
  {
    id: 'credenciais',
    titulo: 'Proteção das credenciais',
    itens: [
      'Chaves de API, tokens OAuth e chaves de serviço do banco ficam como variáveis de ambiente no cofre de configuração cifrado do provedor de hospedagem.',
      'São excluídas do controle de versão por configuração do repositório, e nunca são escritas em log da aplicação.',
      'Credenciais de produção ficam em gerenciador de senhas — nunca em arquivo de texto, planilha ou mensagem.',
      'Em caso de suspeita de exposição, a conduta está descrita na seção de incidentes, e ela é declarada como avaliação por risco, não como regra cega.',
    ],
  },
  {
    id: 'infraestrutura',
    titulo: 'Infraestrutura e rede',
    itens: [
      'A aplicação roda em plataforma de hospedagem gerenciada, sem servidor administrado por nós: não há porta SSH aberta nem console administrativo publicamente alcançável sob nossa operação.',
      'O banco é um serviço PostgreSQL gerenciado, alcançável apenas sobre TLS e protegido pelo modelo de autorização descrito acima — inclusive para requisições que apresentem a chave pública de cliente, que não carrega privilégio além do que a política concede explicitamente.',
      'Proteção contra negação de serviço, terminação TLS e filtragem de borda são fornecidas pela plataforma de hospedagem.',
    ],
  },
  {
    id: 'desenvolvimento',
    titulo: 'Desenvolvimento seguro',
    itens: [
      'Código-fonte em repositório privado, com acesso limitado a pessoas nomeadas.',
      'Toda mudança passa pela esteira de build do provedor: build que falha na verificação de tipos ou na compilação não é publicado.',
      'Dependências vêm do registro público com arquivo de trava versionado. Avisos de segurança são revisados e as atualizações aplicadas no prazo da tabela abaixo.',
      'Mudanças de estrutura do banco entram como scripts de migração versionados e revisados.',
    ],
  },
  {
    id: 'registros',
    titulo: 'Registros e auditoria',
    itens: [
      'Ações privilegiadas — convite de usuário, mudança de papel, bloqueio de conta, acesso de suporte, emissão fiscal, alteração de mapeamento de marketplace e mudança de etapa de pedido — são gravadas em tabela de auditoria imutável, com autor, ação, registro afetado, valor anterior, valor novo e data e hora.',
      'A movimentação de estoque é um extrato que só recebe lançamentos: correção entra como novo registro compensatório, nunca editando ou apagando o histórico.',
      'Registros de auditoria são mantidos por no mínimo 12 meses.',
    ],
  },
]

const CABECALHOS = [
  ['Strict-Transport-Security', 'Obriga o navegador a usar HTTPS por um ano, incluindo subdomínios'],
  ['X-Content-Type-Options: nosniff', 'Impede o navegador de adivinhar o tipo do conteúdo'],
  ['X-Frame-Options: SAMEORIGIN', 'Impede que o sistema seja embutido em site de terceiro'],
  ["Content-Security-Policy: frame-ancestors 'self'", 'Mesma proteção, na forma que os navegadores atuais usam'],
  ['Referrer-Policy: strict-origin-when-cross-origin', 'Limita o que é revelado ao sair para outro site'],
  ['Permissions-Policy', 'Nega câmera, microfone, geolocalização e APIs de pagamento'],
]

const PRAZOS = [
  ['Crítica', '7 dias'],
  ['Alta', '30 dias'],
  ['Média', '90 dias'],
  ['Baixa', 'Próxima manutenção programada'],
]

const INCIDENTE = [
  ['1. Detectar e registrar', 'Registrar o relato com hora, quem relatou e o que foi observado', 'Imediato'],
  ['2. Conter', 'Revogar ou trocar credencial afetada, bloquear contas, desligar a integração envolvida', '4 horas da confirmação'],
  ['3. Avaliar', 'Determinar qual dado, de quem, e quanto', '24 horas'],
  ['4. Notificar a plataforma', 'Avisar as empresas afetadas e qualquer plataforma cujo dado ou credencial esteja envolvido, pelo canal de segurança dela', '24 horas da confirmação'],
  ['5. Notificar autoridades', 'ANPD e titulares, onde o Art. 48 da LGPD exigir', 'Prazo legal'],
  ['6. Recuperar', 'Restabelecer o serviço a partir de estado íntegro conhecido', 'O mais rápido com segurança'],
  ['7. Revisar', 'Registro escrito: o que houve, causa raiz, o que mudou para não repetir', '10 dias úteis'],
]

const FORNECEDORES = [
  ['Provedor de hospedagem', 'Executa a aplicação web', 'Todo o tráfego da aplicação'],
  ['Provedor de banco gerenciado', 'Banco de dados, autenticação e armazenamento de arquivos', 'Todos os dados das empresas'],
  ['Provedores fiscais licenciados', 'Emissão de documento fiscal brasileiro', 'Dados de venda, cliente e tributo exigidos por lei'],
  ['Provedor de mensageria', 'Notificações por WhatsApp', 'Telefone e referência do pedido'],
  ['Provedor de pagamento', 'Cobrança da assinatura', 'Dados de cobrança do assinante'],
  ['Provedor de IA', 'Geração opcional de texto de anúncio', 'Texto do catálogo de produtos — nenhum dado de cliente'],
]

const COMPROMISSOS = [
  'Usamos o dado recebido da plataforma somente para entregar à empresa as funções de pedido, estoque e contabilidade dentro da conta dela.',
  'Não vendemos, alugamos, licenciamos nem compartilhamos esse dado com terceiro algum além dos operadores listados acima, e apenas no necessário para prestar o serviço.',
  'Não usamos esse dado para publicidade, formação de audiência ou treinamento de modelos de aprendizado de máquina.',
  'Mantemos o dado de cada empresa segregado do de todas as outras.',
  'Solicitamos o mínimo de permissões de API necessário às funções que oferecemos.',
  'Revogamos as credenciais e apagamos o dado recebido em até 30 dias do encerramento da integração ou a pedido da plataforma, exceto registros que a lei obrigue a guardar, que ficam isolados e sem tratamento posterior.',
]

// O QUE FALTA, com data. Prazo escrito e estourado é pior do que não ter
// prometido, então aqui só entram compromissos que dá para cumprir.
const CONSTRUINDO = [
  ['Autenticação em duas etapas obrigatória em todas as contas administrativas', 'Em implantação'],
  ['Conferência de permissão no servidor estendida a todas as rotas — hoje ela cobre as sensíveis', '31/10/2026'],
  ['Política de conteúdo do navegador (CSP) completa, primeiro em modo de observação', '31/10/2026'],
  ['Teste de invasão por empresa independente', 'Mediante solicitação, como condição de aprovação'],
]

export default function SegurancaPage() {
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

      {/* Capa. Cor e rótulo diferentes de /privacidade de propósito: quem abre
          as duas precisa ver na primeira tela que são documentos distintos. */}
      <section className="border-b border-gray-100" style={{ background: '#0b1b2b' }}>
        <div className="max-w-5xl mx-auto px-6 py-14">
          <p className="text-emerald-300 text-xs font-bold tracking-widest uppercase mb-3">
            Documento interno adotado · Versão {VERSAO}
          </p>
          <h1 className="text-3xl lg:text-4xl font-black text-white leading-tight" style={{ letterSpacing: '-0.02em' }}>
            Política de Segurança da Informação
          </h1>
          <p className="text-slate-300 mt-4 max-w-3xl leading-relaxed">
            Como protegemos o ambiente onde os dados ficam: quem pode acessar o quê, como as
            credenciais são guardadas, como as empresas são separadas umas das outras, o que é
            registrado e o que fazemos quando algo dá errado.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-xs text-slate-400">
            <span><span className="text-slate-500">Vigência:</span> {VIGENCIA}</span>
            <span><span className="text-slate-500">Responsável:</span> {RESPONSAVEL}</span>
            <span><span className="text-slate-500">Revisão:</span> {REVISAO}</span>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-12 space-y-14">

        {/* Distinção entre os dois documentos. Vem primeiro porque é a dúvida
            que trouxe o leitor até aqui, e porque confundir os dois foi o que
            derrubou a primeira submissão a um parceiro. */}
        <section id="escopo">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Do que trata este documento</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Esta é a nossa política de segurança da informação. Ela descreve os controles que
            protegem o ambiente. É documento distinto da{' '}
            <Link href="/privacidade" className="text-blue-600 hover:underline font-medium">
              Política de Privacidade
            </Link>
            , que responde a outra pergunta: quais dados pessoais tratamos, com que finalidade e
            com que base legal.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="font-bold text-gray-900 mb-2">Aplica-se a</p>
              <ul className="text-sm text-gray-600 leading-relaxed space-y-1.5 list-disc pl-5">
                <li>toda pessoa com acesso a sistemas de produção, seja empregado, prestador ou sócio;</li>
                <li>todo ambiente onde dado de empresa ou de plataforma é guardado ou processado — hospedagem, banco gerenciado, armazenamento de arquivos e os terminais de PDV instalados nas lojas;</li>
                <li>todo serviço de terceiro que trate dado por nossa conta.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="font-bold text-gray-900 mb-2">Uma observação sobre porte</p>
              <p className="text-sm text-gray-600 leading-relaxed">
                A organização é pequena. Onde um controle abaixo nomeia um papel, é uma pessoa
                determinada que o exerce — não há um time de segurança a quem delegar. Preferimos
                declarar isso a escrever uma estrutura que não existe.
              </p>
            </div>
          </div>
        </section>

        {/* Classificação */}
        <section id="classificacao">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Classificação da informação</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            A regra de manuseio muda conforme a classe. Dado recebido de uma plataforma de
            comércio — pedidos, contato do comprador, endereço de entrega — é classificado no
            mínimo como <strong>Confidencial</strong>.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Classe</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Exemplos</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Regra de manuseio</th>
                </tr>
              </thead>
              <tbody>
                {CLASSES.map(c => (
                  <tr key={c.classe} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-4 py-3 font-bold text-gray-900 whitespace-nowrap">{c.classe}</td>
                    <td className="px-4 py-3 text-gray-600">{c.exemplos}</td>
                    <td className="px-4 py-3 text-gray-600">{c.regra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Os controles em vigor */}
        {CONTROLES.map(bloco => (
          <section key={bloco.id} id={bloco.id}>
            <h2 className="text-2xl font-black text-gray-900 mb-4">{bloco.titulo}</h2>
            <ul className="space-y-3">
              {bloco.itens.map((item, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-emerald-600 mt-0.5 flex-shrink-0">✓</span>
                  <span className="text-gray-600 leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Cabeçalhos: é a evidência que qualquer avaliador confere sozinho,
            sem acesso ao código — basta abrir o site e olhar a resposta. */}
        <section id="cabecalhos">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Cabeçalhos de resposta</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Aplicados a todas as rotas. Diferente do resto desta página, estes você confere sozinho
            sem acesso nenhum ao nosso código — basta inspecionar a resposta do servidor. O
            identificador da tecnologia do servidor é suprimido.
          </p>
          <div className="rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {CABECALHOS.map(([nome, oQueFaz]) => (
              <div key={nome} className="px-5 py-3.5">
                <code className="text-xs font-mono text-gray-900 break-all">{nome}</code>
                <p className="text-sm text-gray-500 mt-1">{oQueFaz}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Vulnerabilidades */}
        <section id="vulnerabilidades">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Vulnerabilidades e correções</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Avisos de segurança das dependências são revisados pelo menos <strong>mensalmente</strong>.
            Os prazos abaixo contam a partir do momento em que a correção está disponível. A
            aplicação de correções na plataforma de execução e no motor do banco é feita pelos
            respectivos provedores gerenciados.
          </p>
          <div className="overflow-hidden rounded-2xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Severidade</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Prazo de correção</th>
                </tr>
              </thead>
              <tbody>
                {PRAZOS.map(([sev, prazo]) => (
                  <tr key={sev} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900">{sev}</td>
                    <td className="px-4 py-3 text-gray-600">{prazo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Incidentes */}
        <section id="incidentes">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Resposta a incidentes</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Incidente é qualquer acesso não autorizado, divulgação, alteração ou perda de dado —
            suspeitos ou confirmados — e qualquer comprometimento de credencial. Quem suspeita
            relata imediatamente ao responsável pela segurança. <strong>Não há punição para alarme
            falso; há para o silêncio.</strong>
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Fase</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Ação</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {INCIDENTE.map(([fase, acao, prazo]) => (
                  <tr key={fase} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{fase}</td>
                    <td className="px-4 py-3 text-gray-600">{acao}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{prazo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Declarado abertamente, e não escondido: é mais fraco do que rotação
              incondicional, e descrever aspiração não vale nada para quem
              depende da informação. */}
          <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <p className="font-bold text-gray-900 mb-2">Sobre troca de credencial exposta</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              A conduta é avaliação por risco, não regra cega. Pesa-se o dano que um atacante
              causaria com aquela credencial específica contra o custo operacional de trocá-la.
              Credencial capaz de produzir documento com efeito legal em nome da empresa — o token
              de emissão fiscal acima de tudo — é trocada sem discussão. Para credencial cujo pior
              caso é comercial e não jurídico, o responsável registra a decisão, o raciocínio e o
              controle compensatório.{' '}
              <strong>
                Declaramos que isso é mais fraco que a troca incondicional.
              </strong>{' '}
              Está escrito assim porque é o que fazemos, e uma política que descreve intenção não
              serve a quem depende dela.
            </p>
          </div>
        </section>

        {/* Backup */}
        <section id="backup">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Cópias de segurança e continuidade</h2>
          <ul className="space-y-3">
            {[
              'O provedor do banco gerenciado executa cópias automáticas na periodicidade do plano contratado, com recuperação a ponto no tempo onde disponível.',
              'A capacidade de restauração é testada pelo menos anualmente, e o teste é registrado.',
              'Objetivos de recuperação: até 24 horas de dado (RPO) e até 24 horas para retomar o serviço (RTO).',
              'Os terminais de PDV operam contra banco local e continuam vendendo durante queda de conexão, sincronizando quando ela volta.',
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-emerald-600 mt-0.5 flex-shrink-0">✓</span>
                <span className="text-gray-600 leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Fornecedores */}
        <section id="fornecedores">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Fornecedores de infraestrutura</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Serviços que tratam dado por nossa conta. Nomeamos o fornecedor onde ele já é visível
            ao cliente; hospedagem e banco entram por função, e a lista nominal completa está
            disponível a quem solicitar por escrito. Antes de contratar qualquer novo operador,
            confirmamos que ele oferece criptografia em trânsito e em repouso, controle de acesso
            documentado e compromisso de notificação de incidente.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Função</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Para quê</th>
                  <th className="text-left font-bold text-gray-700 px-4 py-3">Que dado recebe</th>
                </tr>
              </thead>
              <tbody>
                {FORNECEDORES.map(([f, p, d]) => (
                  <tr key={f} className="border-b border-gray-100 last:border-0 align-top">
                    <td className="px-4 py-3 font-medium text-gray-900">{f}</td>
                    <td className="px-4 py-3 text-gray-600">{p}</td>
                    <td className="px-4 py-3 text-gray-600">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Retenção */}
        <section id="retencao">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Retenção e exclusão</h2>
          <ul className="space-y-3">
            {[
              'Registros de negócio da empresa contratante são mantidos enquanto a conta estiver ativa, e pelo prazo que a legislação tributária e comercial brasileira exigir depois disso.',
              'Dado recebido de uma plataforma de comércio é mantido apenas enquanto necessário para cumprir os pedidos da empresa e atender obrigação legal de guarda.',
              'No encerramento de uma integração, ou a pedido da plataforma, todas as credenciais daquela plataforma são revogadas e apagadas, e o dado recebido dela é excluído em até 30 dias — exceto registros que a lei obrigue a guardar, que ficam isolados e sem tratamento posterior.',
              'Pedidos de exclusão de titulares sob a LGPD são atendidos no prazo legal.',
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-emerald-600 mt-0.5 flex-shrink-0">✓</span>
                <span className="text-gray-600 leading-relaxed">{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Compromissos com a plataforma — a seção que um parceiro de comércio
            lê antes de qualquer outra. */}
        <section id="plataformas">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Compromissos sobre dados de plataformas</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Sobre o dado recebido de qualquer plataforma de comércio com a qual integramos:
          </p>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <ul className="space-y-2.5">
              {COMPROMISSOS.map((c, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-emerald-700 mt-0.5 flex-shrink-0">✓</span>
                  <span className="text-sm text-emerald-900 leading-relaxed">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* O que falta */}
        <section id="construindo">
          <h2 className="text-2xl font-black text-gray-900 mb-4">O que ainda estamos construindo</h2>
          <p className="text-gray-600 leading-relaxed mb-5">
            Segurança não tem linha de chegada. Tudo acima está em vigor hoje; o que está abaixo
            não está, e por isso aparece separado, com data. Preferimos declarar a lacuna a deixar
            subentendido que está tudo pronto.
          </p>
          <div className="overflow-hidden rounded-2xl border border-amber-200">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 border-b border-amber-200">
                <tr>
                  <th className="text-left font-bold text-amber-900 px-4 py-3">Item</th>
                  <th className="text-left font-bold text-amber-900 px-4 py-3 whitespace-nowrap">Prazo</th>
                </tr>
              </thead>
              <tbody className="bg-amber-50/40">
                {CONSTRUINDO.map(([item, prazo]) => (
                  <tr key={item} className="border-b border-amber-100 last:border-0 align-top">
                    <td className="px-4 py-3 text-amber-900">{item}</td>
                    <td className="px-4 py-3 text-amber-900 font-medium whitespace-nowrap">{prazo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Contato */}
        <section id="contato">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Contato de segurança</h2>
          <div className="rounded-2xl border border-gray-200 p-6">
            <div className="space-y-2 text-sm">
              <p className="text-gray-900">
                <strong>Responsável pela segurança da informação:</strong> {RESPONSAVEL}
              </p>
              <p className="text-gray-900">
                <strong>E-mail:</strong>{' '}
                <a href="mailto:security@sistemavargas.com.br" className="text-blue-600 hover:underline">
                  security@sistemavargas.com.br
                </a>
              </p>
              <p className="text-gray-900">
                <strong>Razão social:</strong> Ouro e Prata Elétrica — CNPJ 43.103.402/0001-24
              </p>
            </div>
            <p className="text-xs text-gray-500 mt-5 leading-relaxed">
              Suspeita de vulnerabilidade ou de incidente pode ser relatada por este endereço.
              Respondemos ao relato e informamos o desfecho a quem relatou. Para assuntos de dados
              pessoais e direitos do titular, veja a{' '}
              <Link href="/privacidade" className="text-blue-600 hover:underline">
                Política de Privacidade
              </Link>.
            </p>
          </div>
        </section>

        {/* Resumo em inglês. O revisor de uma plataforma internacional abre
            esta página antes de ler o anexo, e a página inteira em português
            faz a verificação depender de tradução automática. */}
        <section id="english">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Summary for platform reviewers</h2>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
            <p>
              This is the Information Security Policy of <strong>Ouro e Prata Elétrica</strong>{' '}
              (CNPJ 43.103.402/0001-24), operator of Sistema Vargas, a multi-tenant ERP and
              point-of-sale platform. It is a separate document from our Privacy Policy.
            </p>
            <p>
              <strong>Controls in force:</strong> role-based access control with six fixed roles and
              server-side enforcement; tenant isolation enforced both in the application and by row
              level security in the database; TLS 1.2+ in transit with HSTS, AES-256 at rest
              including backups; secrets held in the hosting provider&apos;s encrypted configuration
              store, excluded from source control and from logs; immutable audit trail of privileged
              actions retained for 12 months; append-only stock ledger; monthly dependency review
              with 7/30/90-day remediation targets; documented incident response with{' '}
              <strong>platform notification within 24 hours</strong> of confirming platform data or
              credentials are affected; automated backups with RPO and RTO of 24 hours.
            </p>
            <p>
              <strong>Platform data:</strong> used solely to deliver order, stock and accounting
              functions inside the merchant&apos;s own account. Never sold, rented, licensed or
              shared beyond the listed processors. Never used for advertising, audience building or
              machine-learning training. Deleted within 30 days of integration termination or on the
              platform&apos;s request, except records required by Brazilian law.
            </p>
            <p>
              <strong>Stated gaps:</strong> mandatory MFA on all administrative accounts is being
              rolled out; server-side permission checks are being extended to all routes and a full
              Content-Security-Policy is planned, both by 31 October 2026; independent penetration
              testing is available on request as a condition of approval. We list these openly
              rather than imply completeness.
            </p>
            <p className="text-gray-500">
              Security contact: security@sistemavargas.com.br — {RESPONSAVEL}, Information Security
              Officer. The full signed policy is available in English on request.
            </p>
          </div>
        </section>

        {/* Vigência */}
        <section id="vigencia">
          <h2 className="text-2xl font-black text-gray-900 mb-4">Vigência e revisão</h2>
          <p className="text-gray-600 leading-relaxed">
            Versão {VERSAO}, em vigor desde {VIGENCIA}. Revisada pelo menos uma vez por ano e após
            qualquer incidente de severidade 1, pelo responsável pela segurança. O descumprimento
            desta política pode resultar em retirada imediata de acesso e encerramento do vínculo.
          </p>
        </section>
      </div>

      {/* Rodapé */}
      <footer className="border-t border-gray-100 mt-8">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">© 2026 Sistema Vargas ERP</p>
          <div className="flex items-center gap-4">
            <Link href="/privacidade" className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
              Privacidade
            </Link>
            <Link href="/" className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
              Voltar ao site →
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
