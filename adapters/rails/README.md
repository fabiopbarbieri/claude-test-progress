# Rails: Minitest, views e system tests

[Compatibilidade e versões testadas](../../docs/COMPATIBILITY.md) ·
[Uso e atualização de caminhos](../../docs/USAGE.md) ·
[Diagnóstico](../../docs/TROUBLESHOOTING.md)

`run.rb` executa o `bin/rails` do projeto e acrescenta snapshots de progresso aos
logs. Usa o Ruby e as gems do próprio app, preservando o reporter Rails, filtros,
seed, falhas, skips e código de saída. Não instala gems nem altera o app.

O contrato desta integração é Rails **7.2, 8.0 e 8.1** com Minitest
**>= 5.20 e < 6**. Minitest 6 é recusado com diagnóstico antes de executar testes.
O coletor continua precisando de seu próprio Node 14+. Veja o alcance observado
em [VALIDATION](VALIDATION.md).

## Configurar

Adapte [config.rails.example.json](../../config.rails.example.json) para
`<diretório da sessão>/.claude/test-progress.json`. O cwd do módulo deve apontar para a raiz
do app, contendo `bin/rails` e `config/boot.rb`:

```json
{
  "schemaVersion": 1,
  "modules": {
    "rails": {
      "label": "Rails",
      "runtime": "inherit",
      "command": [
        "bundle",
        "exec",
        "ruby",
        "/absolute/path/to/claude-test-progress/adapters/rails/run.rb",
        "test"
      ],
      "cwd": ".",
      "adapter": "events",
      "env": {}
    }
  }
}
```

O executável `bundle` deve pertencer ao ambiente Ruby do projeto. Se o terminal
já selecionou esse ambiente, a configuração acima o herda. Um caminho absoluto
para o executável também funciona. Cada argumento ocupa um elemento no JSON;
caminhos com espaços não precisam de aspas adicionais dentro do elemento.

O exemplo versionado usa o ID `backend`; o trecho acima usa `rails`. Use o ID
que estiver no seu arquivo. Com este trecho, execute `/test-progress start rails`. Consulte `status rails`, `logs rails`
e `cancel rails`. `start all` seleciona todos os módulos habilitados; não exige
configuração de outra linguagem.

O wrapper carrega `config/boot.rb` antes de Minitest para respeitar o bundle do
app e depois carrega `bin/rails` com os argumentos fornecidos. A instrumentação
fica restrita a essa execução. Para remover a integração, restaure o comando
original na configuração do módulo.

## Comandos e filtros

Substitua o último `test` do exemplo pelos argumentos desejados:

```json
["test", "test/models/account_test.rb"]
```

```json
["test", "test/models/account_test.rb:12"]
```

```json
["test", "test/models/account_test.rb", "-n", "test_valid_account"]
```

```json
["test", "--fail-fast", "--seed", "9123"]
```

```json
["test:system"]
```

```json
["test:all"]
```

Somente `test`, `test:system` e `test:all` são aceitos como comando inicial. Opções
seguintes pertencem ao Rails. Não há tradução de filtros, nova coleta ou alteração
de seed. Plugins Minitest do app continuam carregados normalmente; `--no-plugins`
mantém seu significado nativo e não desativa o reporter explicitamente solicitado
pelo wrapper.

Testes de models, jobs, controllers, helpers, integração e views continuam no
runner Rails. System tests também são testes Ruby/Minitest, usando o driver que o
app configurou. A fixture de aceite usa `rack_test`, que verifica HTML servido;
ela não executa JavaScript nem confirma comportamento em Chrome/Selenium.

Todos esses comandos podem ocupar um módulo Rails com `runtime: "inherit"`.
Cadastre IDs distintos para suites separadas; label/linguagem/ID não selecionam
runtime. `node-project` é uma opção explícita para projetos que precisam de
Node, independente do nome do módulo. Runners JavaScript independentes, RSpec
e testes Ruby fora de Rails não fazem parte deste adapter.

## Contagem e interrupções

- Um resultado Minitest corresponde a um teste; assertions não aumentam o total.
  Falha ou erro, inclusive em teardown, prevalece sobre skip no mesmo resultado.
- Snapshots cumulativos saem conforme os resultados chegam. Durante a execução,
  `total` permanece `null`: Minitest não oferece aqui um plano selecionado sem
  repetir descoberta e interferir na ordem aleatória e nos filtros do Rails.
  Há contadores ao vivo, mas não percentual ou estimativa de tempo restante.
- Ao terminar normalmente o relatório Minitest, o último snapshot registra o
  total observado, inclusive zero conhecido. Uma suite concluída pode falhar;
  o código de saída nativo continua determinando o status do comando.
- Boot/load errors, fail-fast e `Interrupt` deixam o total desconhecido. Um
  cancelamento pode encerrar o processo antes do evento final; o coletor conserva
  os resultados já recebidos e marca a execução cancelada.
- Paralelismo nativo Rails por processos e threads usa o reporter central no
  processo pai. A saída tem um único scope por invocação, com proteção contra
  duplicação em filhos de fork. Parallel runners externos, retry/watch e plugins
  que substituem o protocolo ou removem reporters não têm aceite nesta versão.
- O reporter usa uma cópia do descritor stdout e emite com flush, sem desativar
  `capture_io`/`capture_subprocess_io` dos testes. Mensagens nativas continuam nos
  logs. Falha ao escrever progresso não substitui o resultado dos testes.

O wrapper observa exceções `Interrupt` via TracePoint para distinguir o relatório
que Minitest também emite após uma interrupção. Não instala handlers de sinais.
Um `Interrupt` capturado pelo próprio app também torna o total conservadoramente
desconhecido. O encerramento final não garante sucesso de outros hooks do app;
consulte sempre o status e o exit code do comando.

## Fontes e validação

- [Guia oficial: testes Rails e paralelismo](https://guides.rubyonrails.org/testing.html).
- [Rails TestCommand: test, system e all](https://github.com/rails/rails/blob/v8.1.4/railties/lib/rails/commands/test/test_command.rb).
- [Minitest: plugins e reporters](https://github.com/minitest/minitest/tree/v5.27.0).
- [Cenários executados e limites de plataforma](VALIDATION.md).
