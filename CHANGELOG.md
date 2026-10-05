# Changelog

A versão em `.claude-plugin/plugin.json` identifica o plugin distribuído.
`package.json` acompanha esse valor; o catálogo não declara outra versão.

## [0.2.0] - Em preparação, não publicada

### Adicionado

- Adaptador Ruby/RSpec opt-in com eventos de progresso, seleção nativa de
  exemplos e cobertura de retries, sem instalar gems no plugin.
- Adaptador Rails/Minitest opt-in, integrado ao runner nativo, com contagem de
  testes e preservação de seleção, resultado e código de saída. Mantida a
  descoberta de plugins do Minitest 5.20.
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
  Publicação depende da integração das revisões de documentação e das
  correções/evidências de validação descritas no [roteiro](docs/RELEASING.md).
- Node 14 continua sendo o mínimo do coletor. Python, Ruby, Java e Karma são
  opcionais conforme a suíte. O frontend ainda prepara Node/`.nvmrc`; testes
  Rails de views/system usam backend. Selenium e Windows nativo não têm
  aceite funcional comprovado por esta preparação.

## [0.1.0] - Baseline público

- Publicação inicial do código como marketplace Git independente, plugin
  `test-progress`, repositório `claude-test-progress`, licença MIT.
- Coletor em segundo plano, lanes backend/frontend, demo sintética,
  cancelamento por sessão e adaptadores JUnit, Karma, pytest e unittest.
- Caminhos Linux/Bash e implementação Windows/PowerShell, com aceite nativo
  Windows pendente. Não há afirmação de tag ou GitHub Release para esse baseline.
