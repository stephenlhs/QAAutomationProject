import { URLS } from '../config.js';

const BO_BASE = URLS.backoffice.replace('/login', '');

export const URL = {
  // Playsite
  playsite:           URLS.playsite,
  login:              URLS.playsite,
  withdrawal:         `${URLS.playsite}user/withdrawal`,
  statement:          `${URLS.playsite}user/statement`,
  mybets:             `${URLS.playsite}user/mybets`,
  account:            `${URLS.playsite}user/account`,
  egame:              `${URLS.playsite}e-game`,

  // Backoffice
  boLogin:            URLS.backoffice,
  boDashboard:        `${BO_BASE}/dashboard/home`,
  boDepositList:      `${BO_BASE}/dashboard/cash/deposit-list`,
  boWithdrawList:     `${BO_BASE}/dashboard/cash/withdraw-list`,
  boMemberList:       `${BO_BASE}/dashboard/cash/cash-member/list-compact`,
  boMemberCreate:     `${BO_BASE}/dashboard/cash/cash-member/create-compact`,
};