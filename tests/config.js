// =============================
// ENVIRONMENT CONFIG
// =============================
const ENV = process.env.TEST_ENV || 'staging'; // staging | uat | prod

const ENVIRONMENTS = {
  staging: {
    playsite: 'https://stage-mem.linkv2.com/',
    backoffice: 'https://stage-bo.linkv2.com/login',
  },
  uat: {
    playsite: 'https://mem2.linkv2.com/#',
    backoffice: 'https://ag-uat.linkv2.com/login',
  },
  prod: {
    playsite: 'https://998hihi.com/',
    backoffice: 'https://bo.v2hotel.com/login',
  },
};

export const URLS = ENVIRONMENTS[ENV];
console.log(`>> Running on: ${ENV.toUpperCase()} environment`);
console.log(`>> Playsite : ${URLS.playsite}`);
console.log(`>> Backoffice: ${URLS.backoffice}`);

// =============================
// PLAYER CONFIG
// =============================
export const PLAYER = {
  staging: {
    username: 'gaplayer3',
    password: 'ssss1234',
    sessionPath: '.auth/player.json',
  },
  uat: {
    username: 'your-uat-player',
    password: 'ssss1234',
    sessionPath: '.auth/player-uat.json',
  },
  prod: {
    username: 'your-prod-player',
    password: 'ssss1234',
    sessionPath: '.auth/player-prod.json',
  },
}[ENV];

// =============================
// BACKOFFICE CONFIG
// =============================
export const BACKOFFICE = {
  staging: {
    username: 'ga@mv1',
    password: 'qwert123',
    sessionPath: '.auth/backoffice.json',
    twoFASecret: 'GE3EOQKNIRKEKWCX',
  },
  uat: {
    username: 'your-uat-bo-user',
    password: 'qwert123',
    sessionPath: '.auth/backoffice-uat.json',
    twoFASecret: '',
  },
  prod: {
    username: 'your-prod-bo-user',
    password: 'qwert123',
    sessionPath: '.auth/backoffice-prod.json',
    twoFASecret: '',
  },
}[ENV];

// =============================
// DEPOSIT CONFIG
// =============================
export const DEPOSIT = {
  staging: {
    amount: 50,
    rolloverMultiplier: 1,
    bankName: 'C zh test - zh test all',
    packageName: 'Stephen Turnover Package',
  },
  uat: {
    amount: 50,
    rolloverMultiplier: 1,
    bankName: 'your-uat-bank-name',
    packageName: 'your-uat-package-name',
  },
  prod: {
    amount: 50,
    rolloverMultiplier: 1,
    bankName: 'your-prod-bank-name',
    packageName: 'your-prod-package-name',
  },
}[ENV];

// =============================
// WITHDRAWAL CONFIG
// =============================
export const WITHDRAWAL = {
  amount: 10,
};

// =============================
// MEMBER SETUP CONFIG
// =============================
export const MEMBER_SETUP = {
  staging: {
    initialPassword: '1234ssss',
    newPassword: 'ssss1234',
    boUsername: 'ga@mv1',
    boPassword: 'qwert123',
    bankCode: '808',
    twoFASecret: 'GE3EOQKNIRKEKWCX',
  },
  uat: {
    initialPassword: '1234ssss',
    newPassword: 'ssss1234',
    boUsername: 'your-uat-bo-user',
    boPassword: 'qwert123',
    bankCode: '808',
    twoFASecret: '',
  },
  prod: {
    initialPassword: '1234ssss',
    newPassword: 'ssss1234',
    boUsername: 'your-prod-bo-user',
    boPassword: 'qwert123',
    bankCode: '808',
    twoFASecret: '',
  },
}[ENV];

// =============================
// MEMBER LIST
// =============================
export const MEMBERS = {
  staging: [
    { username: 'automyr1', currency: 'MYR' },
    { username: 'automyr2', currency: 'MYR' },
    { username: 'automyr3', currency: 'MYR' },
    { username: 'automyr4', currency: 'MYR' },
  ],
  uat: [
    { username: 'uat-member1', currency: 'MYR' },
    { username: 'uat-member2', currency: 'MYR' },
  ],
  prod: [
    { username: 'prod-member1', currency: 'MYR' },
    { username: 'prod-member2', currency: 'MYR' },
  ],
}[ENV];