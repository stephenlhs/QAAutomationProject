import 'dotenv/config';

const ENV = process.env.TEST_ENV || 'staging';

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