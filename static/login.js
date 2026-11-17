const form = document.querySelector('#login-form'), error = document.querySelector('#login-error');
const MESSAGES = { 401: 'Usuário ou senha incorretos.', 429: 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.' };
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  error.hidden = true;
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ user: form.user.value, password: form.password.value }),
    });
    if (r.ok) { location.href = '/'; return; }
    error.textContent = MESSAGES[r.status] ?? `Não foi possível entrar (HTTP ${r.status}).`;
  } catch {
    error.textContent = 'Sem conexão com o servidor.';
  }
  error.hidden = false;
  button.disabled = false;
  form.password.select();
});
