import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const BIN = path.join(process.cwd(), 'bin', 'queuectl.js');

function runCli(args, env = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(process.execPath, [BIN, ...args], {
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '', err = '';
        p.stdout.on('data', d => out += d.toString());
        p.stderr.on('data', d => err += d.toString());
        p.on('close', code => {
            if (code !== 0) return reject(new Error(`cli exit ${code}: ${err}`));
            resolve({ stdout: out.trim(), stderr: err.trim(), code });
        });
    });
}

function tempHome() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queuectl-test-'));
    return dir;
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

if (process.argv[1].includes('queue.test.js')) {
    (async () => {
        // Test 1: enqueue + completion
        const home = tempHome();
        const jobRes = await runCli(['enqueue', '{"command":"echo from test"}'], { QUEUECTL_HOME: home });
        assert.ok(jobRes.stdout.length > 0, 'job id missing');

        await runCli(['worker', 'start', '--count', '1', '--poll-interval', '200'], { QUEUECTL_HOME: home });
        await wait(1200);
        const statusRes = await runCli(['status'], { QUEUECTL_HOME: home });
        const status = JSON.parse(statusRes.stdout);
        assert.ok(status.counts.completed >= 1, 'completed job not counted');
        await runCli(['worker', 'stop'], { QUEUECTL_HOME: home });

        // Test 2: config set/get
        await runCli(['config', 'set', 'poll_interval_ms', '250'], { QUEUECTL_HOME: home });
        const cfgGet = await runCli(['config', 'get', 'poll_interval_ms'], { QUEUECTL_HOME: home });
        assert.equal(cfgGet.stdout.trim(), '250');

        // Test 3: failing job -> DLQ after retries
        const failHome = tempHome();
        await runCli(['config', 'set', 'max_retries', '0'], { QUEUECTL_HOME: failHome });
        await runCli(['enqueue', '{"command":"node -e \"process.exit(1)\""}'], { QUEUECTL_HOME: failHome });
        await runCli(['worker', 'start', '--count', '1', '--poll-interval', '100'], { QUEUECTL_HOME: failHome });
        await wait(800);
        const dlqList = await runCli(['dlq', 'list'], { QUEUECTL_HOME: failHome });
        const dlq = JSON.parse(dlqList.stdout);
        assert.ok(dlq.length >= 1, 'failed job not moved to DLQ');

        // Test 4: dlq retry
        const id = dlq[0].id;
        await runCli(['dlq', 'retry', id], { QUEUECTL_HOME: failHome });
        await runCli(['worker', 'start', '--count', '1', '--poll-interval', '100'], { QUEUECTL_HOME: failHome });
        await wait(1200);

        const dlqListAfterRetry = await runCli(['dlq', 'list'], { QUEUECTL_HOME: failHome });
        const dlqAfter = JSON.parse(dlqListAfterRetry.stdout);
        assert.ok(dlqAfter.length >= 1, 'retried job not returned to DLQ');
        await runCli(['worker', 'stop'], { QUEUECTL_HOME: failHome });

        console.log('ALL TESTS OK');
    })().catch(e => { console.error(e); process.exit(1); });
}
