import { existsSync, unlinkSync, writeFileSync } from 'fs';

export class CaptchaHelper {
  constructor(page, testId = 'default') {
    this.page = page;
    this.testId = testId;
    this.captchaFile = `captcha-${testId}.png`;
    this.answerFile = `captcha-answer-${testId}.txt`;
  }

  async solve(imgLocator) {
    await imgLocator.waitFor({ state: 'visible' });
    await this.page.waitForTimeout(500);

    const imgSrc = await imgLocator.getAttribute('src');
    if (imgSrc && imgSrc.trim() !== '') {
      const fullUrl = imgSrc.startsWith('//') ? `https:${imgSrc}` : imgSrc;
      const response = await this.page.request.get(fullUrl);
      writeFileSync(this.captchaFile, await response.body());
    } else {
      await imgLocator.screenshot({ path: this.captchaFile });
    }

    if (existsSync(this.answerFile)) unlinkSync(this.answerFile);

    const solveRes = await fetch(
      `http://localhost:3333/auto-solve?id=${this.testId}`,
      { method: 'POST' }
    );
    const data = await solveRes.json();

    if (data.error) throw new Error(`Captcha error: ${data.error}`);
    if (!data.captcha) throw new Error('Empty captcha response');

    const digits = data.captcha.replace(/[^0-9]/g, '').slice(0, 4);
    console.log(`>> [${this.testId}] Captcha solved: ${digits}`);
    return digits;
  }
}