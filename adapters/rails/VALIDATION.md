# Verificação do adaptador Rails

O gate é `python3 scripts/check-rails.py`. O argumento `--ruby /path/to/ruby`
seleciona outro executável. Instale previamente no ambiente escolhido Rails,
Minitest 5 ou 6, mutex_m, Capybara e Selenium WebDriver; o script não instala dependências.
`RAILS_VERSION` fixa a versão usada pela fixture quando houver várias instaladas.

O script cria e remove um app Rails temporário em caminho com espaços, com
Gemfile/Bundler, `bin/rails`, controller, view inline, testes Minitest e system
tests. Não usa banco de dados nem aplicações ou credenciais externas. Compara
os códigos de saída adaptados com os comandos Rails nativos e verifica o
protocolo pelo stdout e pelo coletor real.

Cenários: pass/failure/error/skip, seleção do bundle antes de ativar gems,
descoberta nativa de plugins e `--no-plugins`,
filtros por nome e arquivo:linha, fail-fast, controller/view, system com
`rack_test`, `test:all`, processos e threads, seleção vazia, captura de stdout,
mesma ordem com seed fixo, resultados e cancelamento no coletor, `Interrupt`,
skip seguido de erro em teardown e falhas de load/boot. O total permanece
desconhecido nos encerramentos incompletos.

O workflow [Rails adapter](../../.github/workflows/rails.yml) cobre Linux com
Rails 7.2.4/Ruby 3.3/Minitest 5.20.0, Rails 8.0.5.1/Ruby 3.4/Minitest 5.27.0
e Rails 8.1.4/Ruby 3.4 com Minitest 5.27.0 e 6.0.6. O estado de cada execução do GitHub Actions é a evidência de CI;
a presença do workflow não significa que uma execução passou.

Aceite local observado: Linux, Ruby 3.4.10, Rails 8.1.3.1 e Minitest 5.20.0/5.25.4;
Linux, Ruby 4.0.7, Rails 8.1.4 e Minitest 5.27.0/6.0.6.
Não há aceite nativo Windows/macOS nem de browsers Selenium/JavaScript.
Os system tests do gate usam Capybara `rack_test`.
