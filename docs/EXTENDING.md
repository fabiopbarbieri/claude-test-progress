# Acrescentar runners

Avaliação de **2026-10-04**. As propostas abaixo não são compromisso de roadmap
nem anúncio de suporte. A análise inspecionou código e fontes primárias; não
executou os runners candidatos.

## O que existe hoje

[Rails/Minitest](../adapters/rails/README.md) tem integração própria para
`test`, `test:system` e `test:all`, com contadores ao vivo e total desconhecido
até a conclusão. Inclui testes Ruby de backend, views e system; os limites
observados estão em [VALIDATION](../adapters/rails/VALIDATION.md).

Há integrações para [JUnit 5/Maven](../adapters/junit/README.md),
[Karma](../adapters/karma/README.md) e
[pytest/unittest](../adapters/python/README.md). Pytest é serial; pytest-xdist
não é suportado. Os fallbacks de logs reconhecem somente Maven e Karma.

A extensão é por **runner**, não por linguagem: Jest e Vitest precisam de
adaptadores distintos, embora ambos executem JavaScript/TypeScript. Configurar
um comando novo não acrescenta reconhecimento de progresso.

## Caminho mínimo

O [protocolo](../adapters/README.md) aceita linhas `@@TEST_PROGRESS@@` com
snapshots JSON cumulativos. O [coletor](../runner/progress.mjs) substitui o
snapshot do mesmo `scope` e soma scopes distintos. Os contadores precisam
satisfazer `resolved = passed + failed + skipped`; `total: null` significa
desconhecido, enquanto zero significa zero conhecido.

Um reporter ou wrapper novo pode emitir esse protocolo e usar
`adapter: "events"`, já aceito pela [configuração](../runner/cli.mjs), sem
alterar o parser ou acrescentar nomes à lista de adapters. A implementação
ficaria em `adapters/<runner>/`, acompanhada de guia e configuração de exemplo.
O aplicativo continua responsável pelo runner, ambiente e dependências.

## Candidatos

Dificuldades são estimativas para execução finita, não compatibilidade validada.

| Runner candidato | Dificuldade estimada | Abordagem e decisão pendente |
| --- | --- | --- |
| Go / `go test` | Baixa–média | Wrapper traduz [`go test -json`](https://go.dev/cmd/test2json/?m=old). Separar eventos de pacote e teste evita duplicação; definir contagem de subtests e total parcial. |
| Ruby / RSpec | Baixa | [Formatter](https://rspec.info/documentation/3.9/rspec-core/RSpec/Core/Formatters.html) recebe resultados dos exemplos; pending pode representar ignorados. Minitest exige avaliação separada. |
| JS/TS / Jest | Baixa–média | [Reporter próprio](https://jestjs.io/docs/configuration#reporters-arraymodulename--modulename-options), mantendo o padrão; reconciliar casos, skip/todo e erros de suíte. Fixar versão suportada. |
| JS/TS / Vitest | Baixa–média | [Reporter](https://vitest.dev/api/advanced/reporters) acompanha coleta, casos e finalização; tratar módulos paralelos e erros fora dos casos. |
| C#/.NET / VSTest | Média | [Logger compilado](https://github.com/microsoft/vstest/blob/main/docs/report.md) emite snapshots; distribuir e carregar a DLL acrescenta trabalho. [`dotnet test`](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test) também pode usar MTP, que exige outra integração. |
| Rust / libtest ou nextest | Média–alta | Wrapper tradutor; JSON de [libtest](https://doc.rust-lang.org/rustc/tests/) é instável e o de [nextest](https://nexte.st/docs/machine-readable/libtest-json/) é experimental. Escolher runner, formato e versões antes de prometer suporte estável. |

## Limites e riscos

Backend executa argv genérico. Frontend sempre faz
[descoberta de Node/.nvmrc](../runner/frontend-runtime.mjs) e altera PATH,
mesmo para comandos sem Node. Para Go, Ruby ou .NET, backend é o caminho inicial
mais simples. Existem somente duas áreas simultâneas, fixadas no
[estado](../runner/state.mjs) e no [painel/comandos](../hooks/register.mjs).

O [worker](../runner/worker.mjs) lê stdout e stderr. Eventos precisam chegar
imediatamente, com flush e linhas completas, apesar de captura e paralelismo.
Scopes devem ser únicos e não sobrepostos. Snapshots atrasados não possuem
sequência para rejeição; retries precisam reconciliar resultados sem duplicação.
`final: true` não declara sucesso, e o estado `completed` não exige que todos os
scopes tenham esse marcador: a correção do adapter é essencial.

Watch acumula scopes de rodadas; oferecer a rodada atual exige identidade de
ciclo. Refatorar runtime/área visual faz sentido quando houver runners sem Node
em frontend; suítes configuráveis, quando forem necessárias três ou mais áreas.
Essas mudanças atravessam configuração, estado, CLI, bootstrap e painel.

## Aceite de uma integração

Confrontar contadores com o relatório nativo em sucesso, falha, skip, zero testes,
erro de descoberta, fail-fast, captura, paralelismo/retry e cancelamento com
processo filho. Confirmar atualização antes do encerramento, total
desconhecido/parcial honesto, código de saída preservado e ausência de processos
órfãos. A demo não substitui esse aceite. Windows requer validação nativa própria.
