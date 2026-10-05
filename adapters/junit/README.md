# Listener JUnit 5

[Compatibilidade e versões testadas](../../docs/COMPATIBILITY.md) ·
[Uso e atualização de caminhos](../../docs/USAGE.md) ·
[Diagnóstico](../../docs/TROUBLESHOOTING.md)

`local.claude.progress.TestProgressListener` usa JUnit Platform 1.11.3 e bytecode
Java 11. Não inclui engine de testes, não executa testes e não altera o resultado
da execução. A descoberta automática usa
`META-INF/services/org.junit.platform.launcher.TestExecutionListener`.

## Compilar o adaptador

Sem Maven instalado, com JDK 11+ e curl:

```bash
bash ./build.sh
```

Execute dentro de `adapters/junit`. O script baixa somente JARs necessários,
com versões fixas, do Maven Central, caso ainda não existam em `build/deps`:
launcher/engine/commons 1.11.3, opentest4j 1.3.0 e apiguardian-api 1.1.2.
Compila com `javac --release 11` e gera
`build/test-progress-listener-0.1.0.jar`, sem embutir essas dependências.
`build/` é ignorado pelo Git. As dependências devem existir no runtime do app.

O `pom.xml` também permite empacotamento com Maven. A propriedade
`junit.platform.version` deve acompanhar a versão do app real; o launcher está
em `provided`, para não impor uma versão transitiva ao app. O build auxiliar tem
versões fixas: ajuste deliberadamente o script caso compile para outra versão.

## Opt-in em um projeto Maven existente

Use `/test-progress paths` para localizar `adapters/junit/pom.xml` e o diretório
do adaptador instalado. Depois de compilar, instale o JAR no repositório Maven
local (este comando apenas instala o artefato já compilado):

```bash
mvn install:install-file \
  -Dfile=/caminho/absoluto/adapters/junit/build/test-progress-listener-0.1.0.jar \
  -DpomFile=/caminho/absoluto/adapters/junit/pom.xml
```

Adicione ao `pom.xml` do app como dependência de **testes**:

```xml
<dependency>
  <groupId>local.claude</groupId>
  <artifactId>test-progress-listener</artifactId>
  <version>0.1.0</version>
  <scope>test</scope>
</dependency>
```

O app precisa usar o provider JUnit Platform do Surefire/Failsafe e ter seu
launcher/engine compatível disponível. Alinhe a Platform à versão gerenciada pelo
app (1.11.3 corresponde à linha JUnit 5.11.3); a integração não precisa alterar as versões
gerenciadas pelo app. Autoregistro de listeners deve permanecer habilitado. Não há suporte
declarado para runner JUnit 4 tradicional nem aceite do engine Vintage.

Capture stdout sem `redirectTestOutputToFile=true` e sem redirecionamentos que
ocultem as linhas do listener do runner. Capture o stdout dos forks também; cada
plano recebe um UUID diferente, inclusive entre forks e módulos. Nomes de testes,
motivos de skip e exceções não são escritos no evento.

## Módulo no coletor v2

Declare um módulo em `.claude/test-progress.json`; o listener continua sendo
opt-in no app. ID e label não escolhem runtime ou adapter:

```json
{
  "schemaVersion": 2,
  "modules": {
    "api": {
      "command": ["./mvnw", "test"],
      "runtime": "inherit",
      "adapter": "events"
    }
  }
}
```

Use `/test-progress start api`, `status api`, `logs api` e `cancel api`.
Sem listener, `adapter: "maven"` oferece somente fallback de resumos do Maven.
Vários módulos JVM podem usar IDs distintos; `start all` seleciona todos os
habilitados. O registry opcional não ativa módulos sozinho. Não há conversão v1.
Aceite nativo Windows v2 continua dependente de seus gates próprios.

## Contagem e limites

Somente identificadores `isTest()` sem filhos entram nos contadores. O plano
inicial define o total; novos testes dinâmicos aumentam essa contagem. O total
fica parcial até `testPlanExecutionFinished`, quando se estabiliza para esse plano.
Outcomes `SUCCESSFUL`/`FAILED`/`ABORTED` viram passed/failed/skipped. Containers
ignorados resolvem suas folhas conhecidas como skipped; IDs impedem contagem dupla.
Callbacks e escrita de linhas são sincronizados para execução paralela.

Falhas de container (por exemplo, preparação de classe) não viram testes fictícios:
podem fechar o plano com `resolved < total`. O runner deve conservar o exit code
e os logs do comando. Queda da JVM pode impedir o snapshot final. Módulos ainda
não planejados não entram no total conhecido: a UI deve indicar **parcial**.

Compilação e inspeção do JAR verificam API e empacotamento; não demonstram aceite
em Surefire, forks ou um app real. A documentação inicial do protótipo registrava
apenas essas checagens. Consulte [VERIFICATION](../../docs/VERIFICATION.md) para
os gates atuais e os limites da integração.

## Fontes primárias

- [TestExecutionListener 5.11.3: eventos, paralelismo e containers ignorados](https://docs.junit.org/5.11.3/api/org.junit.platform.launcher/org/junit/platform/launcher/TestExecutionListener.html).
- [TestPlan 5.11.3: contagem, filhos e descendentes](https://docs.junit.org/5.11.3/api/org.junit.platform.launcher/org/junit/platform/launcher/TestPlan.html).
- [LauncherFactory 5.11.3: registro automático de listeners](https://docs.junit.org/5.11.3/api/org.junit.platform.launcher/org/junit/platform/launcher/core/LauncherFactory.html).
- [Maven Surefire: JUnit Platform](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html).
