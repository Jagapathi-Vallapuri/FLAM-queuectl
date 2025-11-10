#!/usr/bin/env node

import { Command } from 'commander';
import { getConfig, setConfig, initDb, enqueueJob, listJobs, getStatus, startWorkers, stopWorkers, dlqList, dlqRetry, closeDb, workerLoop } from '../index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();
program
    .name('queuectl')
    .description('CLI-based background job queue with workers, retries, backoff, and DLQ')
    .version(pkg.version);

program
    .command('enqueue')
    .argument('<job>', 'Either JSON like { "command": "echo hi" } or a raw command string')
    .option('--run-at <iso>', 'ISO time to schedule the run (optional)')
    .option('--max-retries <n>', 'Override max retries', (v) => parseInt(v, 10))
    .action(async (jobInput, opts) => {
        let exitCode = 0;
        try {
            await initDb();
            let job;
            try {
                job = JSON.parse(jobInput);
            } catch (_e) {
                // Fallback: interpret the input as a raw command string to reduce quoting issues
                job = { command: String(jobInput) };
            }
            if (opts.runAt) job.run_at = opts.runAt;
            if (opts.maxRetries != null) job.max_retries = opts.maxRetries;
            const id = enqueueJob(job);
            console.log(id);
        } catch (e) {
            console.error('enqueue failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

const worker = program.command('worker').description('Manage workers');

worker
    .command('start')
    .option('--count <n>', 'Number of workers', (v) => parseInt(v, 10), 1)
    .option('--poll-interval <ms>', 'Polling interval in ms', (v) => parseInt(v, 10), 500)
    .action(async (opts) => {
        let exitCode = 0;
        try {
            await initDb();
            await startWorkers(opts.count, opts.pollInterval);
        } catch (e) {
            console.error('worker start failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

worker
    .command('stop')
    .action(async () => {
        await stopWorkers();
    });

worker
    .command('run')
    .description('Run a single foreground worker (container-friendly)')
    .option('--poll-interval <ms>', 'Polling interval in ms', (v) => parseInt(v, 10), 500)
    .action(async (opts) => {
        let exitCode = 0;
        try {
            await initDb();
            const id = String(process.pid);
            await workerLoop(id, opts.pollInterval);
        } catch (e) {
            console.error('worker run failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

program
    .command('status')
    .description('Show summary of all job states and active workers')
    .action(async () => {
        let exitCode = 0;
        try {
            await initDb();
            const s = getStatus();
            console.log(JSON.stringify(s, null, 2));
        } catch (e) {
            console.error('status failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

program
    .command('list')
    .option('--state <state>', 'Filter by job state (pending|processing|completed|failed)')
    .option('--limit <n>', 'Limit', (v) => parseInt(v, 10), 50)
    .option('--offset <n>', 'Offset', (v) => parseInt(v, 10), 0)
    .action(async (opts) => {
        let exitCode = 0;
        try {
            await initDb();
            if (opts.state === 'dead') {
                console.log(JSON.stringify(dlqList(), null, 2));
            } else {
                const rows = listJobs(opts.state, opts.limit, opts.offset);
                console.log(JSON.stringify(rows, null, 2));
            }
        } catch (e) {
            console.error('list failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

const dlq = program.command('dlq').description('Dead letter queue');

dlq
    .command('list')
    .action(async () => {
        let exitCode = 0;
        try {
            await initDb();
            console.log(JSON.stringify(dlqList(), null, 2));
        } catch (e) {
            console.error('dlq list failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

dlq
    .command('retry')
    .argument('<id>', 'Job ID to retry from DLQ')
    .action(async (id) => {
        let exitCode = 0;
        try {
            await initDb();
            const res = dlqRetry(id);
            console.log(res ? 'enqueued' : 'not-found');
            if (!res) exitCode = 1;
        } catch (e) {
            console.error('dlq retry failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

const cfg = program.command('config').description('Configuration');

cfg
    .command('get')
    .argument('<key>', 'Config key')
    .action(async (key) => {
        let exitCode = 0;
        try {
            await initDb();
            console.log(getConfig(key));
        } catch (e) {
            console.error('config get failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

cfg
    .command('set')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action(async (key, value) => {
        let exitCode = 0;
        try {
            await initDb();
            setConfig(key, value);
            console.log('ok');
        } catch (e) {
            console.error('config set failed:', e.message || e);
            exitCode = 1;
        } finally {
            closeDb();
            process.exit(exitCode);
        }
    });

await program.parseAsync(process.argv);