# Ruby / RSpec

[Compatibilidade e versões testadas](../../docs/COMPATIBILITY.md) ·
[Uso e atualização de caminhos](../../docs/USAGE.md) ·
[Diagnóstico](../../docs/TROUBLESHOOTING.md)

Adaptador opt-in para **RSpec Core 3.13.x**, em uma execução serial e finita.
Use o Ruby e o bundle do aplicativo: o adaptador não instala gems, muda o Gemfile
nem inicializa uma aplicação Rails. Ruby 3.1+ é o alvo desta integração.

Localize esta instalação com `/test-progress paths`. No diretório do app:

```bash
bundle exec ruby /caminho/claude-test-progress/adapters/ruby/run.rb rspec spec
```

Copie e ajuste [config.ruby.example.json](../../config.ruby.example.json) para
`.claude/test-progress.json` no aplicativo. Declare um módulo schemaVersion 1
com `adapter: "events"` e `runtime: "inherit"`. O ID não escolhe runtime;
Node/.nvmrc só é preparado quando runtime é explicitamente `node-project`.
O Ruby/Bundler do app precisa estar no PATH do coletor, ou use executáveis
absolutos. A configuração é local e não deve ser versionada neste repositório.
Sem Bundler, use o Ruby que já tem RSpec instalado: `ruby .../run.rb rspec spec`.

Inicie com `/test-progress start backend` se conservar o ID do exemplo;
consulte `status backend`, `logs backend` e `cancel backend`. IDs distintos
permitem várias suites Ruby; `start all` seleciona os habilitados do workspace.

Argumentos após `rspec` são encaminhados ao runner. Sem caminhos, a seleção
padrão `spec/` continua funcionando. `.rspec`, `.rspec-local`, `SPEC_OPTS`, filtros,
seed e formatters configurados continuam sendo responsabilidade do RSpec.
O listener é aditivo: preserva o relatório padrão, `--format` e `--out`.
As linhas de eventos são acrescentadas ao stdout original; para um relatório
JSON puro, direcione o formatter nativo a um arquivo com `--out`.

## Contagem e encerramento

- Durante carregamento, `total: null` significa desconhecido. O evento `start`
  informa o plano selecionado pelo RSpec; zero conhecido permanece zero.
- Cada exemplo recebe um resultado definitivo: passado, falho ou pending/skip.
  Pending que passa inesperadamente continua sendo falha, conforme o RSpec.
  Erros de setup/teardown do exemplo são falhas desse exemplo.
- Erros de descoberta mantêm o total desconhecido. Erros de hooks de suíte não
  criam testes fictícios; `totalStable: false` sinaliza finalização incompleta.
  O status do comando vem do código de saída nativo, inclusive códigos customizados.
- Fail-fast preserva o total selecionado e os resultados efetivamente recebidos.
  `--dry-run` publica o plano com `phase: "collected"` e nenhum exemplo resolvido:
  listar exemplos não comprova que eles passaram.
- O resultado final de retries que usam notificações RSpec padrão conta uma vez
  por exemplo. `rspec-retry` 0.6.2 é exercitado no gate; outros plugins de retry
  ou paralelismo precisam de validação própria.
- A saída de progresso usa um descritor duplicado, com flush imediato, para
  sobreviver a `$stdout` substituído ou `STDOUT.reopen`. O cancelamento continua
  sob responsabilidade do coletor e inclui subprocessos no mesmo grupo.

`final: true` fecha o scope, sem declarar sucesso. Ele pode preceder hooks Ruby
`at_exit`; o coletor espera a saída real do processo. Encerramento forçado pode
não produzir evento final. Não são suportados watch, DRb, `--bisect`, múltiplas
execuções no mesmo processo ou runners paralelos. Filhos criados com fork não
publicam cópias dos contadores do pai. Esta integração não oferece Minitest.

## Verificação

Com RSpec 3.13.x e `rspec-retry` 0.6.2 já disponíveis no ambiente de verificação:

```bash
python3 scripts/check-ruby.py
python3 scripts/check.py --smoke
```

O gate cria fixtures temporárias, confronta os códigos de saída com RSpec nativo,
confere filtros, zero, falhas de descoberta/setup/teardown, skips/pending,
fail-fast, dry-run, retry e saída configurada. Pelo coletor real, observa progresso
antes do fim mesmo com captura de fd e cancela um teste com processo filho.
`RUBY` pode indicar outro executável no gate. Nenhum teste de app privado é usado.

A matriz Linux em [.github/workflows/ruby.yml](../../.github/workflows/ruby.yml)
exercita Ruby 3.1, 3.4 e 4.0. A execução local foi verificada em Ruby 3.4.10 e
4.0.7 com rspec-core 3.13.6. A matriz publicada é a evidência das demais versões;
não há aceite nativo Windows nem aceite visual do painel neste escopo.

Fontes: [protocolo de formatters RSpec 3.13](https://rspec.info/documentation/3.13/rspec-core/RSpec/Core/Formatters.html),
[Runner](https://rspec.info/documentation/3.13/rspec-core/RSpec/Core/Runner.html) e
[protocolo de eventos deste projeto](../README.md).
