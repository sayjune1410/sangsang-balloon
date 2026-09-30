(() => {
  const C = window.APP_CONFIG;
  const palette = ['#F7C7C2','#FFD7A8','#FBE7A8','#CFE7B9','#BFE2DE','#C8DDF6','#D9C9F2','#F3C8E1','#E9D4BD'];
  const DEMO_KEY = `sangsang-demo:${C.EVENT_KEY}`;
  const PARTICIPANT_KEY = `sangsang-participant:${C.EVENT_KEY}`;
  const MY_WISH_KEY = `sangsang-my-wish:${C.EVENT_KEY}`;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`sangsang:${C.EVENT_KEY}`) : null;

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getParticipantKey() {
    let key = localStorage.getItem(PARTICIPANT_KEY);
    if (!key) { key = uuid(); localStorage.setItem(PARTICIPANT_KEY, key); }
    return key;
  }

  function getMyWishId() { return localStorage.getItem(MY_WISH_KEY) || ''; }
  function setMyWishId(id) { if (id) localStorage.setItem(MY_WISH_KEY, id); }

  function getParticipantUrl() {
    if (C.PARTICIPANT_URL && !C.PARTICIPANT_URL.includes('YOUR_')) return C.PARTICIPANT_URL;
    const u = new URL(window.location.href);
    u.hash = '';
    u.search = '';
    u.pathname = u.pathname.replace(/\/(wall|capture|qr)\.html$/i, '/index.html');
    if (!/\.html$/i.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/index.html');
    return u.toString();
  }

  function isConfigured() {
    return !C.DEMO_MODE && C.SUPABASE_URL && C.SUPABASE_ANON_KEY &&
      !C.SUPABASE_URL.includes('YOUR_') && !C.SUPABASE_ANON_KEY.includes('YOUR_');
  }

  function hashNum(str) {
    let h = 2166136261;
    for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h >>> 0);
  }

  function balloonVars(item, index=0) {
    const n = hashNum(item.id || String(index));
    return {
      color: palette[n % palette.length],
      rot: `${((n % 9) - 4) * .65}deg`,
      delay: `${-((n % 6) * .6)}s`
    };
  }

  function makeBalloon(item, opts={}) {
    const el = document.createElement('div');
    const v = balloonVars(item, opts.index || 0);
    el.className = `${opts.capture ? 'capture-balloon' : 'balloon'}${opts.mine ? ' mine' : ''}${opts.isNew ? ' new' : ''}`;
    el.dataset.id = item.id;
    el.style.setProperty('--b', v.color);
    el.style.setProperty('--rot', v.rot);
    el.style.animationDelay = opts.isNew ? '0s' : v.delay;
    el.innerHTML = `<div class="balloon-shape"><div class="wish"></div></div><div class="knot"></div><div class="string"></div>${opts.capture ? '' : '<div class="tag">익명의 상상장학생</div>'}`;
    el.querySelector('.wish').textContent = item.text;
    if (!opts.capture && opts.onClick) el.addEventListener('click', () => opts.onClick(item));
    return el;
  }

  function readDemo() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch { return []; }
  }
  function writeDemo(items) {
    localStorage.setItem(DEMO_KEY, JSON.stringify(items));
    channel?.postMessage({type:'refresh'});
  }

  async function supabaseClient() {
    if (!window.supabase?.createClient) throw new Error('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.');
    if (!window.__sangsangSupabase) window.__sangsangSupabase = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 5 } }
    });
    return window.__sangsangSupabase;
  }

  async function listWishes() {
    if (C.DEMO_MODE) return readDemo().filter(x => x.is_visible !== false).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    if (!isConfigured()) throw new Error('Supabase 설정이 아직 완료되지 않았습니다. config.js의 URL/Anon Key를 입력해주세요.');
    const sb = await supabaseClient();
    const { data, error } = await sb.from('wishes').select('id,text,created_at,participant_key').eq('event_key', C.EVENT_KEY).eq('is_visible', true).order('created_at', {ascending:true});
    if (error) throw error;
    return data || [];
  }

  async function getEventSettings() {
    if (C.DEMO_MODE) return { is_open: true };
    if (!isConfigured()) return { is_open: false };
    const sb = await supabaseClient();
    const { data, error } = await sb.from('event_settings').select('is_open').eq('event_key', C.EVENT_KEY).maybeSingle();
    if (error) throw error;
    return data || { is_open: true };
  }

  async function addWish(text) {
    const clean = text.trim();
    if (!clean) throw new Error('다짐을 입력해주세요.');
    if (clean.length > C.MAX_WISH_LENGTH) throw new Error(`다짐은 최대 ${C.MAX_WISH_LENGTH}자까지 입력할 수 있습니다.`);
    const participantKey = getParticipantKey();

    if (C.ONE_WISH_PER_DEVICE && getMyWishId()) throw new Error('이 기기에서는 이미 풍선을 띄웠어요.');

    if (C.DEMO_MODE) {
      const items = readDemo();
      const item = { id: uuid(), event_key:C.EVENT_KEY, text:clean, participant_key:participantKey, is_visible:true, created_at:new Date().toISOString() };
      if (C.ONE_WISH_PER_DEVICE && items.some(x => x.participant_key === participantKey)) throw new Error('이 기기에서는 이미 풍선을 띄웠어요.');
      items.push(item); writeDemo(items); setMyWishId(item.id); return item;
    }

    if (!isConfigured()) throw new Error('Supabase 설정이 아직 완료되지 않았습니다.');
    const settings = await getEventSettings();
    if (!settings.is_open) throw new Error('온라인 참여가 마감되었습니다.');
    const sb = await supabaseClient();
    const { data, error } = await sb.from('wishes').insert({ event_key:C.EVENT_KEY, text:clean, participant_key:participantKey }).select('id,text,created_at,participant_key').single();
    if (error) {
      if (error.code === '23505') throw new Error('이 기기에서는 이미 풍선을 띄웠어요.');
      throw error;
    }
    setMyWishId(data.id); return data;
  }

  async function subscribe(onChange) {
    if (C.DEMO_MODE) {
      const storageHandler = e => { if (e.key === DEMO_KEY) onChange(); };
      window.addEventListener('storage', storageHandler);
      channel?.addEventListener('message', onChange);
      return () => { window.removeEventListener('storage', storageHandler); channel?.removeEventListener('message', onChange); };
    }
    if (!isConfigured()) return () => {};
    const sb = await supabaseClient();
    const ch = sb.channel(`wishes-${C.EVENT_KEY}`).on('postgres_changes', { event:'*', schema:'public', table:'wishes', filter:`event_key=eq.${C.EVENT_KEY}` }, () => onChange()).subscribe();
    return () => sb.removeChannel(ch);
  }

  function showModal(item) {
    const modal = document.getElementById('modal');
    const text = document.getElementById('modalText');
    if (!modal || !text) return;
    text.textContent = item.text;
    modal.classList.add('on');
  }
  function bindModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    document.getElementById('closeModal')?.addEventListener('click',()=>modal.classList.remove('on'));
    modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('on'); });
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(()=>t.classList.remove('on'),1800);
  }
  function setCount(n) { document.querySelectorAll('[data-count]').forEach(el => el.textContent = String(n)); }
  function setStatus(msg, error=false) {
    const el = document.getElementById('statusCard');
    if (!el) return;
    el.textContent = msg; el.classList.toggle('error', error); el.classList.toggle('on', !!msg);
  }

  window.SangsangApp = {
    C, palette, uuid, getParticipantKey, getMyWishId, setMyWishId, getParticipantUrl,
    isConfigured, listWishes, addWish, subscribe, makeBalloon, showModal, bindModal,
    toast, setCount, setStatus, getEventSettings
  };
})();
