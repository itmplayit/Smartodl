'use strict';

/**
 * `requireCaptcha` sits on the credential-entry routes (register, login,
 * forgot-password). It is a deliberate no-op until CAPTCHA_ENABLED=true, so
 * adding it to a route costs nothing on installs that do not want it.
 */

const { ApiError } = require('../utils/helpers');
const captcha = require('../services/captcha.service');

function ipOf(req) {
  const fwd = req.headers ? req.headers['x-forwarded-for'] : '';
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip || '';
}

const requireCaptcha = (req, _res, next) => {
  captcha
    .verify(req.body || {}, ipOf(req))
    .then((result) => {
      if (!result.ok) return next(ApiError.badRequest(result.reason || 'CAPTCHA verification failed'));
      return next();
    })
    .catch(next);
};

module.exports = { requireCaptcha };
