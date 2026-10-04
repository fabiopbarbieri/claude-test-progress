package local.claude.progress;

import java.io.PrintStream;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.junit.platform.engine.TestExecutionResult;
import org.junit.platform.launcher.TestExecutionListener;
import org.junit.platform.launcher.TestIdentifier;
import org.junit.platform.launcher.TestPlan;

/** Emits cumulative snapshots; it does not change execution or report test names. */
public final class TestProgressListener implements TestExecutionListener {
    private static final String PREFIX = "@@TEST_PROGRESS@@";
    private final Set<String> discovered = new HashSet<>();
    private final Set<String> resolved = new HashSet<>();
    private TestPlan plan;
    private String scope;
    private long total;
    private long passed;
    private long failed;
    private long skipped;

    @Override
    public synchronized void testPlanExecutionStarted(TestPlan testPlan) {
        plan = testPlan;
        scope = "junit:" + UUID.randomUUID();
        discovered.clear();
        resolved.clear();
        passed = failed = skipped = 0;
        total = plan.countTestIdentifiers(this::isLeafTest);
        for (TestIdentifier root : plan.getRoots()) {
            remember(root);
            for (TestIdentifier descendant : plan.getDescendants(root)) {
                remember(descendant);
            }
        }
        emit(false, "discovering");
    }

    @Override
    public synchronized void dynamicTestRegistered(TestIdentifier identifier) {
        if (plan != null && remember(identifier)) {
            total = discovered.size();
            emit(false, "executing");
        }
    }

    @Override
    public synchronized void executionStarted(TestIdentifier identifier) {
        if (plan != null && isLeafTest(identifier)) {
            remember(identifier);
            total = discovered.size();
            emit(false, "executing");
        }
    }

    @Override
    public synchronized void executionFinished(TestIdentifier identifier, TestExecutionResult result) {
        if (plan == null || !isLeafTest(identifier)) {
            return;
        }
        if (resolve(identifier, result.getStatus())) {
            emit(false, "executing");
        }
    }

    @Override
    public synchronized void executionSkipped(TestIdentifier identifier, String reason) {
        if (plan == null) {
            return;
        }
        boolean changed = resolve(identifier, TestExecutionResult.Status.ABORTED);
        // A skipped container produces no events for its children in JUnit Platform.
        for (TestIdentifier descendant : plan.getDescendants(identifier)) {
            changed |= resolve(descendant, TestExecutionResult.Status.ABORTED);
        }
        if (changed) {
            emit(false, "executing");
        }
    }

    @Override
    public synchronized void testPlanExecutionFinished(TestPlan testPlan) {
        if (plan == testPlan) {
            emit(true, "finalizing");
            plan = null;
        }
    }

    private boolean isLeafTest(TestIdentifier identifier) {
        return identifier.isTest() && plan.getChildren(identifier).isEmpty();
    }

    private boolean remember(TestIdentifier identifier) {
        return isLeafTest(identifier) && discovered.add(identifier.getUniqueId());
    }

    private boolean resolve(TestIdentifier identifier, TestExecutionResult.Status status) {
        if (!isLeafTest(identifier)) {
            return false;
        }
        remember(identifier);
        total = discovered.size();
        if (!resolved.add(identifier.getUniqueId())) {
            return false;
        }
        switch (status) {
            case SUCCESSFUL: passed++; break;
            case FAILED: failed++; break;
            case ABORTED: skipped++; break;
            default: throw new IllegalArgumentException("Unknown JUnit result status");
        }
        return true;
    }

    private void emit(boolean finished, String phase) {
        String line = PREFIX + "{\"scope\":" + jsonString(scope)
                + ",\"total\":" + total + ",\"resolved\":" + resolved.size()
                + ",\"passed\":" + passed + ",\"failed\":" + failed
                + ",\"skipped\":" + skipped + ",\"final\":" + finished
                + ",\"totalStable\":" + finished + ",\"phase\":" + jsonString(phase) + "}";
        // Synchronize on the actual stream also across listener instances in one JVM.
        PrintStream output = System.out;
        synchronized (output) {
            output.println(line);
            output.flush();
        }
    }

    private static String jsonString(String value) {
        StringBuilder escaped = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            switch (character) {
                case '"': escaped.append("\\\""); break;
                case '\\': escaped.append("\\\\"); break;
                case '\b': escaped.append("\\b"); break;
                case '\f': escaped.append("\\f"); break;
                case '\n': escaped.append("\\n"); break;
                case '\r': escaped.append("\\r"); break;
                case '\t': escaped.append("\\t"); break;
                default:
                    if (character < 0x20 || Character.isSurrogate(character)) {
                        escaped.append("\\u");
                        String hex = Integer.toHexString(character);
                        for (int padding = hex.length(); padding < 4; padding++) {
                            escaped.append('0');
                        }
                        escaped.append(hex);
                    } else {
                        escaped.append(character);
                    }
            }
        }
        return escaped.append('"').toString();
    }
}
