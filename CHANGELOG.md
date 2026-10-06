# Changelog

A versão em `.claude-plugin/plugin.json` identifica o plugin distribuído.
`package.json` acompanha esse valor; o catálogo não declara outra versão.

## [Unreleased]

### Skill

- `test-progress:configure`: o Claude cadastra suítes em `.claude/test-progress.json`
  (adapter e runtime por stack, caminhos absolutos a partir do plugin) e diagnostica
  os sintomas do painel, deixando o início dos testes com a pessoa.

### Painel

- Erros quebram linha em vez de truncar e terminam numa próxima ação
  (`≡` abre o log; aviso de `adapter` quando nenhum evento foi reconhecido).
- Run encerrado mostra o resultado (`✓19 · 19 testes`), sem barra; a barra fina
  aparece só enquanto o módulo roda.
- A barra do topo resume módulos, execuções e falhas no lugar do título repetido.
- Botão `×` fecha o painel (nunca cancela runs); `×` no cabeçalho do log o recolhe.
- `/test-progress` sem argumentos alterna o painel entre aberto e fechado.
- O log omite linhas `@@TEST_PROGRESS@@` do protocolo e colapsa linhas vazias.

## [0.3.0] - 2026-10-05

Primeira versão pública do Test Progress.

### Recursos

- Módulos de teste declarados por workspace em `.claude/test-progress.json`
  (`schemaVersion: 1`), com IDs, rótulos, ordem, templates pessoais opcionais e
  runtime explícito: `inherit` ou `node-project` (Node e `.nvmrc` do app).
- Início explícito por ID ou `all`, com preparação em lote tudo-ou-nada,
  supervisão em segundo plano, consulta, logs e cancelamento por sessão.
- Painel minimalista: uma linha por módulo, com status por ícone e cor, barra,
  percentual, contadores e tempo; ações `▶` `■` `≡` e legenda em `?`. Em painéis
  estreitos o progresso desce para uma segunda linha.
- Faixa de uma linha acima do prompt com o que está rodando e as falhas ainda
  não vistas, e resposta textual completa com `--text`.
- Adaptadores: JUnit 5.14+ (listener para Java 17+ ou fallback Maven), Karma
  (reporter ou fallback), pytest e unittest, Ruby/RSpec e Rails/Minitest.
- Linux e WSL por Bash; Windows por PowerShell 5.1/7, com cancelamento da árvore
  de processos por Job Object.
- Estado privado por workspace e sessão, recuperação autenticada de jobs órfãos
  e bloqueio de novos starts diante de estado incompatível ou ilegível.
- Verificação de versão, changelog, SHA e CI do mesmo commit antes de publicar,
  com workflow manual de preparação somente leitura.

### Limites

- O coletor exige Node 14+. Python, Ruby, Java e Karma só são necessários
  conforme os módulos cadastrados; o plugin não instala runners nem browsers.
- Percentual é testes resolvidos sobre o total conhecido. 100% não comprova
  encerramento nem sucesso; confira estado, falhas e código de saída.
- Fixtures Rails de views/system usam `rack_test`; Selenium não tem aceite
  funcional. Windows nativo tem CI própria, ainda sem aceite registrado.
