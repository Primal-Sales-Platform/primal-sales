(function () {
  'use strict';
  const dialog = document.getElementById('trial-dialog');
  const form = document.getElementById('trial-form');
  const open = document.getElementById('open-trial');
  const error = document.getElementById('trial-error');
  const submit = form.querySelector('[type="submit"]');
  const key = 'primal-connected-trial-resume';
  let busy = false;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* Storage is optional. */ }
  const total = () => {
    const amount = 1497 + Math.max(0, Number(form.elements.seats.value) - 3) * 497;
    document.getElementById('trial-total').textContent = 'Your total: $' + amount.toLocaleString('en-US') + '/month after the trial';
  };
  const show = () => {
    if (saved && typeof saved.email === 'string') {
      form.elements.email.value = saved.email;
      form.elements.name.value = saved.name || '';
      form.elements.companyName.value = saved.companyName || '';
      form.elements.seats.value = String(saved.seats || 3);
      total();
    }
    dialog.showModal();
  };
  open.addEventListener('click', show);
  dialog.querySelector('.ce-close').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', () => open.focus());
  form.elements.seats.addEventListener('change', total);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    const body = { flow: 'connected-experience', name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(), companyName: form.elements.companyName.value.trim(),
      seats: Number(form.elements.seats.value), tosAccepted: form.elements.tosAccepted.checked };
    if (saved && saved.email.toLowerCase() === body.email.toLowerCase()) body.resumeToken = saved.resumeToken;
    busy = true; submit.disabled = true; submit.textContent = 'Opening secure checkout…'; error.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('https://app.primalsales.ai/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json();
      if (data.resumeToken) {
        saved = { resumeToken: data.resumeToken, email: body.email, name: body.name, companyName: body.companyName, seats: body.seats };
        try { sessionStorage.setItem(key, JSON.stringify(saved)); } catch { /* Retry still works in this page. */ }
      }
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not open checkout. Please try again.');
      const destination = new URL(data.url);
      if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com') throw new Error('Could not open secure checkout. Please try again.');
      window.location.assign(destination.href);
    } catch (err) {
      error.textContent = err.name === 'AbortError' ? 'Checkout is taking longer than expected. Please try again.' : (err.message || 'Could not connect. Please try again.');
      error.hidden = false;
      busy = false; submit.disabled = false; submit.textContent = 'Continue to card details →';
    } finally { clearTimeout(timeout); }
  });
  if (new URLSearchParams(window.location.search).get('checkout') === 'canceled') show();
}());
