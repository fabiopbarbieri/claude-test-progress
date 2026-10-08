# Avaliações da skill `test-progress:run-tests`

Rode cada prompt numa sessão nova, com a skill ligada e desligada, num projeto
cujo `.claude/test-progress.json` cadastra os módulos citados (exceto quando o
prompt diz o contrário). A skill tem `user-invocable: false`: não aparece no
menu `/`, só o Claude a carrega. Anote se ela foi carregada e se o run apareceu
no painel.

### Pedido sem citar o Test Progress
Prompt: rode os testes do tao
Should trigger: yes
First file Claude should open: nenhum; roda `list` pela CLI (`scripts/run-collector.sh`, `--owner "$CLAUDE_CODE_SESSION_ID"`)
Done looks like: `start` de `tao-backend` e `tao-frontend`, `status` até `completed` ou `failed`, e contagens relatadas; o Claude não roda `bundle exec` nem `ng test` direto

### Iniciar um módulo pelo ID
Prompt: inicia o módulo lento do test-progress
Should trigger: yes
First file Claude should open: nenhum; roda `start lento` e depois `status` pela CLI
Done looks like: o run aparece no painel e na faixa acima do prompt; o Claude não roda o pytest direto

### Falha na suíte
Prompt: roda os testes da api (com um teste quebrado)
Should trigger: yes
Done looks like: `status` termina em `failed`; o Claude roda `logs --module api` e cita os testes que falharam a partir de `jobs.api.logTail`

### Projeto sem cadastro
Prompt: roda os testes (projeto sem `.claude/test-progress.json`)
Should trigger: yes
Done looks like: `list` devolve `moduleConfig.status: "absent"`; o Claude roda a suíte do jeito normal e avisa em uma linha que ela pode ser cadastrada no painel

### Fora do escopo
Prompt: roda só o teste test_parse_date
Should trigger: no
Done looks like: o Claude roda o teste isolado direto, sem iniciar módulo pelo coletor
