# Adaptadores de progresso

Integração opt-in: cada app mantém seu runner, ambiente e dependências.
Consulte `/test-progress paths` para localizar os arquivos desta instalação. Os adaptadores
escrevem snapshots cumulativos no stdout, em uma linha por evento:

```text
@@TEST_PROGRESS@@{"scope":"origem:identificador","total":12,"resolved":4,"passed":3,"failed":1,"skipped":0,"final":false,"totalStable":false,"phase":"executing"}
```

O coletor substitui o snapshot anterior do mesmo `scope` e soma scopes distintos.
`resolved = passed + failed + skipped`. `total: null` significa desconhecido;
`0` só representa zero conhecido. `totalStable: false` indica contagem parcial,
que pode crescer. `final` fecha o scope, sem declarar que a execução teve sucesso.
O status final do comando continua sendo responsabilidade do runner.

- [Rails / Minitest](rails/README.md)
- [JUnit 5 / Maven](junit/README.md)
- [Karma / Angular com Karma](karma/README.md)
- [Python / pytest e unittest](python/README.md)
- [Ruby / RSpec](ruby/README.md)

Uma execução serial de módulos Maven pode concluir um módulo antes de conhecer o
plano do seguinte. O número agregado nesse intervalo é **parcial**, mesmo se todos
os scopes já recebidos terminaram. A estabilidade de um scope não garante o total
global do comando. Use comandos finitos (`singleRun` no Karma) para uma barra de
progresso por execução: watch emite novos scopes a cada ciclo, e o coletor precisaria
delimitar ciclos para apresentar apenas a rodada atual.

Um CI não identificado precisa de um coletor de stdout que reconheça o prefixo;
estas linhas sozinhas não instalam uma integração na plataforma de CI.

Resultados dos gates e limites por plataforma estão em
[VERIFICATION](../docs/VERIFICATION.md).
