import fs from 'fs';

// The run-bound sidecar is private and written atomically by the native broker.
export function windowsProof(jobPath, runId, expectedPid = null) {
  let proof;
  try { proof = JSON.parse(fs.readFileSync(`${jobPath}.windows.json`, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!proof || proof.schema !== 1 || proof.runId !== runId || proof.contained !== true) return null;
  const identity = proof.brokerIdentity;
  if (!identity || identity.platform !== 'win32' || identity.managedBroker !== true || identity.contained !== true ||
      !Number.isInteger(identity.pid) || identity.pid <= 0 ||
      (expectedPid !== null && identity.pid !== expectedPid) ||
      typeof identity.startTime !== 'string' || !/^\d+$/.test(identity.startTime) ||
      typeof identity.owner !== 'string' || !/^S-\d+(?:-\d+)+$/.test(identity.owner) ||
      !Number.isInteger(identity.sessionId) || identity.sessionId < 0 ||
      identity.jobName !== `Local\\claude-test-progress-${runId}` || proof.jobName !== identity.jobName ||
      typeof proof.treeEmpty !== 'boolean') return null;
  return proof;
}
