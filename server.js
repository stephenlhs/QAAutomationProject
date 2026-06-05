import { createServer } from 'http';
import { spawn } from 'child_process';
import { readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { writeReport } from './report-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4000;

const TEST_FILES = {
  'approve-deposit':    'ManualApproveDeposit.spec.js',
  'reject-deposit':     'ManualRejectDeposit.spec.js',
  'approve-withdrawal': 'ManualApproveWithdrawal.spec.js',
  'reject-withdrawal':  'ManualRejectWithdrawal.spec.js',
  'create-members':     'CreateMemberAndSaveSession.spec.js',
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

  // ── Captcha status proxy ──
  if (req.method === 'GET' && url.pathname === '/captcha-status') {
    let responded = false;
    const reply = (online) => {
      if (responded) return;
      responded = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ online }));
    };
    const probe = http.get('http://localhost:3333/health', (r) => {
      r.resume();
      reply(r.statusCode === 200);
    });
    probe.on('error', () => reply(false));
    probe.setTimeout(2000, () => { probe.destroy(); reply(false); });
    return;
  }

  // ── Config (exposes API key to frontend — local only) ──
  if (req.method === 'GET' && url.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ apiKey: process.env.ANTHROPIC_API_KEY || '' }));
    return;
  }

  // ── List reports ──
  if (req.method === 'GET' && url.pathname === '/reports') {
    try {
      const reportsDir = join(__dirname, 'reports');
      const result = {};
      for (const env of ['staging', 'uat', 'prod']) {
        const envDir = join(reportsDir, env);
        try {
          const files = readdirSync(envDir)
            .filter(f => f.endsWith('.xlsx'))
            .map(f => {
              const fullPath = join(envDir, f);
              const { size, mtime } = statSync(fullPath);
              return { name: f, env, size, modified: mtime.toISOString() };
            })
            .sort((a, b) => new Date(b.modified) - new Date(a.modified));
          result[env] = files;
        } catch {
          result[env] = [];
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Delete a report ──
  if ((req.method === 'DELETE' || req.method === 'POST') && url.pathname === '/reports/delete') {
    const env  = url.searchParams.get('env');
    const file = url.searchParams.get('file');
    if (!env || !file || file.includes('..') || !file.endsWith('.xlsx')) {
      res.writeHead(400); res.end(); return;
    }
    const filePath = join(__dirname, 'reports', env, file);
    try {
      unlinkSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(404); res.end();
    }
    return;
  }

  // ── Download a report ──
  if (req.method === 'GET' && url.pathname.startsWith('/reports/download')) {
    const env  = url.searchParams.get('env');
    const file = url.searchParams.get('file');
    if (!env || !file || file.includes('..') || !file.endsWith('.xlsx')) {
      res.writeHead(400); res.end(); return;
    }
    const filePath = join(__dirname, 'reports', env, file);
    try {
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${file}"`,
      });
      res.end(data);
    } catch {
      res.writeHead(404); res.end();
    }
    return;
  }

  // ── Preview report (returns summary JSON) ──
  if (req.method === 'GET' && url.pathname === '/reports/preview') {
    const env  = url.searchParams.get('env');
    const file = url.searchParams.get('file');
    if (!env || !file || file.includes('..') || !file.endsWith('.xlsx')) {
      res.writeHead(400); res.end(); return;
    }
    const filePath = join(__dirname, 'reports', env, file);
    const pyScript = join(__dirname, 'read-report.py');
    let responded = false;
    const py = spawn('python', [pyScript, filePath], {
      shell: false,
      env: { ...process.env, PYTHONUTF8: '1' },
    });
    let out = '';
    let err = '';
    py.stdout.on('data', d => { out += d.toString(); });
    py.stderr.on('data', d => { err += d.toString(); });
    py.on('close', code => {
      if (responded) return;
      responded = true;
      if (code === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out);
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.trim() }));
      }
    });
    return;
  }

  // ── Run test ──
  if (req.method === 'POST' && url.pathname === '/run') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { test, env, depositAmount, withdrawalAmount, members, customPlayerUsername, customPlayerPassword } = JSON.parse(body);

      const fileName = TEST_FILES[test];
      if (!fileName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown test' }));
        return;
      }

      const testFile = `tests/${env}/${fileName}`;
      const isCreateMembers = test === 'create-members';
      const project = isCreateMembers ? `${env}-member-setup` : env;

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

      const args = [
        'playwright', 'test', testFile, '--headed',
        `--project=${project}`,
      ];

      const customEnv = { ...process.env, TEST_ENV: env };
      if (depositAmount)        customEnv.CUSTOM_DEPOSIT_AMOUNT    = depositAmount;
      if (withdrawalAmount)     customEnv.CUSTOM_WITHDRAWAL_AMOUNT = withdrawalAmount;
      if (members)              customEnv.CUSTOM_MEMBERS           = members;
      if (customPlayerUsername) customEnv.CUSTOM_PLAYER_USERNAME   = customPlayerUsername;
      if (customPlayerPassword) customEnv.CUSTOM_PLAYER_PASSWORD   = customPlayerPassword;

      const startTime = Date.now();
      const logLines  = [];   // ← collect all output for the report

      const proc = spawn('npx', args, { env: customEnv, shell: true });
      activeProcesses[test] = proc;

      proc.stdout.on('data', data => {
        data.toString().split('\n').forEach(line => {
          const clean = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
          if (clean) { send({ type: 'log', msg: clean }); logLines.push(clean); }
        });
      });

      proc.stderr.on('data', data => {
        data.toString().split('\n').forEach(line => {
          const clean = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
          if (clean) { send({ type: 'err', msg: clean }); logLines.push(`[ERR] ${clean}`); }
        });
      });

      proc.on('close', async (code) => {
        delete activeProcesses[test];
        const result = code === 0 ? 'passed' : 'failed';
        const durationMs = Date.now() - startTime;

        send({ type: 'info', msg: '>> ─────────────────────────────────' });
        send({ type: result === 'passed' ? 'success' : 'fail',
               msg: result === 'passed' ? '>> TEST PASSED' : '>> TEST FAILED' });

        // ── Write Excel report ──
        try {
          const reportPath = await writeReport({
            testName: test, env, result, durationMs,
            depositAmount, withdrawalAmount, members,
            logLines,
          });
          const reportFile = reportPath.split(/[/\\]/).pop();
          send({ type: 'info', msg: `>> Report saved: reports/${env}/${reportFile}` });
          send({ type: 'report', env, file: reportFile });
        } catch (err) {
          send({ type: 'err', msg: `>> Report write failed: ${err.message}` });
        }

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