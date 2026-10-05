# Claude Test Progress

![Capa ilustrativa do Claude Test Progress, com progresso de backend e frontend](docs/assets/cover.png)

**Acompanhe seus testes no Claude Code enquanto eles rodam em segundo plano.**
O plugin `test-progress` mostra contadores, estado e logs em duas áreas: backend
e frontend. É um [Claude Code Mod](https://code.claude.com/docs/en/plugins/mods/create)
independente da Anthropic. Versão **0.1.0**, licença **MIT**.
A capa é uma ilustração; a interface real é um painel de terminal.

## Funcionalidades e limites

- Início explícito, consulta de estado e cancelamento dos jobs da sessão.
- Painel e resumo acima do prompt atualizados a cada segundo; saída `--text`.
- Logs locais, sinal de atividade e demo sintética sem suíte do app.
- Node do coletor separado do Node do frontend, respeitando a `.nvmrc` do app.

Percentual é **testes resolvidos / total conhecido**, incluindo ignorados.
Total desconhecido não é zero; total parcial pode crescer. **100% não comprova
encerramento nem sucesso**: confira estado, falhas e código de saída. Não há
cobertura de código, estimativa de tempo ou integração automática com uma CI.

## Compatibilidade resumida

| Base ou integração | Alcance e limite |
| --- | --- |
| Claude Code / coletor | Claude **2.1.287+**, Node **14+**; Claude 2.1.289 observado em Linux |
| Linux / WSL / Windows | Linux exercitado; WSL usa o caminho Linux, sem aceite próprio; Windows implementado, aceite nativo pendente |
| Python | Python 3.8+, pytest 7+ declarado ou unittest; execução serial em backend |
| Ruby / RSpec | Ruby 3.1+, RSpec Core 3.13.x; execução serial em backend |
| Rails / Minitest | Rails 7.2/8.0/8.1, Minitest >=5.20 e <6; views/system em backend; `rack_test` não prova Selenium |
| Java / JUnit 5 | Fallback Maven ou listener opcional; integração real JUnit ausente da CI atual |
| Angular / Karma | Reporter ou fallback de logs; contratos conferidos, navegador real pendente |

Veja [versões testadas, CI e evidências por SHA](docs/COMPATIBILITY.md).
Frontend prepara Node/.nvmrc; runners desconhecidos não ganham integração automática.

## Requisitos

Claude Code com Mods permitido no ambiente e Node 14+ para o coletor.
Linux/WSL usa Bash; descoberta nvm usa GNU `sort -V`. Windows usa PowerShell
5.1 ou 7. Core e demo não exigem Python, Ruby, Java ou Karma nem `npm install`.
Para testes reais, **as dependências da suíte escolhida pertencem ao seu app**;
o plugin não instala runners, browsers ou runtimes.

## Instalar e experimentar

No Claude Code, com acesso SSH ao GitHub configurado:

```text
/plugin marketplace add git@github.com:fabiopbarbieri/claude-test-progress.git
/plugin install test-progress@test-progress-marketplace
/reload-plugins
/test-progress help
/test-progress paths
/test-progress demo
/test-progress status
```

O marketplace próprio se chama `test-progress-marketplace`. A demo ocupa as áreas
da sessão e simula backend 8/8 com uma falha (exit 1), frontend 12/12 com um
ignorado (exit 0). Aguarde o término; esses números não são testes do seu app.
Instalação pelo terminal, clone SSH e `--plugin-dir`: [guia de uso](docs/USAGE.md).

## Configuração mínima

Crie `.claude/test-progress.json` no diretório em que abriu a sessão. Exemplo
para um app Maven que já possui `mvnw` executável na raiz, em Linux/WSL:

```json
{
  "schemaVersion": 1,
  "backend": {
    "command": ["./mvnw", "test"],
    "cwd": ".",
    "adapter": "maven",
    "env": {}
  }
}
```

`command` é **argv**: um elemento por argumento, sem expansão de shell ou de
`CLAUDE_PLUGIN_ROOT` no JSON. `cwd` é relativo à sessão. Para adaptadores, use
os caminhos absolutos de `/test-progress paths` e os [exemplos por runner](adapters/README.md).
Somente backend ignora frontend; `all` exige as duas configurações.
[Configuração detalhada](docs/USAGE.md#configurar-seu-projeto) · [Windows](WINDOWS.md).

## Comandos

| Comando | Ação |
| --- | --- |
| `/test-progress` ou `/test-progress status` | Abre/atualiza o painel sem iniciar testes |
| `/test-progress help` / `paths` | Ajuda / caminhos da instalação ativa |
| `/test-progress demo [backend\|frontend\|all]` | Progresso sintético |
| `/test-progress backend`, `frontend` ou `all` | Inicia a suíte configurada |
| `/test-progress logs backend` / `logs frontend` | Consulta o log de cada área |
| `/test-progress cancel [backend\|frontend\|all]` | Solicita cancelamento na sessão responsável |

Acrescente `--text`, por exemplo `/test-progress status --text`.
[Suítes demoradas, owners e recuperação](docs/USAGE.md#testes-demorados-e-consultas-pelo-claude).

## Atualizar ou remover

**Primeiro conclua ou cancele os jobs em cada sessão responsável e confirme o
estado terminal, sem recuperação pendente.** Fechar o painel, reload ou uninstall
não para processos detached nem comprova limpeza dos logs fora do cache.

```bash
claude plugin marketplace update test-progress-marketplace
claude plugin update test-progress@test-progress-marketplace --scope user
```

Para remover, em vez de atualizar:

```bash
claude plugin uninstall test-progress@test-progress-marketplace --scope user
```

Ajuste o escopo instalado. Após atualizar, use `/reload-plugins` (ou reinicie),
reconsulte `/test-progress paths` e ajuste os caminhos dos adaptadores no app.
[Procedimentos completos](docs/USAGE.md#atualizar-com-jobs-encerrados).

## Guias

[Uso](docs/USAGE.md) · [Compatibilidade](docs/COMPATIBILITY.md) ·
[Diagnóstico](docs/TROUBLESHOOTING.md) · [Windows](WINDOWS.md) · [Angular 9](ANGULAR9.md) ·
[Verificação](docs/VERIFICATION.md) · [Segurança](SECURITY.md) ·
[Contribuição](CONTRIBUTING.md) · [Extensões](docs/EXTENDING.md) ·
[CI e governança](docs/CI-GOVERNANCE.md) · [Licença MIT](LICENSE).
