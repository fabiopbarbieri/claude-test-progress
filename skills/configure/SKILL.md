---
name: configure
description: Configura e diagnostica o Test Progress. Use ao criar ou editar `.claude/test-progress.json`, ao cadastrar uma suíte de testes no painel (pytest, unittest, RSpec, Rails/Minitest, Maven/JUnit, Karma/Angular ou um comando qualquer), ou quando o painel mostra erro, diagnóstico ou "sem eventos de progresso".
---

# Test Progress: configurar e diagnosticar

**Raiz do plugin** = dois níveis acima do diretório base desta skill. Todo caminho de adapter no `command` é absoluto a partir dela: o JSON não interpola variáveis, `~` nem shell.

Você edita a configuração; quem inicia testes é a pessoa. Os comandos `/test-progress` são dela: peça que rode e leia o resultado que ela trouxer.

## Cadastrar módulos

1. Abra `.claude/test-progress.json` no **diretório da sessão** (o cwd atual, não a raiz Git). Se existir, preserve os módulos e as chaves que já estão lá.
2. Para cada suíte, monte o módulo pela tabela. Use o Python ou Ruby do projeto (por exemplo `.venv/bin/python`) quando houver um.

   | Suíte | `command` (argv, um item por argumento) | `adapter` | `runtime` |
   | --- | --- | --- | --- |
   | pytest | `[python, <raiz>/adapters/python/run.py, pytest, -q, tests]` | `events` | `inherit` |
   | unittest | `[python, <raiz>/adapters/python/run.py, unittest, discover, -s, tests, -v]` | `events` | `inherit` |
   | RSpec | `[bundle, exec, ruby, <raiz>/adapters/ruby/run.rb, rspec, spec]` | `events` | `inherit` |
   | Rails / Minitest | `[bundle, exec, ruby, <raiz>/adapters/rails/run.rb, test]` | `events` | `inherit` |
   | Maven / JUnit 5 | `[./mvnw, test]` | `maven`, ou `events` com o listener de `adapters/junit/README.md` | `inherit` |
   | Karma / Angular | `[node, ./node_modules/@angular/cli/bin/ng, test, --watch=false, --browsers=ChromeHeadless]` | `karma`, ou `events` com o reporter de `adapters/karma/README.md` | `node-project` |
   | Sem integração (script, lint, `claude plugin test`) | o próprio comando | `exit` | `inherit` |

   `exit` decide ✓/✗ pelo exit code, sem contagem. Use-o quando a suíte não tem adapter.
3. Para qualquer campo além de `label`, `command`, `cwd`, `adapter`, `runtime` e `order` (`env`, `extends`, templates, limites de ID), leia antes a seção "Configurar seu projeto" de `<raiz>/docs/USAGE.md`.
4. **Feito** quando estas quatro coisas forem verdade:
   - `python3 -m json.tool .claude/test-progress.json` aceita o arquivo;
   - `schemaVersion` é `1`;
   - todo caminho absoluto do `command` existe;
   - todo `cwd` existe a partir do diretório da sessão.

   Então peça à pessoa `/test-progress list`. Ele mostra o catálogo e os diagnósticos sem iniciar nada.

## Diagnosticar o painel

Trabalhe pelo sintoma que a pessoa relatar ou mostrar:

| Sintoma no painel | Causa | Ação |
| --- | --- | --- |
| "sem eventos de progresso reconhecidos" | O comando não emite o que o adapter entende | Envolva o comando com o adapter da tabela, ou troque para `adapter: "exit"` |
| `!` com "órfão: processo ainda vivo" | O processo sobreviveu ao fim do run | `■` no painel ou `/test-progress cancel <id>` |
| "Configuração: …" ou diagnóstico no módulo | Campo inválido; a mensagem nomeia o campo | Corrija pela tabela de campos em `docs/USAGE.md` |
| `▶` apagado / "Início indisponível" | Módulo desativado, com diagnóstico ou já rodando | Resolva o diagnóstico mostrado logo abaixo do módulo |
| `~` antes do percentual | Total parcial; ele ainda pode crescer | Nada; é o normal durante a execução |

Para ler a saída da suíte, peça `/test-progress logs <id> --text`. Ele traz as últimas linhas, sem as do protocolo. Para sintomas fora da tabela, siga `<raiz>/docs/TROUBLESHOOTING.md`.
