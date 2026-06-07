export const scheduledScripts: Array<{
  id: string;
  fn: string;
  address: string;
  code: string;
}> = [
  {
    id: 'send-scheduled-linkedin-message',
    fn: 'sendMessage',
    address: 'https://www.linkedin.com',
    code: `(async () => {
  globalThis.__vallumDeferredReplay = true;
  try {
    const { getContext, sendMessage } = await import('@vallum/linkedin');
    const ctx = await getContext({});
    const res = await sendMessage({ csrf: ctx.csrf, myMemberId: ctx.memberId, recipient: __params.target, text: __params.body || '' });
    if (res && res.queued === true) return { ok: false, error: 'requeued_by_gate', name: 'RateLimited' };
    if (res && res.success === false) return { ok: false, error: res.error || 'unknown' };
    return { ok: true, urn: (res && res.messageUrn) || '' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), name: String((e && e.name) || '') }; }
  finally { globalThis.__vallumDeferredReplay = false; }
})()`,
  },
  {
    id: 'send-scheduled-linkedin-connection',
    fn: 'sendConnectionRequest',
    address: 'https://www.linkedin.com',
    code: `(async () => {
  globalThis.__vallumDeferredReplay = true;
  try {
    const { getContext, sendConnectionRequest } = await import('@vallum/linkedin');
    const ctx = await getContext({});
    const res = await sendConnectionRequest({ csrf: ctx.csrf, memberId: __params.target, customMessage: __params.body || undefined });
    if (res && res.queued === true) return { ok: false, error: 'requeued_by_gate', name: 'RateLimited' };
    if (res && res.success === false) {
      const err = res.error || 'unknown';
      // CANT_RESEND_YET = already connected / invite already pending. This can
      // never succeed on retry, so signal the drainer to STOP retrying.
      if (typeof err === 'string' && err.indexOf('CANT_RESEND_YET') !== -1) {
        return { ok: false, error: err, stop: true };
      }
      return { ok: false, error: err };
    }
    return { ok: true, urn: (res && res.invitationUrn) || '' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), name: String((e && e.name) || '') }; }
  finally { globalThis.__vallumDeferredReplay = false; }
})()`,
  },
];
