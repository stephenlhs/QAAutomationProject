import dotenv from 'dotenv';
dotenv.config();

export const ENV_NAME = 'staging';

export const URLS = {
  playsite:   'https://stage-mem.linkv2.com/',
  backoffice: 'https://stage-bo.linkv2.com/login',
};

const MEMBER_PREFIX = 'x9048_';

export const PLAYER = {
  username:    process.env.CUSTOM_PLAYER_USERNAME || process.env.STAGING_PLAYER_USERNAME,
  password:    process.env.CUSTOM_PLAYER_PASSWORD || process.env.STAGING_PLAYER_PASSWORD,
  sessionPath: '.auth/player.json',
  isCustom:    !!process.env.CUSTOM_PLAYER_USERNAME,
};

export const BACKOFFICE = {
  username:    process.env.STAGING_BO_USERNAME,
  password:    process.env.STAGING_BO_PASSWORD,
  twoFASecret: process.env.STAGING_BO_2FA_SECRET,
  sessionPath: '.auth/backoffice.json',
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
  boUsername:      process.env.STAGING_BO_USERNAME,
  boPassword:      process.env.STAGING_BO_PASSWORD,
  twoFASecret:     process.env.STAGING_BO_2FA_SECRET,
  initialPassword: process.env.MEMBER_INITIAL_PASSWORD || 'Abc12345',
  newPassword:     process.env.MEMBER_NEW_PASSWORD      || 'ssss1234',
  bankCode:        process.env.MEMBER_BANK_CODE         || '808',
};

export const MEMBERS = (() => {
  if (process.env.CUSTOM_MEMBERS) {
    try {
      const parsed = JSON.parse(process.env.CUSTOM_MEMBERS);
      return parsed.map(m => ({
        username: `${MEMBER_PREFIX}${m.username}`,
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
