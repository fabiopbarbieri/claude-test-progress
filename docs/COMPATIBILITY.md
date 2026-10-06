# Compatibilidade

[Início](../README.md) · [Uso](USAGE.md) · [Diagnóstico](TROUBLESHOOTING.md)

Matriz da versão **0.3.0**. Requisito declarado é o contrato pretendido; versão
testada é uma combinação concreta exercitada na CI ou localmente. Nenhuma linha
implica que todas as combinações entre versões e sistemas foram exercitadas.
Confira a CI do commit que instalar; resultados e limites em [VALIDATION](VALIDATION.md).

## Contrato

O cadastro usa `schemaVersion: 1`, com zero ou vários módulos de IDs seguros e
registry opcional de templates com o mesmo schema. Somente o workspace ativa
módulos. `inherit` preserva o ambiente sem descobrir Node do app; `node-project`
prepara Node/.nvmrc no preflight selecionado. ID e linguagem não escolhem runtime
nem adapter. `/test-progress start/list/status/logs/cancel` usa IDs ou `all`; a CLI
usa `--module` e o bootstrap PowerShell, `-Module`. Estado incompatível ou
ilegível no namespace bloqueia novos starts até ser resolvido.

## Base e sistemas operacionais

| Componente / sistema | Requisito ou caminho | Testado | Limite |
| --- | --- | --- | --- |
| Claude Code | 2.1.287+, com Mods permitido ([launch.sh](../launch.sh), [launch.ps1](../launch.ps1)) | Test kit do Mod na CI com 2.1.289; painel e faixa em sessão real com 2.1.290 no Linux | Não prova todas as versões posteriores nem o Claude Desktop |
| Coletor | Node >=14.0.0, sem dependências npm | CI com Node 14.0.0 e 24 | O Node do app é independente |
| Linux | Bash; GNU `sort -V` para descoberta nvm; recuperação por `/proc` | Todos os workflows em `ubuntu-24.04` | Não é uma matriz de distribuições |
| WSL | Caminho Linux quando Claude e toolchain rodam dentro do WSL | Roteamento em [hooks/register.mjs](../hooks/register.mjs) | Sem aceite próprio; não misture executáveis Windows com a recuperação Linux |
| Windows | Windows 10/11 ou Server 2019+; PowerShell 5.1/7; Job Objects | [Matriz](../.github/workflows/windows.yml) PowerShell 5.1/7 × coletor Node 14.0.0/24, app Node 12.22.12, na CI hospedada | Sem aceite registrado numa máquina Windows real; veja [WINDOWS](../WINDOWS.md) |
| macOS | Sem suporte operacional declarado | — | Descoberta usa ferramentas GNU; recuperação depende de evidência Linux |

O sidecar de prova Windows tem formato próprio (`schema: 1`), independente do
`schemaVersion` do cadastro. A capa do README é ilustrativa.

## Adapters e runtimes do app

| Integração | Requisito declarado | Testado na CI | Fora do contrato ou sem aceite |
| --- | --- | --- | --- |
| [Python / pytest](../adapters/python/README.md) | Python 3.8+, pytest 7+ do app | Python 3.8 / pytest 8.3.5 / Node 14.0.0; Python 3.14 / pytest 9.1.1 / Node 24 | pytest 7 não está na CI; serial, xdist recusado |
| [Python / unittest](../adapters/python/README.md) | Python 3.8+, biblioteca padrão | Mesmas combinações; sucesso, falha, skip e cancelamento | Runners distribuídos |
| [Ruby / RSpec](../adapters/ruby/README.md) | Ruby 3.1+, RSpec Core 3.13.x | Ruby 3.1, 3.4 e 4.0; rspec-core 3.13.6, rspec 3.13.2, rspec-retry 0.6.2 | Watch, DRb, bisect e runners paralelos |
| [Rails / Minitest](../adapters/rails/README.md) | Rails 7.2/8.0/8.1; Minitest >=5.20 e <6 | Rails 7.2.4 / Ruby 3.3 / Minitest 5.20.0; Rails 8.0.5.1 e 8.1.4 / Ruby 3.4 / Minitest 5.27.0 | Minitest 6; views/system usam `rack_test`, sem Selenium |
| [JUnit 5](../adapters/junit/README.md) | Java 17+; JUnit 5.14+ (Platform 1.14+) no app | JUnit 5.14.4 / Platform 1.14.4 / Surefire 3.6.0 com Java 17 e 21 | Gradle, reactor multimódulo, Vintage, engines de terceiros e queda da JVM |
| [Karma](../adapters/karma/README.md) | App com Karma, reporter CommonJS e browser | Angular 9.1.13 / Karma 5.2.3 (app Node 12.22.12) e Angular 18.2.14 / Karma 6.4.4 (app Node 22), Chrome headless | Watch, vários browsers e Windows nativo |
| Fallback Maven / Karma | Logs nos formatos do [parser](../runner/progress.mjs) | Parser Maven exercitado no Quality | Formatos variam; Maven mantém total desconhecido durante a execução |

Instalar Selenium WebDriver como dependência da fixture Rails **não** comprova
que o browser rodou. O [gate Rails](../scripts/check-rails.py) usa Capybara
`rack_test`; paralelismo Rails nativo por processos/threads é exercitado, mas
paralelismo de terceiros e retry/watch não ganham aceite por isso.

Angular não determina sozinho o runner. O guia de [Angular 9](../ANGULAR9.md)
separa o Node 10/12 do app e Node 14+ do coletor. O reporter só se aplica
se o target realmente usar Karma. Jest, Vitest ou uma linguagem nova não devem
ser tratados como automaticamente integrados.

## Dependências

| Quem precisa | Dependências |
| --- | --- |
| Usuário do core | Claude Code, Node 14+ do coletor e ferramentas do sistema descritas acima |
| Usuário de uma suíte | Apenas runtime, runner, bibliotecas e browser exigidos pela suíte escolhida, já disponíveis no app |
| Desenvolvimento / gates | `scripts/check.py` usa Python 3.8+, Node, Bash e Git; `--smoke` também usa unittest; `--pytest` requer pytest nesse Python |
| Gates opcionais | Ruby/RSpec/retry para `check-ruby.py`; Rails/Minitest/Capybara e dependências da fixture para `check-rails.py`; JDK/Maven ou curl para build JUnit; Claude para o test kit; Gitleaks para segredos |

Essas dependências de verificação não são requisitos globais de instalação do
mod. O plugin não instala frameworks no computador do usuário. Quem verifica
uma integração deve usar um ambiente isolado com as ferramentas dessa suíte.
