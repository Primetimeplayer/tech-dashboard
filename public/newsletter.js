(function () {
  var KEY = 'signal_tech_newsletter';
  var form = document.getElementById('newsletterForm');
  if (!form) return;
  var card = form.closest('.newsletter-card');
  var input = form.querySelector('input[type="email"]');
  var error = form.querySelector('.newsletter-error');
  var success = form.querySelector('.newsletter-success');

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }

  function showSuccess() {
    if (card) card.classList.add('is-done');
    if (error) error.hidden = true;
    if (success) success.hidden = false;
  }

  var existing = read();
  if (existing && existing.consent && existing.email) showSuccess();

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function isPlaceholder(url) {
    return !url || /YOUR_/i.test(url);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = (input.value || '').trim();
    if (!validEmail(email)) {
      input.setAttribute('aria-invalid', 'true');
      if (error) {
        error.hidden = false;
        error.textContent = 'Enter a valid email address.';
      }
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    if (error) error.hidden = true;
    try {
      localStorage.setItem(KEY, JSON.stringify({
        email: email,
        consent: true,
        subscribedAt: new Date().toISOString()
      }));
    } catch (e) {}
    var hook = form.getAttribute('data-webhook');
    if (hook && /^https:\/\//i.test(hook) && !isPlaceholder(hook)) {
      fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, consent: true, source: 'signal-tech' })
      }).catch(function () {});
    }
    showSuccess();
  });
})();
