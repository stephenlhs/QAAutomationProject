import dotenv from 'dotenv';
dotenv.config();

const env = process.env.TEST_ENV || 'staging';

// ── ENV_NAME export (used by some specs) ─────────────────────
export const ENV_NAME = env;

// ── URLs ──────────────────────────────────────────────────────
export const URLS = {
  staging: {
    playsite:   'https://stage-mem.linkv2.com/',
    backoffice: 'https://stage-bo.linkv2.com/login',
  },
  uat: {
    playsite:   'https://mem2.linkv2.com/#',
    backoffice: 'https://ag-uat.linkv2.com/login',
  },
  prod: {
    playsite:   'https://998hihi.com/',
    backoffice: 'https://bo.v2hotel.com/login',
  },
}[env];

// ── Member prefix (staging only) ──────────────────────────────
const MEMBER_PREFIX = env === 'staging' ? 'x9048_' : '';

// ── PLAYER CONFIG ─────────────────────────────────────────────
// Priority: CUSTOM_PLAYER_USERNAME/PASSWORD (passed from dashboard)
//           → fallback to env-specific credentials in .env
const defaultPlayer = {
  staging: {
    username: process.env.STAGING_PLAYER_USERNAME,
    password: process.env.STAGING_PLAYER_PASSWORD,
    sessionPath: '.auth/player.json',
  },
  uat: {
    username: process.env.UAT_PLAYER_USERNAME,
    password: process.env.UAT_PLAYER_PASSWORD,
    sessionPath: '.auth/player-uat.json',
  },
  prod: {
    username: process.env.PROD_PLAYER_USERNAME,
    password: process.env.PROD_PLAYER_PASSWORD,
    sessionPath: '.auth/player-prod.json',
  },
}[env];

export const PLAYER = {
  username:    process.env.CUSTOM_PLAYER_USERNAME || defaultPlayer.username,
  password:    process.env.CUSTOM_PLAYER_PASSWORD || defaultPlayer.password,
  sessionPath: defaultPlayer.sessionPath,
  isCustom:    !!process.env.CUSTOM_PLAYER_USERNAME,  // flag so LoginPage knows
};

// ── BACKOFFICE CONFIG ─────────────────────────────────────────
export const BACKOFFICE = {
  staging: {
    username:    process.env.STAGING_BO_USERNAME,
    password:    process.env.STAGING_BO_PASSWORD,
    twoFASecret: process.env.STAGING_BO_2FA_SECRET,
    sessionPath: '.auth/backoffice.json',
  },
  uat: {
    username:    process.env.UAT_BO_USERNAME,
    password:    process.env.UAT_BO_PASSWORD,
    twoFASecret: process.env.UAT_BO_2FA_SECRET,
    sessionPath: '.auth/backoffice-uat.json',
  },
  prod: {
    username:    process.env.PROD_BO_USERNAME,
    password:    process.env.PROD_BO_PASSWORD,
    twoFASecret: process.env.PROD_BO_2FA_SECRET,
    sessionPath: '.auth/backoffice-prod.json',
  },
}[env];

// ── DEPOSIT CONFIG ────────────────────────────────────────────
export const DEPOSIT = {
  amount:            parseFloat(process.env.CUSTOM_DEPOSIT_AMOUNT) || 50,
  bankName:          process.env.DEPOSIT_BANK_NAME || 'Maybank',
  packageName:       process.env.DEPOSIT_PACKAGE_NAME || 'Normal Deposit',
  rolloverMultiplier: parseFloat(process.env.DEPOSIT_ROLLOVER_MULTIPLIER) || 1,
};

// ── WITHDRAWAL CONFIG ─────────────────────────────────────────
export const WITHDRAWAL = {
  amount: parseFloat(process.env.CUSTOM_WITHDRAWAL_AMOUNT) || 10,
};

// ── MEMBER SETUP CONFIG ───────────────────────────────────────
export const MEMBER_SETUP = {
  boUsername:      process.env.STAGING_BO_USERNAME,
  boPassword:      process.env.STAGING_BO_PASSWORD,
  twoFASecret:     process.env.STAGING_BO_2FA_SECRET,
  initialPassword: process.env.MEMBER_INITIAL_PASSWORD || 'Abc12345',
  newPassword:     process.env.MEMBER_NEW_PASSWORD      || 'ssss1234',
  bankCode:        process.env.MEMBER_BANK_CODE         || '808',
};

// ── MEMBERS (for Create Members test) ────────────────────────
export const MEMBERS = (() => {
  if (process.env.CUSTOM_MEMBERS) {
    try {
      const parsed = JSON.parse(process.env.CUSTOM_MEMBERS);
      return parsed.map(m => ({
        username: env === 'staging' ? `${MEMBER_PREFIX}${m.username}` : m.username,
        currency: m.currency || 'MYR',
      }));
    } catch {
      console.warn('>> Could not parse CUSTOM_MEMBERS, using defaults');
    }
  }
  return [
    { username: `${MEMBER_PREFIX}scauto5`, currency: 'MYR' },
  ];
})();