---
name: run-tests
description: Roda pelo coletor do Test Progress as suítes de teste cadastradas em `.claude/test-progress.json`, para o run aparecer no painel e na faixa acima do prompt. Use sempre que for rodar, rodar de novo, acompanhar, cancelar ou ler o log da suíte inteira de um projeto ou módulo, a pedido da pessoa ou para conferir uma mudança ("roda os testes do backend", "testa o X", mvn test, pytest, ng test, rails test), mesmo que o pedido não cite o Test Progress. Não use para um teste ou arquivo isolado. Para cadastrar suítes ou diagnosticar o painel, use `test-progress:configure`.
user-invocable: false
---

# Test Progress: rodar testes cadastrados

Só um run iniciado pelo coletor aparece no painel e na faixa acima do prompt. Rodar o comando da suíte direto dá o resultado, mas o painel não vê o run e ele pode disputar recursos com um run do mesmo módulo em andamento.

**Raiz do plugin** = dois níveis acima do diretório base desta skill. Todas as ações usam a CLI do plugin, com o mesmo estado do painel desta sessão (cwd + id da sessão):

```bash
bash <raiz>/scripts/run-collector.sh <list|start|status|logs|cancel> --cwd <diretório da sessão> --owner "$CLAUDE_CODE_SESSION_ID" --module <id|all>
```

No Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <raiz>/scripts/run-collector.ps1 -Action <ação> -Cwd <diretório> -Owner $env:CLAUDE_CODE_SESSION_ID -Module <id|all>`. A resposta é JSON. `--module` aceita um ID ou `all`, então rode uma chamada por módulo.

```text
Progresso:
- [ ] 1 Módulos identificados
- [ ] 2 Runs iniciados pelo coletor
- [ ] 3 Runs encerrados
- [ ] 4 Resultado relatado
```

1. **Identifique os módulos.** Rode `list` e ligue o pedido aos IDs de `modules` pelo ID, pelo `label` ou pelo `cwd`. Por exemplo, "os testes do tao" vira `tao-backend` e `tao-frontend`. Se `workspace.moduleConfig.status` for `absent` ou nenhum módulo corresponder, rode a suíte do jeito normal e avise em uma linha que ela pode ser cadastrada no painel. Se o pedido servir para vários módulos sem um recorte claro, pergunte quais. Um módulo com `diagnostics` não inicia: carregue `test-progress:configure`. Feito quando você tem a lista de IDs.
2. **Inicie.** Rode `start --module <id>` para cada módulo, ou `--module all` quando pedirem todos. Se o módulo já estiver em `preparing` ou `running`, acompanhe esse run em vez de iniciar outro. Se o `start` falhar, não contorne rodando o comando da suíte: carregue `test-progress:configure`.
3. **Acompanhe.** Repita `status --module <id>` até `jobs.<id>.status` sair de `preparing` e `running`. Espace as consultas pelo porte da suíte: segundos para testes unitários, minutos para Maven ou E2E. Enquanto isso, a pessoa vê o progresso no painel.
4. **Relate** cada módulo com `status`, `passed`, `failed`, `skipped`, `total` e `exitCode`. Com `adapter: "exit"` não há contagem: relate só o exit code. Se o status for `failed` ou `error`, rode `logs --module <id>` e cite os testes que falharam a partir de `jobs.<id>.logTail`. Se aparecer `recoveryRequired: true`, ou `progressObserved: false` num adapter que não é `exit`, carregue `test-progress:configure`. Se depois de uma correção pedirem para rodar de novo, volte ao passo 2.

Para cancelar, rode `cancel --module <id>` e confirme com `status`. Não apague locks nem arquivos de estado: isso libera um novo início com o processo antigo ainda vivo.
