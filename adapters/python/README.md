# Python: pytest e unittest

[Compatibilidade e versões testadas](../../docs/COMPATIBILITY.md) ·
[Uso e atualização de caminhos](../../docs/USAGE.md) ·
[Diagnóstico](../../docs/TROUBLESHOOTING.md)

`run.py` executa o runner no Python escolhido pelo projeto e acrescenta eventos
de progresso ao stdout. Mantém a saída normal nos logs e o resultado do runner.
Não instala pacotes, não ativa outro ambiente e não altera arquivos do projeto.
O coletor continua usando seu próprio Node 14+.

Requisitos: Python **3.8+**; para pytest, **pytest 7+** já disponível nesse mesmo
ambiente. Unittest usa somente a biblioteca padrão. As versões efetivamente
verificadas estão em [VERIFICATION](../../docs/VERIFICATION.md).

## Configurar

Adapte [config.python.example.json](../../config.python.example.json) para
`<diretório da sessão>/.claude/test-progress.json`. O caminho de `run.py` precisa
apontar para esta instalação: consulte `/test-progress paths` e substitua o
caminho de exemplo pelo caminho Python informado. O interpretador e `tests`
pertencem ao seu app:

```json
{
  "schemaVersion": 2,
  "modules": {
    "python": {
      "label": "Python",
      "runtime": "inherit",
      "command": [
        ".venv/bin/python",
        "/caminho/absoluto/claude-test-progress/adapters/python/run.py",
        "pytest",
        "-q",
        "tests"
      ],
      "cwd": ".",
      "adapter": "events",
      "env": {}
    }
  }
}
```

Depois execute `/test-progress start python`. Consulte `status python`,
`logs python` e `cancel python`. `start all` seleciona somente módulos
habilitados do workspace. Você pode cadastrar vários módulos Python com IDs
distintos, sem depender de Node do app: este exemplo usa `runtime: "inherit"`.

Para unittest, mantenha interpretador/caminho e substitua os argumentos a partir
de `pytest` por:

```json
["unittest", "discover", "-s", "tests", "-v"]
```

Também aceita nomes de módulos/classes/métodos e os filtros do runner:
`pytest -k nome`, `pytest tests/test_exemplo.py::test_caso`,
`unittest tests.test_exemplo.Classe.test_caso`. Opções após `pytest`/`unittest`
são repassadas ao runner, inclusive as de captura e parada na primeira falha.
`cwd` é relativo ao diretório da sessão; interpretador relativo é resolvido no
`cwd` do módulo. Use caminho absoluto quando o ambiente estiver em outro local.

Se o ambiente virtual já estiver ativo no terminal que abriu o Claude, pode
usar `python` em vez de `.venv/bin/python`. Para ambientes geridos por ferramentas,
o argv pode começar com `uv run --no-sync python` ou `poetry run python`, seguido
do caminho de `run.py` e dos argumentos. Dependências e políticas dessas
ferramentas continuam sob responsabilidade do projeto.

No Windows, adapte [o exemplo próprio](../../config.python.windows.example.json):
use `.venv\\Scripts\\python.exe` e caminho absoluto Windows para `run.py`, com
barras escapadas no JSON. Passe cada argumento como um elemento; caminhos com
espaço não precisam de aspas adicionais. Não execute o arquivo `.py` diretamente.
O aceite nativo Windows permanece pendente, conforme [WINDOWS.md](../../WINDOWS.md).

## Contagem

- **Pytest:** cada item selecionado após a coleta é um caso; parametrizações
  contam separadamente. Setup, corpo e teardown contribuem para um único
  resultado, com erro/falha prevalecendo. Skip e xfail contam como ignorados;
  XPASS comum passa, e XPASS strict falha, conforme o relatório do pytest.
- **Unittest:** cada execução de método é um caso. Subtests não aumentam o
  total; falha/erro em qualquer subtest faz o método falhar. Expected failure
  conta como ignorado; unexpected success conta como falha. Se houver subtest
  ignorado e nenhum falho, o método conta como ignorado.
- **Coleta e interrupção:** total desconhecido permanece `null`; parada antes
  de executar todos os itens não fabrica 100%. `--collect-only` do pytest
  informa os selecionados, sem declará-los executados. Código de saída continua
  determinando o estado do comando, inclusive erros de coleta e dependência.
- **Captura:** eventos usam uma cópia do descritor stdout original, com flush a
  cada emissão. Assim continuam visíveis com captura padrão do pytest e `-b`
  do unittest, sem desativar a captura do código sob teste.

O coletor mantém a indicação de total parcial até o comando terminar com êxito.
Percentual é quantidade resolvida, não cobertura de código ou tempo restante.

## Limites

Esta integração executa pytest **serial**. Execução distribuída via pytest-xdist
é recusada antes dos testes; use a configuração serial do projeto. Plugins que
substituem o protocolo de execução, watch e runners como tox/nox não têm
integração própria. Para estes, configure o adaptador dentro de cada comando
Python que efetivamente roda os testes, preservando o ambiente do projeto.
Coletas com identificadores repetidos também são recusadas, para evitar
confundir testes distintos com novas tentativas do mesmo teste.

Erros/skip em fixtures de classe ou módulo do unittest podem ocorrer sem iniciar
um método. O adaptador registra o diagnóstico e deixa o total desconhecido, sem
contar o container como teste nem atribuir resultados a métodos não executados.
Os logs e o exit code preservam o resultado nativo. Erros de importação durante
discovery são reportados pelo unittest.

## Fontes primárias

- [pytest: hooks de coleta, relatórios e encerramento](https://pytest.org/en/stable/reference/reference.html).
- [pytest: plugins explícitos](https://www.pytest.org/en/latest/how-to/writing_plugins.html).
- [Python: TestResult, TextTestRunner e interface unittest](https://docs.python.org/3/library/unittest.html).
