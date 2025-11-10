
import { initDb, workerLoop, getConfig } from './index.js';

const id = process.env.QUEUECTL_WORKER_ID || String(process.pid);

(async () => {
    try {
        await initDb();
        const pollRaw = process.env.QUEUECTL_POLL ?? getConfig('poll_interval_ms');
        const poll = Number.isFinite(Number(pollRaw)) ? Number(pollRaw) : 500;
        await workerLoop(id, poll);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();