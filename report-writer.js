// report-writer.js
// Called by server.js after each test completes.
// Writes reports/{env}/{testName}_{YYYY-MM-DD_HH-mm-ss}.xlsx
// Sheet 1 — Summary row
// Sheet 2 — Full log

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function writeReport({ testName, env, result, durationMs, depositAmount, withdrawalAmount, members, logLines }) {
  // ── Read transaction summary early so we can embed method+action in the filename ──
  let txnDataEarly = null;
  const txnManifestNamesEarly = [`manifest-${testName}-txn.json`, 'manifest-paygate-deposit-txn.json'];
  for (const name of txnManifestNamesEarly) {
    const p1 = join(__dirname, '.screenshots-tmp', name);
    const p2 = join(process.cwd(), '.screenshots-tmp', name);
    const tp = existsSync(p1) ? p1 : existsSync(p2) ? p2 : null;
    if (tp) {
      try { txnDataEarly = JSON.parse(readFileSync(tp, 'utf-8')); } catch {}
      break;
    }
  }

  // ── Build filename ──
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const resultTag = result === 'passed' ? 'PASS' : 'FAIL';

  // Append method and action when available (e.g. paygate-deposit_QR_approved_..._PASS.xlsx)
  let runLabel = '';
  if (txnDataEarly) {
    const method = (txnDataEarly.method || '').replace(/\s+/g, '-');
    const action = (txnDataEarly.txStatus || '').replace(/\s+/g, '-');
    if (method) runLabel += `_${method}`;
    if (action) runLabel += `_${action}`;
  }

  const filename = `${testName}${runLabel}_${dateStr}_${timeStr}_${resultTag}.xlsx`;

  // ── Ensure folder exists ──
  const folder = join(__dirname, 'reports', env);
  mkdirSync(folder, { recursive: true });
  const outPath = join(folder, filename);

  // ── Read screenshots from temp manifest file written by spec ──
  let screenshotPaths = [];
  const manifestPath = join(__dirname, '.screenshots-tmp', `manifest-${testName}.json`);
  const manifestPathCwd = join(process.cwd(), '.screenshots-tmp', `manifest-${testName}.json`);
  console.log(`>> Looking for manifest at: ${manifestPath}`);
  console.log(`>> Also checking cwd path: ${manifestPathCwd}`);
  try {
    const pathToUse = existsSync(manifestPath) ? manifestPath : existsSync(manifestPathCwd) ? manifestPathCwd : null;
    if (pathToUse) {
      screenshotPaths = JSON.parse(readFileSync(pathToUse, 'utf-8'));
      unlinkSync(pathToUse);
      console.log(`>> Loaded ${screenshotPaths.length} screenshot(s) from manifest`);
    } else {
      console.log(`>> No manifest found for ${testName}`);
    }
  } catch (e) {
    console.log(`>> Manifest read error: ${e.message}`);
  }

  // ── Transaction summary already read above (txnDataEarly) ──
  // Delete the file now that we have the data
  let txnData = txnDataEarly;
  if (txnData) {
    const txnManifestNames = [`manifest-${testName}-txn.json`, 'manifest-paygate-deposit-txn.json'];
    for (const name of txnManifestNames) {
      const p1 = join(__dirname, '.screenshots-tmp', name);
      const p2 = join(process.cwd(), '.screenshots-tmp', name);
      const tp = existsSync(p1) ? p1 : existsSync(p2) ? p2 : null;
      if (tp) { try { unlinkSync(tp); } catch {} break; }
    }
    console.log(`>> Txn data: method=${txnData.method}, status=${txnData.txStatus}`);
  }

  // ── Build payload for Python ──
  const payload = {
    outPath,
    summary: {
      testName,
      env:        env.toUpperCase(),
      date:       `${dateStr} ${timeStr.replace(/-/g, ':')}`,
      result:     result === 'passed' ? 'PASS' : 'FAIL',
      durationSec: (durationMs / 1000).toFixed(1),
      depositAmount:    depositAmount    || '—',
      withdrawalAmount: withdrawalAmount || '—',
      members:          members          || '—',
    },
    txnData:         txnData         || null,
    logLines:        logLines        || [],
    screenshotPaths: screenshotPaths || [],
  };

  // Write payload to temp JSON file
  const tmpPath = join(__dirname, `.report-tmp-${Date.now()}.json`);
  writeFileSync(tmpPath, JSON.stringify(payload));

  // Run Python to build the xlsx
  await new Promise((resolve, reject) => {
    const py = spawn('python', [join(__dirname, 'write-report.py'), tmpPath], { shell: false });
    py.on('close', code => {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
      // Clean up temp screenshots
      screenshotPaths.forEach(s => {
        try { if (existsSync(s.path)) unlinkSync(s.path); } catch {}
      });
      if (code === 0) resolve();
      else reject(new Error(`write-report.py exited with code ${code}`));
    });
    py.on('error', err => {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
      reject(err);
    });
  });

  console.log(`>> Report saved: ${outPath}`);
  return outPath;
}