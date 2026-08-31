'use strict';

const axios = require('axios');

function isConfigured() {
  const appId = String(process.env.ONESIGNAL_APP_ID || '').trim();
  const apiKey = String(process.env.ONESIGNAL_REST_API_KEY || '').trim();
  return Boolean(appId && apiKey);
}

/**
 * Proaktif karakter mesajı için OneSignal push planlar.
 * external_user_id = userId (Flutter OneSignal.login ile set edilir).
 *
 * @param {{
 *   userId: number|string,
 *   title: string,
 *   body: string,
 *   agentId?: number,
 *   conversationId?: number,
 *   messageId?: number,
 *   sendAfter?: Date|null,
 *   imageUrl?: string|null,
 *   lang?: string,
 * }} opts
 */
async function scheduleProactivePush(opts) {
  if (!isConfigured()) return { ok: false, skipped: 'not_configured' };

  const userId = opts?.userId;
  const title = String(opts?.title || 'Friendify').trim();
  const body = String(opts?.body || '').trim();
  if (userId == null || !body) {
    return { ok: false, skipped: 'missing_fields' };
  }

  const appId = process.env.ONESIGNAL_APP_ID.trim();
  const apiKey = process.env.ONESIGNAL_REST_API_KEY.trim();
  const lang = String(opts?.lang || 'en').slice(0, 2);

  const payload = {
    app_id: appId,
    target_channel: 'push',
    include_aliases: {
      external_id: [String(userId)],
    },
    headings: { [lang]: title, en: title },
    contents: { [lang]: body, en: body },
    data: {
      action: 'proactiveMessage',
      agentId: opts?.agentId ?? null,
      conversationId: opts?.conversationId ?? null,
      messageId: opts?.messageId ?? null,
    },
    ios_badgeType: 'Increase',
    ios_badgeCount: 1,
  };

  if (opts?.sendAfter instanceof Date && opts.sendAfter.getTime() > Date.now() + 5000) {
    payload.send_after = opts.sendAfter.toISOString();
  }

  const imageUrl = String(opts?.imageUrl || '').trim();
  if (imageUrl.startsWith('http')) {
    payload.big_picture = imageUrl;
    payload.ios_attachments = { id1: imageUrl };
  }

  try {
    const res = await axios.post(
      'https://api.onesignal.com/notifications',
      payload,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return { ok: true, id: res.data?.id ?? null };
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.warn('[OneSignal] proactive push failed (aliases):', detail);

    // Eski external_id formatı ile bir kez daha dene.
    try {
      const legacyPayload = {
        app_id: appId,
        include_external_user_ids: [String(userId)],
        headings: payload.headings,
        contents: payload.contents,
        data: payload.data,
        ios_badgeType: payload.ios_badgeType,
        ios_badgeCount: payload.ios_badgeCount,
      };
      if (payload.send_after) legacyPayload.send_after = payload.send_after;
      if (payload.big_picture) {
        legacyPayload.big_picture = payload.big_picture;
        legacyPayload.ios_attachments = payload.ios_attachments;
      }

      const retry = await axios.post(
        'https://api.onesignal.com/notifications',
        legacyPayload,
        {
          headers: {
            Authorization: `Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      return { ok: true, id: retry.data?.id ?? null, retried: true };
    } catch (retryErr) {
      const retryDetail = retryErr.response?.data || retryErr.message;
      console.warn('[OneSignal] proactive push failed (legacy):', retryDetail);
      return { ok: false, error: retryDetail, fallbackLocal: true };
    }
  }
}

module.exports = {
  isConfigured,
  scheduleProactivePush,
};
