# Verificação da versão 0.1.0

Registro de 2026-10-04. Diferencia checagem de código, execução do coletor,
carregamento pelo Claude e aceite de apps/plataformas.

## Observado

- **Suíte longa, Linux / Claude Code 2.1.289:** um unittest real com 60 segundos
  de silêncio continuou depois da saída do cliente headless. Novos clientes com
  o mesmo diretório e ID consultaram 1/2 em execução e depois 2/2, exit 0. Início
  e consultas pelo Mod responderam em menos de 1 segundo neste ambiente; o
  heartbeat avançou sem inventar resultados. É uma amostra de 60 segundos,
  não um ensaio de várias horas nem evidência de Windows ou da pane visual.
- **Claude Code 2.1.289:** validação estrita do marketplace e dos hooks passou.
  Marketplace local adicionado e plugin instalado com configuração/cache
  temporários isolados. `/test-progress paths --text` executou pelo Claude e
  retornou os caminhos da instalação ativa. `/test-progress demo --text` iniciou
  workers: backend simulado terminou 8/8, uma falha, exit 1; frontend simulado
  terminou 12/12, um ignorado, exit 0. Isso não é inspeção visual da pane.
- **Distribuição GitHub:** o marketplace foi clonado por SSH e instalado pelo
  Claude em um segundo ambiente isolado. `paths --text` apontou para a cópia no
  cache, e a demo dessa instalação terminou com os mesmos resultados 8/8 e
  12/12. Não dependeu do caminho do checkout original.
- **Linux, Node 26.7.0:** o coletor executou amostras Python reais com pytest e
  unittest. Contadores e códigos de saída foram confrontados com resultados
  esperados; falhas deliberadas apareceram como falha e não como sucesso.
- **Python 3.13.15 / pytest 9.1.1:** caso com 7 itens (parametrizados, falha,
  skip, xfail, erros de setup e teardown) terminou com 2 passaram, 3 falharam,
  2 ignorados, exit 1. Filtro selecionando 2 casos apresentou 50% durante a
  execução e terminou 2/2 com exit 0. Cancelamento preservou 1/2 e SIGTERM.
- **Unittest:** 5 métodos, incluindo vários subtests falhos, produziram 1 passou,
  2 falharam e 2 ignorados. Captura `-b` manteve os eventos visíveis. Seleção de
  um método terminou 1/1, exit 0.
- **Checks adicionais do adaptador:** pytest 8.4.2/9.1.1 com coleta, filtro,
  failfast, interrupção, rerun serial e recusa de xdist/identificadores repetidos;
  unittest em Python 3.14.8 com 29 cenários, incluindo erros de importação,
  fixtures, zero testes e SIGINT com `-c` (progresso parcial preservado).
- **Privacidade da exportação:** somente fontes e documentação pública foram
  copiadas. Histórico anterior, builds Java, dependências, tipos gerados, caches,
  configurações reais e logs ficaram fora. Gitleaks 8.30.1 foi obtido da release
  oficial e seu SHA-256 foi conferido. As varreduras do checkout, histórico novo,
  exportação limpa e clone SSH do GitHub não encontraram segredos. O clone limpo
  também passou em `scripts/check.py --smoke --pytest`. GitHub Secret Scanning e
  push protection estão ativos. Repita os gates para cada mudança com
  [scan-secrets.sh](../scripts/scan-secrets.sh).

## Checks reproduzíveis

```bash
python3 scripts/check.py --smoke
# Se pytest estiver instalado neste Python:
python3 scripts/check.py --smoke --pytest
python3 scripts/check-long-running.py
claude plugin test .
claude plugin validate . --strict
claude plugin validate .claude-plugin/plugin.json --strict
bash scripts/scan-secrets.sh
```

`check.py` confere sintaxe, JSON/XML, links locais, coerência dos manifests e
arquivos proibidos na distribuição. O smoke cria amostras temporárias para
sucesso, falha, skip e cancelamento; não inicia suítes de um app do usuário.
Não é necessário configurar uma chave de API para esses checks.

`check-long-running.py` inicia clientes separados do coletor e comprova que uma
suíte silenciosa continua após o cliente sair, por um intervalo maior que o limite
de tempo de uma consulta do Mod.
Também verifica sinal periódico sem resultados fabricados, duração final fixa,
cancelamento, contadores preservados após rotação do log e recuperação após perda
do worker (este último caso exige Linux). O tempo silencioso padrão é de 6 segundos;
`TEST_PROGRESS_QUIET_SECONDS=60 python3 scripts/check-long-running.py` o amplia.

`claude plugin test` usa o [test kit oficial de Mods](https://code.claude.com/docs/en/plugins/mods/test).
Os dois testes de contrato simulam respostas do coletor: verificam o resumo de
atividade de uma suíte longa e a repetição de uma consulta que falhou, sem novo
start ou cancelamento. Esses testes locais não executam modelo nem suíte real;
o workflow Quality executa os testes do coletor, mas ainda não instala o Claude.

Na preparação desta versão, `scripts/check.py --smoke --pytest` passou no
checkout independente: gates estáticos, unittest (pass/fail/skip), cancelamento
e pytest (pass/fail/skip), incluindo um diretório com espaços.

O [workflow Quality](../.github/workflows/quality.yml) define duas combinações:
Node 14.0.0/Python 3.8/pytest 8.3.5 e Node 24/Python 3.14/pytest 9.1.1, além de
Gitleaks nos arquivos e em todo o histórico. A
[primeira execução remota](https://github.com/fabiopbarbieri/claude-test-progress/actions/runs/37236035815)
passou nos três jobs para o SHA `9c1cafe0606852a6a47ffd90eb6b8dbab187643d`.
Consulte sempre o resultado do SHA que pretende usar na aba Actions.

## Aceite ainda pendente

- Interface interativa: aparência, teclado, callbacks dos botões, `/clear`,
  `/resume`, `/branch` e hot reload em uma sessão de uso real.
- Windows nativo/PowerShell 5.1: Job Objects, ACLs, Registro/nvm-windows,
  quoting de wrappers e cancelamento. Revisão estática e Linux não provam Win32.
- Apps reais Java/Surefire e Angular/Karma/browser, forks/módulos e toolchains
  específicas. O listener JUnit e o reporter não foram aceitos em todos esses
  cenários só pela existência de código ou compilação.
- Pytest 7 como versão mínima: sintaxe e APIs revisadas, mas ainda sem uma
  combinação pytest 7 no CI. Python 3.8 passou com pytest 8.3.5; isso não comprova
  todas as combinações de versões possíveis.

## Referências de distribuição

- [Manifest do marketplace e fontes relativas](https://code.claude.com/docs/en/plugins/marketplace-reference).
- [CLI de validação, instalação e atualização](https://code.claude.com/docs/en/plugins/cli-reference).
- [Carregamento local versus cópia em cache](https://code.claude.com/docs/en/plugins/loading).
- [Requisitos e estrutura de Mods](https://code.claude.com/docs/en/plugins/mods/create).

O marketplace deste repositório é independente. A instalação por ele não
significa aprovação ou inclusão no catálogo oficial da Anthropic.
