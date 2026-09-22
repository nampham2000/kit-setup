'use strict';
(async () => {
  const byId = id => document.getElementById(id);
  const status = byId('status');
  try {
    const response = await fetch('manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load the game list. Reload this page.');
    const hub = await response.json();
    if (hub.schemaVersion !== 1 || !Array.isArray(hub.games) || !hub.games.length) throw new Error('This hub has no games.');
    document.title = hub.title;
    byId('title').textContent = hub.title;
    byId('subtitle').textContent = hub.subtitle;
    byId('mark').textContent = hub.mark;
    let current = -1;
    let generation = 0;
    let timer;
    const buttons = [];
    for (const [index, game] of hub.games.entries()) {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${index + 1}. ${game.label}`;
      byId('brief').append(option);
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = option.textContent;
      button.addEventListener('click', () => play(index));
      li.append(button);
      byId('playlist').append(li);
      buttons.push(button);
    }
    function play(index) {
      if (!Number.isInteger(index) || index < 0 || index >= hub.games.length) return;
      current = index;
      const version = ++generation;
      clearTimeout(timer);
      document.querySelector('iframe')?.remove();
      const game = hub.games[index];
      byId('brief').value = index;
      byId('count').textContent = `${index + 1} / ${hub.games.length}`;
      byId('build-name').textContent = game.buildName;
      byId('prev').disabled = index === 0;
      byId('next').disabled = false;
      byId('replay').disabled = false;
      byId('next').textContent = index === hub.games.length - 1 ? 'First game ↻' : 'Next →';
      buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
      const url = new URL(location.href);
      url.searchParams.set('brief', game.id);
      history.replaceState(null, '', url);
      status.textContent = 'Loading game…';
      status.hidden = false;
      const frame = document.createElement('iframe');
      frame.title = `${hub.title} · ${game.label}`;
      frame.allow = 'autoplay; fullscreen';
      frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-popups-to-escape-sandbox');
      timer = setTimeout(() => {
        if (version === generation) status.textContent = 'The game is taking longer than expected. Try Replay.';
      }, 30000);
      frame.addEventListener('load', () => {
        if (version !== generation) return;
        clearTimeout(timer);
        status.hidden = true;
        const host = frame.contentWindow;
        if (host?.super_html) {
          host.super_html.download = () => {
            if (version !== generation) return;
            const sdk = host.super_html;
            const ios = /iPad|iPhone|iPod/i.test(host.navigator.userAgent);
            const target = ios ? sdk.appstore_url || sdk.google_play_url : sdk.google_play_url || sdk.appstore_url;
            let storeUrl;
            try { storeUrl = new URL(target); } catch { return; }
            if (storeUrl.protocol !== 'https:' || !['play.google.com', 'apps.apple.com'].includes(storeUrl.hostname)) return;
            status.textContent = 'CTA: ';
            const link = document.createElement('a');
            link.href = storeUrl.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Open store ↗';
            status.append(link);
            status.hidden = false;
            if (host.navigator.userActivation?.isActive) window.open(storeUrl.href, '_blank', 'noopener,noreferrer');
          };
        }
      });
      frame.src = game.path;
      byId('stage').append(frame);
    }
    byId('brief').addEventListener('change', event => play(Number(event.target.value)));
    byId('prev').addEventListener('click', () => play(current - 1));
    byId('next').addEventListener('click', () => play((current + 1) % hub.games.length));
    byId('replay').addEventListener('click', () => play(current));
    const requested = new URL(location.href).searchParams.get('brief');
    play(Math.max(0, hub.games.findIndex(game => game.id === requested)));
  } catch (error) {
    status.hidden = false;
    status.textContent = error.message;
  }
})();
