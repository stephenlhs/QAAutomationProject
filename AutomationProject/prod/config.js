import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', '.env'), override: false });

export const ENV_NAME = 'prod';

export const URLS = {
  playsite:   'https://998hihi.com/',
  backoffice: 'https://bo.v2hotel.com/login',
};

export const PLAYER = {
  username:    process.env.CUSTOM_PLAYER_USERNAME || process.env.PROD_PLAYER_USERNAME,
  password:    process.env.CUSTOM_PLAYER_PASSWORD || process.env.PROD_PLAYER_PASSWORD,
  sessionPath: '.auth/player-prod.json',
  isCustom:    !!process.env.CUSTOM_PLAYER_USERNAME,
};

export const BACKOFFICE = {
  username:    process.env.PROD_BO_USERNAME,
  password:    process.env.PROD_BO_PASSWORD,
  twoFASecret: process.env.PROD_BO_2FA_SECRET,
  sessionPath: '.auth/backoffice-prod.json',
};

export const DEPOSIT = {
  amount:             parseFloat(process.env.CUSTOM_DEPOSIT_AMOUNT) || 50,
  bankName:           process.env.DEPOSIT_BANK_NAME || 'Maybank',
  packageName:        process.env.DEPOSIT_PACKAGE_NAME || 'Normal Deposit',
  rolloverMultiplier: parseFloat(process.env.DEPOSIT_ROLLOVER_MULTIPLIER) || 1,
};

export const WITHDRAWAL = {
  amount: parseFloat(process.env.CUSTOM_WITHDRAWAL_AMOUNT) || 10,
};

export const MEMBER_SETUP = {
  boUsername:      process.env.PROD_BO_USERNAME,
  boPassword:      process.env.PROD_BO_PASSWORD,
  twoFASecret:     process.env.PROD_BO_2FA_SECRET,
  initialPassword: process.env.MEMBER_INITIAL_PASSWORD || '1234ssss',
  newPassword:     process.env.MEMBER_NEW_PASSWORD      || 'ssss1234',
  bankCode:        process.env.MEMBER_BANK_CODE         || '808',
};

export const MEMBERS = (() => {
  if (process.env.CUSTOM_MEMBERS) {
    try {
      const parsed = JSON.parse(process.env.CUSTOM_MEMBERS);
      return parsed.map(m => ({
        username: m.username,
        currency: m.currency || 'MYR',
      }));
    } catch {
      console.warn('>> Could not parse CUSTOM_MEMBERS, using defaults');
    }
  }
  return [
    { username: 'gaplay1', currency: 'MYR' },
  ];
})();