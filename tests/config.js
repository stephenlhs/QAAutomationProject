import 'dotenv/config';

const ENV = process.env.TEST_ENV || 'staging';

// =============================
// URLS + ENV SETTINGS
// =============================
export const URLS = {
  staging: {
    playsite: 'https://stage-mem.linkv2.com/',
    backoffice: 'https://stage-bo.linkv2.com/login',
    memberPrefix: 'x9048_',
    popupCloseSelectors: ['text=x', '.fa.fa-times', 'text=×', '.card__box-close'],
  },
  uat: {
    playsite: 'https://mem2.linkv2.com/#',
    backoffice: 'https://ag-uat.linkv2.com/login',
    memberPrefix: '',
    popupCloseSelectors: ['text=x', '.fa.fa-times', 'text=×'],
  },
  prod: {
    playsite: 'https://998hihi.com/',
    backoffice: 'https://bo.v2hotel.com/login',
    memberPrefix: '',
    popupCloseSelectors: ['text=x', '.fa.fa-times', 'text=×'],
  },
}[ENV];

export const ENV_NAME = ENV;

// =============================
// PLAYER CONFIG
// =============================
export const PLAYER = {
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
}[ENV];

// =============================
// BACKOFFICE CONFIG
// =============================
export const BACKOFFICE = {
  staging: {
    username: process.env.STAGING_BO_USERNAME,
    password: process.env.STAGING_BO_PASSWORD,
    sessionPath: '.auth/backoffice.json',
    twoFASecret: process.env.STAGING_BO_2FA_SECRET || '',
  },
  uat: {
    username: process.env.UAT_BO_USERNAME,
    password: process.env.UAT_BO_PASSWORD,
    sessionPath: '.auth/backoffice-uat.json',
    twoFASecret: process.env.UAT_BO_2FA_SECRET || '',
  },
  prod: {
    username: process.env.PROD_BO_USERNAME,
    password: process.env.PROD_BO_PASSWORD,
    sessionPath: '.auth/backoffice-prod.json',
    twoFASecret: process.env.PROD_BO_2FA_SECRET || '',
  },
}[ENV];

// =============================
// DEPOSIT CONFIG
// =============================
export const DEPOSIT = {
  staging: {
    amount: parseFloat(process.env.CUSTOM_DEPOSIT_AMOUNT) || 50,
    rolloverMultiplier: 1,
    bankName: 'C zh test - zh test all',
    packageName: 'Stephen Turnover Package',
  },
  uat: {
    amount: parseFloat(process.env.CUSTOM_DEPOSIT_AMOUNT) || 50,
    rolloverMultiplier: 1,
    bankName: 'your-uat-bank-name',
    packageName: 'your-uat-package-name',
  },
  prod: {
    amount: parseFloat(process.env.CUSTOM_DEPOSIT_AMOUNT) || 50,
    rolloverMultiplier: 1,
    bankName: 'your-prod-bank-name',
    packageName: 'your-prod-package-name',
  },
}[ENV];

// =============================
// WITHDRAWAL CONFIG
// =============================
export const WITHDRAWAL = {
  amount: parseFloat(process.env.CUSTOM_WITHDRAWAL_AMOUNT) || 10,
};

// =============================
// MEMBER SETUP CONFIG
// =============================
export const MEMBER_SETUP = {
  staging: {
    initialPassword: '1234ssss',
    newPassword: 'ssss1234',
    boUsername: process.env.STAGING_BO_USERNAME,
    boPassword: process.env.STAGING_BO_PASSWORD,
    bankCode: '808',
    twoFASecret: process.env.STAGING_BO_2FA_SECRET || '',
  },
  uat: {
    initialPassword: '1234ssss',
    newPassword: 'ssss1234',
    boUsername: process.env.UAT_BO_USERNAME,
    boPassword: process.env.UAT_BO_PASSWORD,
    bankCode: '808',
    twoFASecret: process.env.UAT_BO_2FA_SECRET || '',
  },
  prod: {
    initialPassword: '1234ssss',
    newPassword: 'ssss1234',
    boUsername: process.env.PROD_BO_USERNAME,
    boPassword: process.env.PROD_BO_PASSWORD,
    bankCode: '808',
    twoFASecret: process.env.PROD_BO_2FA_SECRET || '',
  },
}[ENV];

// =============================
// MEMBER LIST
// =============================
export const MEMBERS = {
  staging: process.env.CUSTOM_MEMBERS
    ? JSON.parse(process.env.CUSTOM_MEMBERS)
    : [
        { username: 'gaplay1', currency: 'MYR' },
        { username: 'gaplay2', currency: 'MYR' },
      ],
  uat: process.env.CUSTOM_MEMBERS
    ? JSON.parse(process.env.CUSTOM_MEMBERS)
    : [
        { username: 'uat-member1', currency: 'MYR' },
        { username: 'uat-member2', currency: 'MYR' },
      ],
  prod: process.env.CUSTOM_MEMBERS
    ? JSON.parse(process.env.CUSTOM_MEMBERS)
    : [
        { username: 'prod-member1', currency: 'MYR' },
        { username: 'prod-member2', currency: 'MYR' },
      ],
}[ENV];