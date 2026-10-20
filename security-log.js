'use strict';
// security-log.js — LC3d: the pure parts of the account security log (importable, no I/O).
// server.js records every sign-in / 2FA / password event through recordAudit (audit_trail, append-only); this module
// names the events, turns a browser's user-agent into a readable device, and builds the alert e-mails. Nothing here may
// ever receive a secret: callers pass event names, reasons, IPs and user-agents — never a password, token or code.
const { emailHtml } = require('./email-html');

// Every action the security log shows the person (GET /api/auth/security-activity). Order is irrelevant.
const SECURITY_ACTIONS = [
  'SIGNUP', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT',
  'MFA_SETUP_STARTED', 'MFA_ENABLED', 'MFA_DISABLED', 'MFA_CODE_REJECTED',
  'CHANGE_PASSWORD', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', 'PASSWORD_RESET_FAILED',
  'SECURITY_ALERT', 'ACCOUNT_DELETED',
];

const LABELS = {
  SIGNUP: 'Account created', LOGIN: 'Signed in', LOGIN_FAILED: 'Failed sign-in', LOGOUT: 'Signed out',
  MFA_SETUP_STARTED: '2FA set-up started', MFA_ENABLED: '2FA turned on', MFA_DISABLED: '2FA turned off',
  MFA_CODE_REJECTED: 'Wrong 2FA code', CHANGE_PASSWORD: 'Password changed',
  PASSWORD_RESET_REQUESTED: 'Password reset requested', PASSWORD_RESET: 'Password reset',
  PASSWORD_RESET_FAILED: 'Password reset link refused', SECURITY_ALERT: 'Security e-mail', ACCOUNT_DELETED: 'Account deleted',
};

// "Chrome on Windows", "Safari on iPhone" — enough to recognise a device, nothing more (no version, no fingerprint).
function deviceLabel(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : null;
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) || /CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : null;
  if (br && os) return br + ' on ' + os;
  return br || os || 'Unknown device';
}

// The high-risk events that e-mail the account holder. Each returns { subject, html }; ctx = { name, ip, device, at }.
const ALERTS = {
  NEW_DEVICE_LOGIN: c => ({ subject: 'New device signed in to your FinFlow account',
    html: emailHtml`<p>Hi ${c.name || 'there'},</p><p>Your FinFlow account was just signed in to from a device we have not seen before:</p><p><b>${c.device}</b> · IP ${c.ip || 'unknown'} · ${c.at}</p><p>If this was you, there is nothing to do. If not, change your password now and turn on two-factor authentication (Settings → Security).</p>` }),
  MFA_DISABLED: c => ({ subject: 'Two-factor authentication was turned off on your FinFlow account',
    html: emailHtml`<p>Hi ${c.name || 'there'},</p><p>Two-factor authentication (2FA) was turned off on your FinFlow account from <b>${c.device}</b> · IP ${c.ip || 'unknown'} · ${c.at}.</p><p>If this was not you, change your password now and turn 2FA back on.</p>` }),
  CHANGE_PASSWORD: c => ({ subject: 'Your FinFlow password was changed',
    html: emailHtml`<p>Hi ${c.name || 'there'},</p><p>The password for your FinFlow account was changed from <b>${c.device}</b> · IP ${c.ip || 'unknown'} · ${c.at}. Every other device has been signed out.</p><p>If this was not you, reset your password now from the sign-in page.</p>` }),
  PASSWORD_RESET: c => ({ subject: 'Your FinFlow password was reset',
    html: emailHtml`<p>Hi ${c.name || 'there'},</p><p>The password for your FinFlow account was reset using an e-mailed link, from <b>${c.device}</b> · IP ${c.ip || 'unknown'} · ${c.at}. Every device has been signed out.</p><p>If this was not you, reset it again now and contact support.</p>` }),
};

module.exports = { SECURITY_ACTIONS, LABELS, ALERTS, deviceLabel };
