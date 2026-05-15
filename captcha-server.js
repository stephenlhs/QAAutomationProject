import http from 'http';
import fs from 'fs';
import { exec } from 'child_process';
import 'dotenv/config';

const PORT = 3333;

async function solveCaptcha(imagePath) {
  return new Promise((resolve, reject) => {
    exec(`python solve_captcha.py ${imagePath}`, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      const result = stdout.trim();
      console.log('>> ddddocr result:', result);
      resolve(result);
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200); res.end(); return;
  }

  // ── Health check (used by QA Dashboard to show online status) ──
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync('captcha-helper.html'));
    return;
  }

  if (req.method === 'GET' && req.url === '/captcha.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(fs.readFileSync('captcha.png'));
    return;
  }

  // Support unique ID per test e.g. /auto-solve?id=approve
  if (req.method === 'POST' && req.url.startsWith('/auto-solve')) {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const id = params.get('id') || 'default';
      const captchaFile = `captcha-${id}.png`;

      console.log(`>> Auto-solving captcha [${id}]...`);

      // Use captcha-default.png if specific file doesn't exist
      const fileToSolve = fs.existsSync(captchaFile) ? captchaFile : 'captcha.png';
      const captcha = await solveCaptcha(fileToSolve);

      if (!captcha || captcha.length === 0) {
        throw new Error('ddddocr returned empty result');
      }

      fs.writeFileSync(`captcha-answer-${id}.txt`, captcha);
      console.log(`>> Captcha solved [${id}]:`, captcha);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ captcha }));
    } catch (err) {
      console.error('>> Failed:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/save-captcha') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { captcha } = JSON.parse(body);
      fs.writeFileSync('captcha-answer.txt', captcha);
      res.writeHead(200); res.end('ok');
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`>> Captcha Server running at http://localhost:${PORT}`);
});