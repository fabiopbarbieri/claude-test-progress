# Compatibilidade e evidências

[Início](../README.md) · [Uso](USAGE.md) · [Diagnóstico](TROUBLESHOOTING.md)

Referência conferida em **2026-10-04**: versão **0.1.0**, SHA
[`cc9c0aa710fa80d123c00856ec277b8f04741544`](https://github.com/fabiopbarbieri/claude-test-progress/tree/cc9c0aa710fa80d123c00856ec277b8f04741544).
Requisito declarado é o contrato pretendido; versão testada é uma combinação
concreta. Nenhuma linha implica que todas as combinações entre versões e sistemas
operacionais foram exercitadas. Confira a CI do SHA que pretende instalar.

## Base e sistemas operacionais

| Componente / sistema | Requisito declarado ou caminho implementado | Evidência disponível | Limite |
| --- | --- | --- | --- |
| Claude Code | 2.1.287+, com Mods permitido | Claude 2.1.289 em Linux: instalação isolada, paths, demo e consultas headless em [VERIFICATION](VERIFICATION.md); versão mínima em [launch.sh](../launch.sh) e [launch.ps1](../launch.ps1) | Não prova todas as versões posteriores nem aceite visual interativo |
| Coletor e demo | Node >=14.0.0; sem dependências npm | [package.json](../package.json); CI Quality em Node 14.0.0 e 24 | Não exige um framework de testes global; Node do app é independente |
| Linux | Bash; GNU `sort -V` para descoberta nvm; recuperação de processos por `/proc` | Quality e Ruby em `ubuntu-latest`; Rails em `ubuntu-24.04`; uso local descrito em VERIFICATION | Não é uma matriz de todas as distribuições Linux |
| WSL | Claude, Bash, Node e toolchain executados dentro do WSL, pelo caminho Linux | Roteamento em [hooks/register.mjs](../hooks/register.mjs) e descoberta em [runtime](../runtime/resolve-node.sh) | Sem aceite WSL próprio; não misture executáveis Windows com recuperação Linux |
| Windows nativo | Windows 10/11 ou Server 2019+ como alvos; PowerShell 5.1/7 e Node 14+ | Scripts e Job Objects implementados; [guia Windows](../WINDOWS.md) e [host nativo](../runtime/WindowsProcessHost.cs) | Aceite operacional pendente: nenhum job Windows nos workflows de referência |
| macOS | Sem suporte operacional declarado nesta matriz | Caminho Bash não basta para provar funcionamento | Descoberta usa ferramentas GNU e recuperação depende de evidência Linux; sem aceite nativo |

A evidência de Claude 2.1.289 é o registro de validação local da versão 0.1.0;
os workflows atuais não instalam Claude. A capa do README é ilustrativa e não
constitui captura ou aceite da interface.

## Adaptadores e runtimes do app

Todas as combinações de CI abaixo rodam em **Linux**. Windows/WSL/macOS não
herdam esse aceite. Os links de CI ao final fixam o SHA de referência.

| Integração | Requisito declarado | Versões exercitadas / evidência | Funcionalidades não comprovadas ou fora do contrato |
| --- | --- | --- | --- |
| [Python / pytest](../adapters/python/README.md) | Python 3.8+, pytest 7+ do app | Quality: Python 3.8 / pytest 8.3.5 / Node 14.0.0; Python 3.14 / pytest 9.1.1 / Node 24 | Pytest 7 não está na CI; serial, xdist recusado; plugins que substituem protocolo exigem aceite próprio |
| [Python / unittest](../adapters/python/README.md) | Python 3.8+, biblioteca padrão | Mesmas combinações Python/Node do Quality; cenários temporários de sucesso, falha, skip e cancelamento | Não prova runners distribuídos ou todo projeto unittest real |
| [Ruby / RSpec](../adapters/ruby/README.md) | Ruby 3.1+, RSpec Core 3.13.x no ambiente do app | Ruby 3.1, 3.4 e 4.0; rspec-core 3.13.6, metagem rspec 3.13.2 e rspec-retry 0.6.2; Node 24 | Serial e finito; watch, DRb, bisect e runners paralelos fora do contrato |
| [Rails / Minitest](../adapters/rails/README.md) | Rails 7.2/8.0/8.1; Minitest >=5.20 e <6; Ruby compatível com o Rails escolhido | Rails 7.2.4 / Ruby 3.3 / Minitest 5.20.0; Rails 8.0.5.1 e 8.1.4 / Ruby 3.4 / Minitest 5.25.4; Node 24 | Minitest 6 recusado; fixtures views/system usam `rack_test`, não navegador Selenium/JavaScript |
| [JUnit 5](../adapters/junit/README.md) | JDK 11+ para compilar; Platform 1.11.3 no build de referência; engine/launcher compatíveis no app | [pom.xml](../adapters/junit/pom.xml), listener e registro de serviços; compilação/empacotamento registrados em VERIFICATION | **Sem integração real JUnit na CI atual**; Surefire, forks, módulos e Vintage sem aceite operacional |
| [Karma](../adapters/karma/README.md) | App com Karma, reporter CommonJS e browser configurado; runtime Node compatível com o app | Contratos revisados de Karma 4.3.0/4.4.1 e 5.0.0/5.2.3 no guia; sintaxe conferida no Quality | **Navegador real pendente**; contratos não são execução de Karma/Angular de ponta a ponta |
| Fallback Maven / Karma | Logs nos formatos reconhecidos pelo [parser](../runner/progress.mjs) | Implementação de `maven` no backend e `karma` no frontend | Formato de log pode variar; não garante a precisão dos eventos; Maven conserva total desconhecido durante execução |

Instalar Selenium WebDriver como dependência da fixture Rails **não** comprova
que o browser rodou. O [gate Rails](../scripts/check-rails.py) usa Capybara
`rack_test`; paralelismo Rails nativo por processos/threads é exercitado, mas
paralelismo de terceiros e retry/watch não ganham aceite por isso.

Angular não determina sozinho o runner. O guia de [Angular 9](../ANGULAR9.md)
separa Node 10/12 histórico do app e Node 14+ do coletor. O reporter só se aplica
se o target realmente usar Karma. Angular 18, Jest, Vitest ou uma linguagem
nova não devem ser tratados como automaticamente integrados.

## Áreas de execução e dependências

`backend` e `frontend` são áreas do painel. A área frontend **sempre prepara
Node/.nvmrc** no código atual; não é um executor agnóstico de linguagem.
Rails views/system, Python e RSpec devem usar backend. Um comando somente backend
ignora a configuração frontend. `all` requer ambas e faz o preflight das duas.
Veja [cli.mjs](../runner/cli.mjs) e [frontend-runtime.mjs](../runner/frontend-runtime.mjs).

| Quem precisa | Dependências |
| --- | --- |
| Usuário do core/demo | Claude Code, Node 14+ do coletor e ferramentas do sistema descritas acima |
| Usuário de uma suíte | Apenas runtime, runner, bibliotecas e browser exigidos pela suíte escolhida, já disponíveis no app |
| Desenvolvimento / gates | `scripts/check.py` usa Python 3.8+, Node, Bash e Git; `--smoke` também usa unittest; `--pytest` requer pytest nesse Python |
| Gates opcionais | Ruby/RSpec/retry para `check-ruby.py`; Rails/Minitest/Capybara e dependências da fixture para `check-rails.py`; JDK/Maven ou curl para build JUnit; Claude para o test kit; Gitleaks para segredos |

Essas dependências de verificação não são requisitos globais de instalação do
mod. O plugin não instala frameworks no computador do usuário. Quem verifica
uma integração deve usar um ambiente isolado com as ferramentas dessa suíte.

## Evidência de CI no SHA de referência

Execuções concluídas com sucesso, consultadas em 2026-10-04:

| Workflow / definição | Execução | Jobs observados |
| --- | --- | --- |
| [Quality](../.github/workflows/quality.yml) | [37249154312](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37249154312) | 2 combinações Node/Python e scanner de árvore/histórico |
| [Ruby adapter](../.github/workflows/ruby.yml) | [37249154357](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37249154357) | Ruby 3.1, 3.4 e 4.0 |
| [Rails adapter](../.github/workflows/rails.yml) | [37249154364](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37249154364) | As 3 combinações Rails/Ruby/Minitest da tabela |

Definições podem mudar depois desse SHA; uma matriz configurada não é, por si,
prova de aprovação. Os registros [geral](VERIFICATION.md) e
[Rails](../adapters/rails/VALIDATION.md) detalham cenários e amostras locais.
