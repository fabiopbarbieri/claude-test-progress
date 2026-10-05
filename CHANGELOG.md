# Changelog

A versão em `.claude-plugin/plugin.json` identifica o plugin distribuído.
`package.json` acompanha esse valor; o catálogo não declara outra versão.

## [0.2.0] - Em preparação, não publicada

### Mudança incompatível

- Configuração e estado exigem `schemaVersion: 2`. Suites passam a ser módulos
  com ID declarados em `modules` (com `templates` opcionais do usuário); lanes
  fixas `backend`/`frontend` deixam de existir. Config v1 é recusada, sem
  fallback nem conversão automática.
- Removidos a opção `--lane`, os atalhos de início por ID e a demo sintética.
  O coletor aceita apenas `start/list/status/cancel/logs` com `--cwd`,
  `--owner`, `--module` e `--config`; a resposta lista `modules` e `jobs`.
- Estado legado no namespace bloqueia **todos** os novos starts. O 0.2.0 não
  consulta, cancela nem converte jobs v1 ou demos antigas.

### Migração a partir de 0.1.0

1. **Antes de atualizar**, use a instalação 0.1.0 que iniciou os jobs, com o
   cwd/owner originais, para concluir ou cancelar cada execução e confirmar
   estado terminal sem recuperação pendente.
2. Reescreva a configuração em schema v2: cada lane antiga vira um módulo em
   `modules` (por exemplo `backend`), com `runtime: "inherit"` ou
   `"node-project"` (este último substitui a preparação Node/`.nvmrc` que a
   lane `frontend` fazia). Veja [config.example.json](config.example.json),
   [config.modules.example.json](config.modules.example.json) e
   [config.registry.example.json](config.registry.example.json).
3. Atualize o plugin e reinicie a sessão. Se um start for bloqueado por estado
   legado, siga a [adoção quiescente](docs/USAGE.md#adotar-v2-com-estado-legado);
   não apague locks ativos.

### Adicionado

- Módulos v2 por workspace com IDs, rótulos, ordem e templates, preparação em
  lote tudo-ou-nada, supervisão destacada, recuperação autenticada de estado e
  painéis nativos por módulo.
- Adaptador Ruby/RSpec opt-in com eventos de progresso, seleção nativa de
  exemplos e cobertura de retries, sem instalar gems no plugin.
- Adaptador Rails/Minitest opt-in, integrado ao runner nativo, com contagem de
  testes e preservação de seleção, resultado e código de saída. Mantida a
  descoberta de plugins do Minitest 5.20.
- Fixtures e CI de JUnit/Surefire e Angular 9/18 com Karma/browser, com
  dependências de verificação isoladas e versionadas.
- Verificação de versão, changelog, SHA escolhido, tags existentes e CI do
  mesmo commit; workflow manual de preparação com permissões de leitura.
- Ensaio reproduzível de instalação 0.1.0 e atualização 0.2.0 pelo marketplace
  Git isolado, incluindo uma suíte unittest pelo coletor instalado no cache.

### Corrigido

- Heartbeat do worker persistido durante testes longos sem saída: o estado
  distingue atividade do processo, última saída e último progresso observado.
  Tempo decorrido não é apresentado como prova de avanço da suíte.

### Limites de aceite

- Esta entrada descreve código presente, não uma release já publicada.
  Publicação depende dos gates e evidências do SHA final descritos no
  [roteiro](docs/RELEASING.md).
- Node 14 continua sendo o mínimo do coletor. Python, Ruby, Java e Karma são
  opcionais conforme o módulo. Só `runtime: "node-project"` prepara
  Node/`.nvmrc`; fixtures Rails de views/system usam `rack_test`. Selenium não
  tem aceite funcional; Windows nativo tem CI própria, mas os limites de aceite
  descritos em [compatibilidade](docs/COMPATIBILITY.md) continuam valendo.

## [0.1.0] - Baseline público

- Publicação inicial do código como marketplace Git independente, plugin
  `test-progress`, repositório `claude-test-progress`, licença MIT.
- Coletor em segundo plano, lanes backend/frontend, demo sintética,
  cancelamento por sessão e adaptadores JUnit, Karma, pytest e unittest.
- Caminhos Linux/Bash e implementação Windows/PowerShell, com aceite nativo
  Windows pendente. Não há afirmação de tag ou GitHub Release para esse baseline.
