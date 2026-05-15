import { createServer } from 'http';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4000;

const TESTS = {
  'approve-deposit':    'tests/ManualApproveDeposit.spec.js',
  'reject-deposit':     'tests/ManualRejectDeposit.spec.js',
  'approve-withdrawal': 'tests/ManualApproveWithdrawal.spec.js',
  'reject-withdrawal':  'tests/ManualRejectWithdrawal.spec.js',
  'create-members':     'tests/CreateMemberAndSaveSession.spec.js',
  'slot-game':          'tests/SlotGame.spec.js',
};

const activeProcesses = {};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Serve HTML ──
  if (req.method === 'GET' && url.pathname === '/') {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // ── Run test ──
  if (req.method === 'POST' && url.pathname === '/run') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { test, env, depositAmount, withdrawalAmount, members } = JSON.parse(body);

      const testFile = TESTS[test];
      if (!testFile) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown test' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      send({ type: 'info', msg: `>> Starting: ${testFile}` });
      send({ type: 'info', msg: `>> Environment: ${env.toUpperCase()}` });
      if (depositAmount)    send({ type: 'info', msg: `>> Deposit Amount: MYR ${depositAmount}` });
      if (withdrawalAmount) send({ type: 'info', msg: `>> Withdrawal Amount: MYR ${withdrawalAmount}` });
      if (members)          send({ type: 'info', msg: `>> Members: ${members}` });
      send({ type: 'info', msg: `>> Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}` });
      send({ type: 'info', msg: '>> ─────────────────────────────────' });

      const isCreateMembers = test === 'create-members';
      const args = [
        'playwright', 'test', testFile, '--headed',
        ...(isCreateMembers ? ['--project=member-setup'] : []),
      ];

      const customEnv = { ...process.env, TEST_ENV: env };
      if (depositAmount)    customEnv.CUSTOM_DEPOSIT_AMOUNT    = depositAmount;
      if (withdrawalAmount) customEnv.CUSTOM_WITHDRAWAL_AMOUNT = withdrawalAmount;
      if (members)          customEnv.CUSTOM_MEMBERS           = members;

      const proc = spawn('npx', args, { env: customEnv, shell: true });
      activeProcesses[test] = proc;

      proc.stdout.on('data', data => {
        data.toString().split('\n').forEach(line => {
          if (line.trim()) send({ type: 'log', msg: line });
        });
      });

      proc.stderr.on('data', data => {
        data.toString().split('\n').forEach(line => {
          if (line.trim()) send({ type: 'err', msg: line });
        });
      });

      proc.on('close', code => {
        delete activeProcesses[test];
        send({ type: 'info', msg: '>> ─────────────────────────────────' });
        send({ type: code === 0 ? 'success' : 'fail', msg: code === 0 ? '>> TEST PASSED' : '>> TEST FAILED' });
        send({ type: 'done', msg: 'done' });
        res.end();
      });
    });
    return;
  }

  // ── Stop test ──
  if (req.method === 'POST' && url.pathname === '/stop') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { test } = JSON.parse(body);
      if (activeProcesses[test]) {
        activeProcesses[test].kill();
        delete activeProcesses[test];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`>> QA Dashboard running at http://localhost:${PORT}`);
  console.log('>> Open your browser and go to http://localhost:4000');
});
