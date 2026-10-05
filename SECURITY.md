# Segurança e privacidade

O Test Progress não precisa de uma chave de API própria. O coletor executa os
comandos que você configura, com as permissões do seu usuário, e herda o
ambiente do Claude. Não execute configurações de terceiros sem revisá-las.

Configuração, registry e logs são locais. Templates não ativam comandos sozinhos;
o workspace escolhe explicitamente quais módulos executar. O catálogo público
omite env/command e diagnósticos de configuração não incluem stderr privado.
 O comando, o diretório, a revisão Git e a saída
dos testes podem conter dados privados. Variáveis configuradas em `env` ficam
no arquivo temporário privado do job enquanto ele está ativo; esse arquivo é removido
quando o worker encerra normalmente. Estado de recuperação pode conservar esse
arquivo até comprovar a árvore vazia. Logs não têm redação automática. Não
coloque credenciais em argumentos ou exemplos versionados; não compartilhe logs
ou screenshots sem revisão. `--text` leva o resumo/log para a conversa Claude.

O estado usa diretório temporário privado por usuário/projeto/sessão: permissões
0700/0600 no Linux e DACL privada na implementação Windows. A validação nativa
Windows será feita quando o ambiente for disponibilizado. Os comandos dos testes e o build JUnit podem acessar a
rede; o coletor não implementa envio de telemetria ou logs a uma API.

Este repositório usa histórico novo, revisão do conjunto exportado e Gitleaks
sobre arquivos e histórico. O workflow Quality repete a busca em pushes e PRs,
com resultados redigidos e sem publicar relatórios que possam conter segredos.
Essas verificações detectam padrões conhecidos; não são uma promessa de detecção
universal. `.gitignore` não remove dados já commitados.

Para comunicar uma vulnerabilidade, use o
[canal privado de segurança do repositório](https://github.com/fabiopbarbieri/claude-test-progress/security/advisories/new)
(**Security → Report a vulnerability**). Não publique detalhes sensíveis em uma
issue. Credenciais expostas devem ser revogadas antes de compartilhar qualquer
reprodução sanitizada.
