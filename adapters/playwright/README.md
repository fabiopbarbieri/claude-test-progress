# Reporter Playwright Test

[Compatibilidade e versões testadas](../../docs/COMPATIBILITY.md) ·
[Uso e atualização de caminhos](../../docs/USAGE.md) ·
[Diagnóstico](../../docs/TROUBLESHOOTING.md)

`reporter.cjs` é um reporter do runner `@playwright/test` (JavaScript/TypeScript).
É CommonJS e usa apenas Node (`crypto` e stdout), sem instalar dependências.
Lê `suite.allTests()` e `test.outcome()`, fornecidos pelo próprio Playwright; não
interpreta títulos de testes nem altera o resultado do comando.

Não se aplica a scripts que usam a biblioteca `playwright` diretamente (sem
`playwright test`) nem a `pytest-playwright`, que já é coberto pelo
[adaptador pytest](../python/README.md).

## Opt-in

Use `/test-progress paths` para consultar o caminho absoluto de `reporter.cjs`
nesta instalação. O caminho mais simples não altera o app: passe o reporter na
linha de comando, junto de um reporter de console.

```text
npx --no-install playwright test --reporter=list,/caminho/absoluto/claude-test-progress/adapters/playwright/reporter.cjs
```

`--reporter` na linha de comando **substitui** os reporters do
`playwright.config`. Para manter HTML, JUnit ou outros, acrescente o reporter ao
array existente no config em vez de usar a flag:

```js
reporter: [
  ['list'],
  ['/caminho/absoluto/claude-test-progress/adapters/playwright/reporter.cjs']
]
```

O reporter não escreve no terminal além das linhas `@@TEST_PROGRESS@@`
(`printsToStdio()` é `false`), então convive com `list`, `line` ou `dot`.
Não atualize Playwright nem lockfile para usar o reporter.

## Módulo no coletor

Copie e ajuste [config.playwright.example.json](../../config.playwright.example.json):

```json
{
  "schemaVersion": 1,
  "modules": {
    "e2e": {
      "command": ["npx", "--no-install", "playwright", "test",
        "--reporter=list,/caminho/absoluto/claude-test-progress/adapters/playwright/reporter.cjs"],
      "cwd": ".",
      "adapter": "events",
      "runtime": "node-project"
    }
  }
}
```

Use `/test-progress start e2e`, `status e2e`, `logs e2e` e `cancel e2e`.
`node-project` respeita `.nvmrc`. Os browsers do Playwright (`playwright install`)
continuam responsabilidade do app; o plugin não os instala. Não há fallback por
logs: sem o reporter, use `adapter: "exit"`.

## Eventos e limites

Um scope por execução (`playwright:<pid>:<aleatório>`). `onBegin` publica o total
do plano, `suite.allTests().length`, que já inclui projetos (browsers),
`repeatEach` e o recorte de `--shard`; por isso o total é estável desde o início.

`onTestEnd` só conta um teste quando ele termina de verdade: tentativa com
falha e retry restante não é publicada, e tentativa `interrupted` não resolve o
teste. A contagem usa `test.outcome()`: `expected` e `flaky` contam como
passed, `unexpected` como failed e `skipped` como skipped. Um `test.fail()` que
falha conforme declarado é `expected`, portanto passed — igual ao relatório
nativo.

`onEnd` fecha o scope com `final: true`. Testes que não rodaram (`--max-failures`,
cancelamento, interrupção) ficam fora de `resolved`: o percentual fica abaixo de
100%, sem inventar falhas. O exit code continua sendo do Playwright. Erros de
configuração antes de `onBegin` não geram eventos e o painel mostra "sem eventos".

Fora do contrato: `--ui`, watch e merge de shards de várias máquinas. Cada
execução de shard é um scope próprio no módulo que a executou.

## Fontes primárias

- [Reporter API](https://playwright.dev/docs/api/class-reporter).
- [TestCase: outcome, retries e expectedStatus](https://playwright.dev/docs/api/class-testcase).
- [TestResult: status e retry](https://playwright.dev/docs/api/class-testresult).
- [Reporters e `--reporter` na linha de comando](https://playwright.dev/docs/test-reporters).
