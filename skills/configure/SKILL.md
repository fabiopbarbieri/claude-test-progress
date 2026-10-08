---
name: configure
description: Configura e diagnostica o Test Progress. Use ao criar ou editar `.claude/test-progress.json`, ao cadastrar uma suíte de testes no painel (pytest, unittest, RSpec, Rails/Minitest, Maven/JUnit, Karma/Angular, Playwright Test ou um comando qualquer), ou quando o painel mostra erro, diagnóstico ou "sem eventos de progresso".
---

# Test Progress: configurar e diagnosticar

**Raiz do plugin** = dois níveis acima do diretório base desta skill. Todo caminho de adapter no `command` é absoluto a partir dela: o JSON não interpola variáveis, `~` nem shell.

O modelo não consegue chamar o slash command `/test-progress`; só a pessoa consegue. Rode as ações pela CLI do plugin, que usa o mesmo estado do painel desta sessão (cwd + id da sessão):

```bash
bash <raiz>/scripts/run-collector.sh <list|start|status|logs|cancel> --cwd <diretório da sessão> --owner "$CLAUDE_CODE_SESSION_ID" --module <id|all>
```

No Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <raiz>/scripts/run-collector.ps1 -Action <ação> -Cwd <diretório> -Owner $env:CLAUDE_CODE_SESSION_ID -Module <id|all>`. A resposta é JSON: `modules.<id>.diagnostics`, `jobs.<id>.status`, `jobs.<id>.logTail` e `jobs.<id>.recoveryRequired`. `list` e `status` não iniciam nada; `start` dispara a suíte de verdade.

## Cadastrar módulos

1. Abra `.claude/test-progress.json` no **diretório da sessão** (o cwd atual, não a raiz Git). Se existir, preserve os módulos e as chaves que já estão lá.
2. O arquivo tem esta forma. Cada chave de `modules` é o ID do módulo: 1 a 48 caracteres, minúscula no início, depois minúsculas, números ou `-`. `all` e nomes de dispositivo do Windows (`con`, `nul`, `com1`…) são reservados.

   ```json
   { "schemaVersion": 1, "modules": { "api": { "label": "API", "command": ["./mvnw", "test"], "cwd": ".", "adapter": "maven", "runtime": "inherit" } } }
   ```

   Para cada suíte, monte o módulo pela tabela. Use o Python ou Ruby do projeto (por exemplo `.venv/bin/python`) quando houver um.

   | Suíte | `command` (argv, um item por argumento) | `adapter` | `runtime` |
   | --- | --- | --- | --- |
   | pytest | `[python, <raiz>/adapters/python/run.py, pytest, -q, tests]` | `events` | `inherit` |
   | unittest | `[python, <raiz>/adapters/python/run.py, unittest, discover, -s, tests, -v]` | `events` | `inherit` |
   | RSpec | `[bundle, exec, ruby, <raiz>/adapters/ruby/run.rb, rspec, spec]` | `events` | `inherit` |
   | Rails / Minitest | `[bundle, exec, ruby, <raiz>/adapters/rails/run.rb, test]` | `events` | `inherit` |
   | Maven / JUnit 5 | `[./mvnw, test]` | `maven`, ou `events` com o listener de `adapters/junit/README.md` | `inherit` |
   | Karma / Angular | `[node, ./node_modules/@angular/cli/bin/ng, test, --watch=false, --browsers=ChromeHeadless]` | `karma`, ou `events` com o reporter de `adapters/karma/README.md` | `node-project` |
   | Playwright Test | `[npx, --no-install, playwright, test, --reporter=list,<raiz>/adapters/playwright/reporter.cjs]` | `events` | `node-project` |
   | Sem integração (script, lint, `claude plugin test`) | o próprio comando | `exit` | `inherit` |

   `exit` decide ✓/✗ pelo exit code, sem contagem. Use-o quando a suíte não tem adapter.

   No Windows, leia antes `<raiz>/WINDOWS.md`: o Maven vira `".\\mvnw.cmd"`, e `.cmd`/`.bat` seguem um contrato de argumentos restrito.
3. Para qualquer campo além de `label`, `command`, `cwd`, `adapter`, `runtime` e `order` (`env`, `extends`, templates), leia antes a seção "Configurar seu projeto" de `<raiz>/docs/USAGE.md`.
4. **Feito** quando estas três coisas forem verdade:
   - `list` pela CLI devolve `workspace.moduleConfig.status: "valid"` e `diagnostics` vazio em cada módulo. Ele valida JSON, `schemaVersion`, IDs e campos;
   - todo caminho absoluto do `command` existe;
   - todo `cwd` existe a partir do diretório da sessão.

   Se alguma falhar, corrija e volte ao passo 2.

## Diagnosticar o painel

Trabalhe pelo sintoma que a pessoa relatar ou mostrar:

| Sintoma no painel | Causa | Ação |
| --- | --- | --- |
| "sem eventos de progresso reconhecidos" | O comando não emite o que o adapter entende | Envolva o comando com o adapter da tabela, ou troque para `adapter: "exit"` |
| `!` com "órfão: processo ainda vivo" | O processo sobreviveu ao fim do run | `cancel` pela CLI, depois `status`. Não apague locks nem estado: o encerramento não foi comprovado, e apagar libera um novo início com o processo antigo vivo |
| "Configuração: …" ou diagnóstico no módulo | Campo inválido; a mensagem nomeia o campo | Corrija pela tabela de campos em `docs/USAGE.md` |
| Módulo sem `▶` nem `■` | `enabled: false` | Remova `enabled: false` se a pessoa quiser rodá-lo |
| `▶` apagado / "Início indisponível" | Diagnóstico no módulo ou no cadastro, `cwd` ausente ou run anterior órfão | Resolva o diagnóstico mostrado logo abaixo do módulo; no órfão, siga a linha acima |
| `~` antes do percentual | Total parcial; ele ainda pode crescer | Nada; é o normal durante a execução |

Para ler a saída da suíte, rode `logs` pela CLI e leia `jobs.<id>.logTail`. Para sintomas fora da tabela, siga `<raiz>/docs/TROUBLESHOOTING.md`.
