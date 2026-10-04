# Angular 9 · runtimes independentes

Este guia mantém Angular 9 e suas dependências existentes. A integração usa o
target Karma já existente e não exige migrar Angular, TypeScript, Karma, Jasmine
ou lockfile.

No Windows nativo, use os comandos e a descoberta nvm-windows de
[WINDOWS.md](WINDOWS.md); no Linux/WSL, siga os comandos Bash abaixo.

## Versões

| Componente | Runtime/contrato |
| --- | --- |
| Claude Code Mod | Claude 2.1.287+; hook executado pelo engine do Claude |
| Coletor externo | Node 14.0.0+; descoberta automática no PATH/nvm local |
| Angular 9.0/9.1 | Matriz histórica: Node `^10.13.0 || ^12.11.0`; exemplo Node 12.22.12 |
| Reporter | CommonJS, sem dependências; roda dentro do Karma do app |
| Karma conferido por leitura | 4.3.0/4.4.1 e 5.0.0/5.2.3 |

Node 14 não aparece na [matriz histórica oficial do Angular 9](https://angular.dev/reference/versions).
Suporte do **coletor** a Node 14 não declara suporte oficial de Angular 9 a esse
Node. Use o runtime já adequado ao app. Compilar/instalar o Claude pelo npm pode
ter requisitos próprios: prefira o binário nativo compatível e separe a
instalação do Claude do ambiente Node do projeto.

## 1. Descoberta automática do Node

Se instalou pelo marketplace, abra o Claude normalmente no diretório do app.
Para um checkout local, mantenha seu ambiente habitual e carregue o Mod:

```bash
bash /caminho/absoluto/claude-test-progress/launch.sh
```

O coletor procura os executáveis `node` no PATH e usa o primeiro disponível com
versão 14+. Se nenhum atende, consulta o nvm local: `current`, `default`,
`node` e as demais versões locais, da mais recente para a mais antiga, até
encontrar uma versão instalada adequada. Se não encontra, informa
erro; não baixa nem instala versões. Um Node 12 ativo no app pode coexistir
com um Node 14+ instalado para o coletor.

O frontend procura a `.nvmrc` mais próxima, subindo a partir do `cwd` da lane
até a raiz do filesystem. Versões numéricas podem ser atendidas por um Node
compatível já no PATH; demais seletores, como `lts/*` ou aliases, são resolvidos
pelo nvm. A versão solicitada precisa existir localmente. Não há fallback para
outra versão quando a `.nvmrc` não pode ser atendida. Sem `.nvmrc`, o frontend
prefere o Node disponível no PATH e usa nvm apenas se ele estiver ausente.

Por exemplo, uma `.nvmrc` com `12.22.12` permite manter o Angular 9 nesse runtime
mesmo se o Claude foi aberto com Node 26. A escolha ocorre antes de reservar
lanes ou iniciar processos. O diretório do Node escolhido é anteposto somente
ao PATH do processo frontend e seus subprocessos; backend Java e ambiente do
terminal permanecem como estavam. O CLI inicia worker e demo com seu próprio
`process.execPath`; a demo não procura `.nvmrc` nem executa Angular.

O Mod detecta `nvm.sh` em `$NVM_DIR`, `$HOME/.nvm` ou `$XDG_CONFIG_HOME/nvm`.
Carrega-o em subshell com `--no-use` e consulta `nvm which --silent`, usando
apenas versões instaladas. Não chama `nvm use`, não muda aliases, não escreve
`.nvmrc`, não altera arquivos de inicialização do shell. A `.nvmrc` é lida como
texto, com comentários/espaços e linhas de metadados `chave=valor`; deve conter
exatamente um seletor. Seu conteúdo não é executado.

Também funciona ao carregar diretamente:

```bash
claude --plugin-dir /caminho/absoluto/claude-test-progress
```

`CLAUDE_BIN=/caminho/do/claude` é opcional no launcher. Para escolher explicitamente
o coletor, ainda existe `TEST_PROGRESS_NODE=/caminho/absoluto/node`; o executável
deve ser 14+ e um override inválido causa erro. O fluxo normal dispensa ambos.
Para inspecionar a descoberta sem iniciar um job:

```bash
bash /caminho/absoluto/claude-test-progress/runtime/resolve-node.sh project --cwd "$PWD"
```

Troque `project` por `collector` para consultar o Node do coletor. A resposta
JSON mostra caminho absoluto, versão, origem e `.nvmrc`, quando aplicável.

## 2. Integrar o reporter opt-in

Use `/test-progress paths` para consultar o caminho absoluto do reporter nesta
instalação. Substitua o caminho de exemplo abaixo pelo resultado. No
`karma.conf.js` existente, acrescente o módulo ao array `plugins` e o nome ao
array `reporters`. Preserve todos os valores atuais:

```js
// Acrescente dentro do array plugins que o app já usa:
require('/caminho/absoluto/claude-test-progress/adapters/karma/reporter.cjs')

// Acrescente dentro do array reporters:
'claude-test-progress'
```

São entradas para os arrays existentes, não um arquivo Karma completo. Não
substitua os plugins do builder Angular, browsers ou frameworks. Para o progresso
de uma execução, use `watch=false`/`singleRun: true`. Ciclos watch repetidos ainda
não têm delimitação de rodada no agregador.

O reporter usa `onRunStart`, `onBrowserStart`, `onSpecComplete`,
`onBrowserComplete`, `onRunComplete` e `browser.lastResult`. Essas APIs e a ordem
de atualização dos contadores foram conferidas nas versões históricas listadas.
Não depende de APIs exclusivas de Karma 6.

## 3. Configurar a lane frontend

Use [config.angular9.example.json](config.angular9.example.json) como conteúdo
de `<diretório da sessão>/.claude/test-progress.json`, opt-in no app escolhido:

```json
{
  "schemaVersion": 1,
  "frontend": {
    "command": ["node", "./node_modules/@angular/cli/bin/ng", "test", "--watch=false", "--browsers=ChromeHeadless"],
    "cwd": ".",
    "adapter": "events",
    "env": {}
  }
}
```

O comando usa o CLI **local do app**, evitando resolução/download pelo `npx`.
`cwd: "."` pressupõe que a sessão foi aberta na raiz do Angular; ajuste se há
monorepo. `node_modules` deve já existir segundo o processo habitual do projeto.
Não há instalação de dependências feita pelo Mod.

`adapter: "events"` exige o reporter e reconhece o prefixo `@@TEST_PROGRESS@@`.
Se ainda não integrou o reporter, `adapter: "karma"` oferece parsing de logs
como fallback, com menor precisão de identificação de browsers. O modo events
informa erro caso o comando termine sem progresso reconhecido.

Use `"node"` no primeiro argumento para seguir a descoberta automática.
Um caminho explícito de um executável chamado `node` deve apontar para o mesmo
binário descoberto; divergências são recusadas antes de iniciar. Comandos de
outros tipos não são reescritos: wrappers com runtime fixo exigem configuração
coerente. Os metadados indicam o Node selecionado para o PATH do frontend.
`env` da lane pode fornecer PATH/NVM_DIR próprios, usados durante
a descoberta; o diretório escolhido ainda terá precedência no processo frontend.
Não coloque segredos em arquivos versionados.

O bootstrap requer Bash e ferramentas usuais do Linux; a ordenação das versões
locais usa GNU `sort -V`. A descoberta frontend tem limite de três segundos.

O browser deve estar instalado/disponível conforme a configuração existente.
Não use flags de OpenSSL, `--force`/`--legacy-peer-deps` ou upgrade de pacotes
como solução genérica para esta integração.

## 4. Utilizar

`/test-progress` apenas consulta. `/test-progress demo` simula contadores sem
executar testes. `/test-progress frontend` inicia o comando real somente quando
você pedir. `logs frontend` e `cancel frontend` consultam/cancelam essa execução.

A validação inicial do protótipo limitou-se a sintaxe, contratos e demo. Os gates
atuais estão em [VERIFICATION](docs/VERIFICATION.md). Testes locais do coletor e
do reporter não equivalem ao aceite de um app Angular 9 com seu builder, browser
e dependências reais; esse aceite continua pendente.

## Fontes primárias

- [Angular: matriz de compatibilidade histórica](https://angular.dev/reference/versions).
- [CLI 9.0.7: template com Karma ~4.3.0](https://github.com/angular/angular-cli/blob/v9.0.7/packages/schematics/angular/workspace/files/package.json.template).
- [CLI 9.1.15: template com Karma ~5.0.0](https://github.com/angular/angular-cli/blob/v9.1.15/packages/schematics/angular/workspace/files/package.json.template).
- [Karma 4.3.0: browser e eventos](https://github.com/karma-runner/karma/blob/v4.3.0/lib/browser.js).
- [Karma 5.0.0: browser e eventos](https://github.com/karma-runner/karma/blob/v5.0.0/lib/browser.js).
- [Mods: API de ambiente e processos](https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods).
- [nvm 0.40.8: carregamento, .nvmrc e resolução local](https://github.com/nvm-sh/nvm/blob/v0.40.8/README.md#nvmrc).
