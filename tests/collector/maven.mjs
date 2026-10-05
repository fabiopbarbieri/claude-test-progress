import assert from 'assert';
import { Progress } from '../../runner/progress.mjs';
const progress = new Progress('maven');
for (const line of [
  '[INFO] --- surefire:3.5.2:test (default-test) @ module-a ---',
  '[INFO] Running example.SharedTest',
  '[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0 -- in example.SharedTest',
  '[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0',
  '[INFO] --- surefire:3.5.2:test (default-test) @ module-b ---',
  '[INFO] Running example.SharedTest',
  '[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0 -- in example.SharedTest',
  '[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0',
]) progress.line(line);
assert.strictEqual(progress.values().resolved, 5);
assert.strictEqual(progress.values().failed, 1);
assert.strictEqual(progress.values().total, null);
assert.strictEqual(progress.values(true, false).total, null);
assert.strictEqual(progress.values(true, true).total, 5);
console.log('Maven same FQCN in two modules: OK');
// Repeated class summaries within one goal are not extra tests; aggregates and
// a new goal must not borrow an unfinished class from the preceding goal.
progress.line('[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0 -- in example.SharedTest');
assert.strictEqual(progress.values().resolved, 5);
progress.line('[INFO] Running example.UnfinishedTest');
progress.line('[INFO] Results:');
progress.line('[INFO] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0');
assert.strictEqual(progress.values().resolved, 5);
progress.line('[INFO] --- maven-failsafe-plugin:3.5.2:integration-test (integration) @ module-b ---');
progress.line('[INFO] Running example.SharedTest');
progress.line('[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 1 -- in example.SharedTest');
assert.strictEqual(progress.values(true).resolved, 6);
assert.strictEqual(progress.values(true).skipped, 1);
assert.strictEqual(progress.values(true).failed, 1);
console.log('Maven aggregate deduplication and separate goal execution: OK');
