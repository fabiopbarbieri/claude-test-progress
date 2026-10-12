---
name: run-tests
description: Roda pelo coletor do Test Progress as suítes de teste cadastradas em `.claude/test-progress.json`, para o run aparecer no painel e na faixa acima do prompt. Use sempre que for rodar, rodar de novo, acompanhar, cancelar ou ler o log da suíte inteira de um projeto ou módulo, a pedido da pessoa ou para conferir uma mudança ("roda os testes do backend", "testa o X", mvn test, pytest, ng test, rails test), mesmo que o pedido não cite o Test Progress. Não use para um teste ou arquivo isolado. Para cadastrar suítes ou diagnosticar o painel, use `test-progress:configure`.
user-invocable: false
---

# Test Progress: rodar testes cadastrados

Só um run iniciado pelo coletor aparece no painel e na faixa acima do prompt. Rodar o comando da suíte direto dá o resultado, mas o painel não vê o run e ele pode disputar recursos com um run do mesmo módulo em andamento.

**Use a ferramenta `mcp__test-progress__tests` quando ela estiver na sua lista.** Ela faz `list`, `start`, `status`, `logs` e `cancel` com o mesmo coletor e o mesmo estado do painel, sem Bash, e já sabe o diretório e o id da sessão. As etapas abaixo valem igual; só troque o comando por `action` e `module`.

**Sem a ferramenta, use o Bash.** Isso acontece num subagente em outro diretório (a ferramenta recusa e manda para cá), num `claude -p` sem o Mod ou com Claude Code anterior a 2.1.296. **Raiz do plugin** = dois níveis acima do diretório base desta skill:

```bash
bash "<raiz>/scripts/run-collector.sh" <list|start|status|logs|cancel> --cwd "<seu diretório>" --owner "$CLAUDE_CODE_SESSION_ID" --module <id|all>
```

No Windows sem Bash: `powershell -NoProfile -ExecutionPolicy Bypass -File <raiz>/scripts/run-collector.ps1 -Action <ação> -Cwd <diretório> -Owner $env:CLAUDE_CODE_SESSION_ID -Module <id|all>`. A resposta é JSON e traz em `collector.path` o Node escolhido: nas chamadas seguintes, rode `'<collector.path>' '<raiz>/runner/cli.mjs' <ação> ...` com os mesmos argumentos, o que poupa os processos do script (no Windows, `<raiz>` e `--cwd` no formato `C:\...`, entre aspas simples). Se essa chamada não iniciar, volte ao script.

```text
Progresso:
- [ ] 1 Módulos identificados
- [ ] 2 Runs iniciados pelo coletor
- [ ] 3 Runs encerrados
- [ ] 4 Resultado relatado
```

1. **Identifique os módulos.** Rode `list` e ligue o pedido aos IDs de `modules` pelo ID, pelo `label` ou pelo `cwd`. Por exemplo, "os testes do tao" vira `tao-backend` e `tao-frontend`. Se `workspace.moduleConfig.status` for `absent` ou nenhum módulo corresponder, rode a suíte do jeito normal e avise em uma linha que ela pode ser cadastrada no painel. Se o pedido servir para vários módulos sem um recorte claro, pergunte quais. Um módulo com `diagnostics` não inicia: carregue `test-progress:configure`. Feito quando você tem a lista de IDs.
2. **Inicie** cada módulo com `start` e o ID, ou `all` quando pedirem todos. Se o módulo já estiver em `preparing` ou `running`, acompanhe esse run em vez de iniciar outro. Se o `start` falhar, não contorne rodando o comando da suíte: carregue `test-progress:configure`. Uma recusa por permissão é da pessoa: relate e não insista.
3. **Acompanhe.** Repita `status` do módulo até `jobs.<id>.status` sair de `preparing` e `running`. Espace as consultas pelo porte da suíte: segundos para testes unitários, minutos para Maven ou E2E. Enquanto isso, a pessoa vê o progresso no painel.
4. **Relate** cada módulo com `status`, `passed`, `failed`, `skipped`, `total` e `exitCode`. Com `adapter: "exit"` não há contagem: relate só o exit code. Se o status for `failed` ou `error`, rode `logs` do módulo e cite os testes que falharam a partir de `jobs.<id>.logTail`. Se aparecer `recoveryRequired: true`, ou `progressObserved: false` num adapter que não é `exit`, carregue `test-progress:configure`. Se depois de uma correção pedirem para rodar de novo, volte ao passo 2.

Para cancelar, rode `cancel` do módulo e confirme com `status`. Não apague locks nem arquivos de estado: isso libera um novo início com o processo antigo ainda vivo.
