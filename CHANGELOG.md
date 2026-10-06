# Changelog

A versão em `.claude-plugin/plugin.json` identifica o plugin distribuído.
`package.json` acompanha esse valor; o catálogo não declara outra versão.

## [Unreleased]

### Alterado

- JUnit 5: o listener passa a compilar contra JUnit Platform 1.14.4 (JUnit
  5.14.4), e esse é o novo mínimo declarado; o CI deixa de cobrir 5.11–5.13.
- Rails 8.0/8.1 validados com Minitest 5.27.0; o piso 5.20.0 segue no job
  Rails 7.2.
- CI: `actions/checkout` v7.0.1.

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
- Adaptadores: JUnit 5 (listener para Java 17+ ou fallback Maven), Karma
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
