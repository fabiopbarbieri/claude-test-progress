# Reporter Karma

[Compatibilidade e versões testadas](../../docs/COMPATIBILITY.md) ·
[Uso e atualização de caminhos](../../docs/USAGE.md) ·
[Diagnóstico](../../docs/TROUBLESHOOTING.md)

`reporter.cjs` exporta `reporter:claude-test-progress`. É CommonJS e usa apenas
Node (`crypto` e stdout), sem instalar dependências. Lê os contadores de
`browser.lastResult`, atualizados pelo próprio Karma; não interpreta descrições
de specs nem altera o resultado do comando.

## Opt-in

Use `/test-progress paths` para consultar o caminho absoluto de `reporter.cjs`
nesta instalação. No `karma.conf.js` do app, acrescente estas entradas aos arrays
que já existem, substituindo o caminho de exemplo:

```js
// Dentro do array plugins existente:
require('/caminho/absoluto/claude-test-progress/adapters/karma/reporter.cjs')

// Dentro do array reporters existente:
'claude-test-progress'
```

Configure uma execução finita (`singleRun: true` ou `--watch=false` no Angular).
Preserve frameworks, browsers e os outros plugins/reporters. O caminho absoluto
evita depender do diretório do comando; não substitua o arquivo Karma completo.

Vale para Angular 9 ou 18 **se o target de testes realmente usar Karma**. Para
Angular 9 foram conferidos os contratos de Karma **4.3.0/4.4.1 e 5.0.0/5.2.3**.
CLI 9.0.7 gerava Karma `~4.3.0`; CLI 9.1.15 gerava `~5.0.0`. O reporter não
depende de APIs exclusivas do Karma 6 e sua sintaxe CommonJS é compatível com
Node 12. A integração real com um app permanece sem aceite.

A versão de Angular sozinha não define o runner instalado. Não atualizar Karma,
Angular, TypeScript ou lockfile para usar o reporter. Não há adaptador Jest ou
Vitest. A configuração do app é uma etapa explícita, feita por quem o mantém.

Para separar o Node do coletor e do Angular 9, consulte o
[guia Angular 9](../../ANGULAR9.md) e a configuração específica.

## Módulo no coletor

Depois de registrar o reporter no app, configure um módulo no workspace:

```json
{
  "schemaVersion": 1,
  "modules": {
    "web": {
      "command": ["node", "./node_modules/@angular/cli/bin/ng", "test", "--watch=false"],
      "cwd": ".",
      "adapter": "events",
      "runtime": "node-project"
    }
  }
}
```

Use `/test-progress start web`, `status web`, `logs web` e `cancel web`.
`node-project` respeita `.nvmrc` no início selecionado, independente de ID ou
linguagem; a descoberta não executa o resolvedor. Sem reporter, `adapter: "karma"`
usa fallback de logs. Mais de um módulo Karma pode ter ID próprio; `start all`
seleciona os habilitados. O registry é opcional e não ativa módulos sozinho.
Aceite nativo Windows e execução em browser real exigem gates próprios.

## Eventos e limites

`onRunStart` cria scopes por navegador com total desconhecido e contadores zerados:
Karma 4/5 limpa `lastResult` antes de `run_start`, mas o total ainda não foi informado.
`onBrowserStart` lê o estado novo e aceita total zero somente se informado
explicitamente. `onSpecComplete`
publica snapshots de success/failed/skipped/total. Total desconhecido permanece
`null`; uma contagem conhecida pode crescer. O fechamento acontece em
`onBrowserComplete`, com cobertura de scopes restantes em `onRunComplete`.

O scope inclui sessão, contador de ciclo, ID e nome do browser. Browsers diferentes
com o mesmo nome não colidem. Novas rodadas watch têm scopes diferentes; o coletor
deve delimitar a rodada se quiser exibir apenas a atual. A integração recomendada
é um comando finito com `singleRun: true`.

`final: true` significa encerramento daquele browser, inclusive em desconexão;
não transforma falhas de infraestrutura em specs failed nem garante total
conhecido. `totalStable` só fica true no final se o total é conhecido. O runner
precisa preservar logs e exit code. JSON.stringify escapa nomes e cada evento é
escrito em uma única chamada a stdout.

Um CI precisaria coletar o stdout do processo Karma; o reporter não cria essa
integração. Os gates estão em [VALIDATION](../../docs/VALIDATION.md).
Aceite em app Angular real, browser e reconexão continua separado desses gates.

## Fontes primárias

- [Karma: estrutura e registro de plugins](https://karma-runner.github.io/6.4/dev/plugins.html).
- [Angular CLI 9.0.7: dependências do workspace](https://github.com/angular/angular-cli/blob/v9.0.7/packages/schematics/angular/workspace/files/package.json.template).
- [Angular CLI 9.1.15: dependências do workspace](https://github.com/angular/angular-cli/blob/v9.1.15/packages/schematics/angular/workspace/files/package.json.template).
- [Karma 4.3.0: ordem de eventos e lastResult](https://github.com/karma-runner/karma/blob/v4.3.0/lib/browser.js).
- [Karma 5.0.0: ordem de eventos e lastResult](https://github.com/karma-runner/karma/blob/v5.0.0/lib/browser.js).
- [Karma 4.4.1: limpeza anterior a run_start](https://github.com/karma-runner/karma/blob/v4.4.1/lib/executor.js).
- [Karma 5.2.3: limpeza e disparo de eventos](https://github.com/karma-runner/karma/blob/v5.2.3/lib/executor.js).
- [Karma 6.4.4 browser_result.js: contadores oficiais](https://github.com/karma-runner/karma/blob/v6.4.4/lib/browser_result.js).
