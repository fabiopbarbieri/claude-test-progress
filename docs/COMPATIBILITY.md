# Compatibilidade e evidências

[Início](../README.md) · [Uso](USAGE.md) · [Diagnóstico](TROUBLESHOOTING.md)

Referência **histórica**, conferida em **2026-10-04**: versão **0.1.0**, SHA
[`cc9c0aa710fa80d123c00856ec277b8f04741544`](https://github.com/fabiopbarbieri/claude-test-progress/tree/cc9c0aa710fa80d123c00856ec277b8f04741544).
Requisito declarado é o contrato pretendido; versão testada é uma combinação
concreta. Nenhuma linha implica que todas as combinações entre versões e sistemas
operacionais foram exercitadas. Esses resultados pertencem ao artefato legado
desse SHA, sem comprovar o runtime v2 deste checkout. Não houve nova consulta
a essas execuções durante esta atualização. Confira a CI do SHA que instalar.

## Contrato atual v2

Versão **0.1.0**, licença MIT, plugin `test-progress` e pacote
`claude-test-progress` mantidos. O produto aceita somente schemaVersion 2,
zero ou vários módulos com IDs seguros e registry opcional de templates também
v2. Somente o workspace ativa módulos. Não há demo, `--lane`, aliases de início,
fallback/conversão de configuração ou gerenciamento de jobs v1.

`inherit` preserva o ambiente sem descobrir Node do app; `node-project` prepara
Node/.nvmrc no preflight selecionado. ID e linguagem não escolhem runtime ou
adapter. `/test-progress start/list/status/logs/cancel` usa IDs ou `all`; CLI usa
`--module`, bootstrap PowerShell `-Module`. [USAGE](USAGE.md) detalha seleção,
barreira, templates e adoção quiescente. Estado legado bloqueia novos starts
globalmente; encerre jobs antigos usando o artefato que os iniciou.

| Alvo ou gate v2 | Evidência nesta entrega | Limite |
| --- | --- | --- |
| Coletor Node >=14.0.0 | Gates completos `check.py --smoke --pytest` passaram com Node 14.0.0 e 24.20.0; cadastro também exercitado com Node 26.7.0 | Não cobre todas as combinações de runtimes |
| Linux | Núcleo, supervisor, árvores, rollback e adaptadores reais passaram; resultados em [VALIDATION](VALIDATION.md) | Não equivale a todas as distribuições |
| WSL | Usa o caminho Linux quando Claude/toolchain rodam dentro dele | Sem aceite próprio; não misture recuperação `/proc` e processos Windows |
| Windows | [Gate nativo](../scripts/check-windows.ps1), [cenários](../tests/windows/native.mjs) e [matriz configurada](../.github/workflows/windows.yml) | **Não executados nativamente/CI nesta entrega**; parsing/Linux não comprova DACL ou Job Objects |
| Matriz Windows planejada | PowerShell 5.1/7 × coletor Node 14.0.0/24; app Node 12.22.12 | Configuração é intenção de cobertura, sem resultado aprovado |
| Claude CLI 2.1.289 | 28 testes do Mod e painel real fullscreen com teclado, estados e scroll; capturas em [VALIDATION](VALIDATION.md) | Não comprova Claude Desktop nem conversa real retomada por `/resume` |
| Claude Desktop | Árvores e callbacks testados no test kit | Aceite visual e teclado no aplicativo real pendentes |
| macOS | Sem suporte operacional declarado | Recuperação depende de evidência Linux; sem aceite nativo |

O proof sidecar Windows mantém seu `schema: 1` próprio. Isso não é schema de
cadastro, estado ou envelope CLI. DACL privada, Job Object e prova de árvore
vazia permanecem no contrato de contenção; veja [WINDOWS](../WINDOWS.md).

## Histórico: base e sistemas operacionais

A tabela seguinte descreve somente o SHA de referência legado.


| Componente / sistema | Requisito declarado ou caminho implementado | Evidência disponível | Limite |
| --- | --- | --- | --- |
| Claude Code | 2.1.287+, com Mods permitido | Claude 2.1.289 em Linux: instalação isolada, paths, demo e consultas headless em [VERIFICATION](VERIFICATION.md); versão mínima em [launch.sh](../launch.sh) e [launch.ps1](../launch.ps1) | Não prova todas as versões posteriores nem aceite visual interativo |
| Coletor e demo legados | Node >=14.0.0; sem dependências npm | [package.json](../package.json); CI Quality em Node 14.0.0 e 24 | Não exige um framework de testes global; Node do app é independente |
| Linux | Bash; GNU `sort -V` para descoberta nvm; recuperação de processos por `/proc` | Quality e Ruby em `ubuntu-latest`; Rails em `ubuntu-24.04`; uso local descrito em VERIFICATION | Não é uma matriz de todas as distribuições Linux |
| WSL | Claude, Bash, Node e toolchain executados dentro do WSL, pelo caminho Linux | Roteamento em [hooks/register.mjs](../hooks/register.mjs) e descoberta em [runtime](../runtime/resolve-node.sh) | Sem aceite WSL próprio; não misture executáveis Windows com recuperação Linux |
| Windows nativo | Windows 10/11 ou Server 2019+ como alvos; PowerShell 5.1/7 e Node 14+ | Scripts e Job Objects implementados; [guia Windows](../WINDOWS.md) e [host nativo](../runtime/WindowsProcessHost.cs) | Aceite operacional pendente: nenhum job Windows nos workflows de referência |
| macOS | Sem suporte operacional declarado nesta matriz | Caminho Bash não basta para provar funcionamento | Descoberta usa ferramentas GNU e recuperação depende de evidência Linux; sem aceite nativo |

A evidência de Claude 2.1.289 é o registro local do SHA legado acima;
a CI desse SHA não comprova uma sessão Claude no produto v2. A capa do README é ilustrativa e não
constitui captura ou aceite da interface.

## Histórico: adapters e runtimes do app

As combinações de CI registradas abaixo pertencem ao SHA legado e rodam em **Linux**. Windows/WSL/macOS não
herdam esse aceite. Os links de CI ao final fixam o SHA de referência.

| Integração | Requisito declarado | Versões exercitadas / evidência | Funcionalidades não comprovadas ou fora do contrato |
| --- | --- | --- | --- |
| [Python / pytest](../adapters/python/README.md) | Python 3.8+, pytest 7+ do app | Quality: Python 3.8 / pytest 8.3.5 / Node 14.0.0; Python 3.14 / pytest 9.1.1 / Node 24 | Pytest 7 não está na CI; serial, xdist recusado; plugins que substituem protocolo exigem aceite próprio |
| [Python / unittest](../adapters/python/README.md) | Python 3.8+, biblioteca padrão | Mesmas combinações Python/Node do Quality; cenários temporários de sucesso, falha, skip e cancelamento | Não prova runners distribuídos ou todo projeto unittest real |
| [Ruby / RSpec](../adapters/ruby/README.md) | Ruby 3.1+, RSpec Core 3.13.x no ambiente do app | Ruby 3.1, 3.4 e 4.0; rspec-core 3.13.6, metagem rspec 3.13.2 e rspec-retry 0.6.2; Node 24 | Serial e finito; watch, DRb, bisect e runners paralelos fora do contrato |
| [Rails / Minitest](../adapters/rails/README.md) | Rails 7.2/8.0/8.1; Minitest >=5.20 e <6; Ruby compatível com o Rails escolhido | Rails 7.2.4 / Ruby 3.3 / Minitest 5.20.0; Rails 8.0.5.1 e 8.1.4 / Ruby 3.4 / Minitest 5.25.4; Node 24 | Minitest 6 recusado; fixtures views/system usam `rack_test`, não navegador Selenium/JavaScript |
| [JUnit 5](../adapters/junit/README.md) | JDK 11+ para compilar; Platform 1.11.3 no build de referência; engine/launcher compatíveis no app | [pom.xml](../adapters/junit/pom.xml), listener e registro de serviços; compilação/empacotamento registrados em VERIFICATION | **Sem integração real JUnit na CI de referência**; Surefire, forks, módulos e Vintage sem aceite operacional |
| [Karma](../adapters/karma/README.md) | App com Karma, reporter CommonJS e browser configurado; runtime Node compatível com o app | Contratos revisados de Karma 4.3.0/4.4.1 e 5.0.0/5.2.3 no guia; sintaxe conferida no Quality | **Navegador real não comprovado por esse registro**; contratos não são execução de Karma/Angular de ponta a ponta |
| Fallback Maven / Karma | Logs nos formatos reconhecidos pelo [parser](../runner/progress.mjs) | Fallbacks do artefato legado para Maven e Karma | Formato de log pode variar; não garante a precisão dos eventos; Maven conserva total desconhecido durante execução |

Instalar Selenium WebDriver como dependência da fixture Rails **não** comprova
que o browser rodou. O [gate Rails](../scripts/check-rails.py) usa Capybara
`rack_test`; paralelismo Rails nativo por processos/threads é exercitado, mas
paralelismo de terceiros e retry/watch não ganham aceite por isso.

Angular não determina sozinho o runner. O guia de [Angular 9](../ANGULAR9.md)
separa Node 10/12 histórico do app e Node 14+ do coletor. O reporter só se aplica
se o target realmente usar Karma. Angular 18, Jest, Vitest ou uma linguagem
nova não devem ser tratados como automaticamente integrados.

## Módulos e dependências do produto v2

IDs `backend` e `frontend` são nomes comuns possíveis, sem semântica de runtime.
Rails views/system, Python e RSpec normalmente usam `inherit`; Karma pode usar
`node-project`. Vários módulos da mesma linguagem permanecem independentes.
`start all` faz preflight de todos os habilitados e só libera a barreira após a
preparação conjunta. Não exige duas áreas fixas. Status/logs/cancel v2 continuam
úteis mesmo com módulo removido ou cadastro inválido. Veja
[module-config](../runner/module-config.mjs) e [CLI](../runner/cli.mjs).

| Quem precisa | Dependências |
| --- | --- |
| Usuário do core | Claude Code, Node 14+ do coletor e ferramentas do sistema descritas acima |
| Usuário de uma suíte | Apenas runtime, runner, bibliotecas e browser exigidos pela suíte escolhida, já disponíveis no app |
| Desenvolvimento / gates | `scripts/check.py` usa Python 3.8+, Node, Bash e Git; `--smoke` também usa unittest; `--pytest` requer pytest nesse Python |
| Gates opcionais | Ruby/RSpec/retry para `check-ruby.py`; Rails/Minitest/Capybara e dependências da fixture para `check-rails.py`; JDK/Maven ou curl para build JUnit; Claude para o test kit; Gitleaks para segredos |

Essas dependências de verificação não são requisitos globais de instalação do
mod. O plugin não instala frameworks no computador do usuário. Quem verifica
uma integração deve usar um ambiente isolado com as ferramentas dessa suíte.

## Histórico: CI no SHA de referência

Execuções registradas como concluídas com sucesso e consultadas em 2026-10-04,
para o SHA legado acima; não são resultados do runtime v2:

| Workflow / definição | Execução | Jobs observados |
| --- | --- | --- |
| [Quality](../.github/workflows/quality.yml) | [37249154312](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37249154312) | 2 combinações Node/Python e scanner de árvore/histórico |
| [Ruby adapter](../.github/workflows/ruby.yml) | [37249154357](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37249154357) | Ruby 3.1, 3.4 e 4.0 |
| [Rails adapter](../.github/workflows/rails.yml) | [37249154364](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37249154364) | As 3 combinações Rails/Ruby/Minitest da tabela |

Os links de definição abaixo apontam ao checkout atual e podem diferir do SHA; uma matriz configurada não é, por si,
prova de aprovação. Os registros [geral](VERIFICATION.md) e
[Rails](../adapters/rails/VALIDATION.md) detalham cenários e amostras locais.
