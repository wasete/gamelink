(() => {

  // Playful neon cursor that follows the pointer on desktop and shows ripples on touch.
  const orb = document.getElementById('cursorOrb');
  let lastTrail = 0;
  if (orb && window.matchMedia('(pointer:fine)').matches) {
    document.addEventListener('pointermove', (e) => {
      orb.style.left = e.clientX + 'px';
      orb.style.top = e.clientY + 'px';
      orb.classList.add('visible');
      const now = performance.now();
      if (now - lastTrail > 38) {
        lastTrail = now;
        const dot = document.createElement('span');
        dot.className = 'cursor-trail';
        dot.style.left = e.clientX + 'px';
        dot.style.top = e.clientY + 'px';
        document.body.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove(), {once:true});
      }
    }, {passive:true});
    document.addEventListener('pointerleave', () => orb.classList.remove('visible'));
    document.addEventListener('pointerdown', (e) => {
      const ripple = document.createElement('span');
      ripple.className = 'tap-ripple';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), {once:true});
    }, {passive:true});
  } else {
    document.addEventListener('touchstart', (e) => {
      const touch = e.touches && e.touches[0]; if (!touch) return;
      const ripple = document.createElement('span');
      ripple.className = 'tap-ripple';
      ripple.style.left = touch.clientX + 'px';
      ripple.style.top = touch.clientY + 'px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), {once:true});
    }, {passive:true});
  }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let supabase = null, session = null, activeTrade = null, publicChannel = null, tradeChannel = null;
  let demoTrade = null;
  const config = window.GAMELINK_CONFIG || {};
  const connected = !!(window.supabase && config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  if (connected) {
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    $('#connectionState').textContent = 'اتصال آماده';
    $('#connectionState').classList.add('connected');
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }
  function escapeHTML(s='') {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtTime(d = new Date()) { return d.toLocaleTimeString('fa-IR', {hour:'2-digit', minute:'2-digit'}); }
  function messageNode(msg, own=false) {
    const div = document.createElement('div');
    div.className = 'message-row' + (own ? ' own' : '');
    div.innerHTML = `<div class="msg-avatar">${escapeHTML((msg.username || 'G').slice(0,1).toUpperCase())}</div><div class="msg-content"><div class="msg-meta"><b>${escapeHTML(msg.username || 'عضو')}</b><time>${escapeHTML(msg.time || fmtTime(msg.created_at ? new Date(msg.created_at) : new Date()))}</time></div><div class="bubble">${escapeHTML(msg.content || '')}</div></div>`;
    return div;
  }
  function addMessage(container, msg, own=false) {
    const welcome = container.querySelector('.welcome-card'); if (welcome) welcome.remove();
    container.appendChild(messageNode(msg, own)); container.scrollTop = container.scrollHeight;
  }
  function setUser(user) {
    session = user;
    const name = user ? (user.user_metadata?.username || user.email?.split('@')[0] || 'عضو') : 'مهمان';
    $('#userLabel').textContent = name;
    $('#userStatus').textContent = user ? 'عضو GameLink' : 'برای چت وارد شو';
    $('#myAvatar').textContent = name.slice(0,1).toUpperCase();
    $('#profileAvatar').textContent = name.slice(0,1).toUpperCase();
    $('#profileName').textContent = user ? name : 'مهمان GameLink';
    $('#profileEmail').textContent = user?.email || 'برای استفاده از چت وارد شو.';
    $('#authBtn').textContent = user ? 'خروج' : 'ورود';
    $('#profileAuthBtn').textContent = user ? 'خروج از حساب' : 'ورود / ثبت‌نام';
    $('#publicInput').disabled = !user;
    $('#publicInput').placeholder = user ? 'پیامت رو بنویس...' : 'برای ارسال پیام ابتدا وارد شو';
    $('#publicForm').querySelector('button[type="submit"]').disabled = !user;
    if (user) checkAdmin();
    else $('#adminNav').hidden = true;
  }
  async function checkAdmin() {
    if (!supabase || !session) return;
    const {data} = await supabase.from('profiles').select('role').eq('id', session.id).maybeSingle();
    $('#adminNav').hidden = !data || !['admin','assistant'].includes(data.role);
  }
  function navigate(view) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-item').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    const titles = {public:'چت عمومی', market:'بازار اکانت‌ها', trades:'اتاق‌های معامله', profile:'پروفایل', admin:'پنل مدیریت'};
    $('#pageTitle').textContent = titles[view] || 'GameLink';
  }
  $$('.nav-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.goto)));
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#themeBtnTop').addEventListener('click', toggleTheme);
  function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('gamelink-theme', isDark ? 'dark' : 'light');
    $('#themeBtn').textContent = isDark ? '☀️ تم روشن' : '🌙 تم نئونی';
  }
  if (localStorage.getItem('gamelink-theme') === 'dark') document.body.classList.add('dark');

  function openAuth() { $('#authModal').hidden = false; $('#authResult').textContent = ''; }
  function closeAuth() { $('#authModal').hidden = true; }
  $('#authBtn').addEventListener('click', async () => {
    if (session && supabase) { await supabase.auth.signOut(); setUser(null); toast('از حساب خارج شدی.'); }
    else openAuth();
  });
  $('#profileAuthBtn').addEventListener('click', async () => {
    if (session && supabase) { await supabase.auth.signOut(); setUser(null); toast('از حساب خارج شدی.'); }
    else openAuth();
  });
  $('#closeAuth').addEventListener('click', closeAuth);
  $('#authModal').addEventListener('click', e => { if (e.target === $('#authModal')) closeAuth(); });
  async function auth(mode) {
    const email = $('#authEmail').value.trim(), password = $('#authPassword').value;
    if (!supabase) { $('#authResult').textContent = 'برای ورود واقعی، ابتدا Supabase را در config.js تنظیم کن. در حال حاضر سایت در حالت نمایشی است.'; return; }
    $('#authResult').textContent = 'در حال انجام...';
    const result = mode === 'signup'
      ? await supabase.auth.signUp({email, password, options:{data:{username:email.split('@')[0]}}})
      : await supabase.auth.signInWithPassword({email, password});
    if (result.error) { $('#authResult').textContent = result.error.message; return; }
    if (mode === 'signup' && !result.data.session) $('#authResult').textContent = 'حساب ساخته شد. ایمیلت را برای تأیید بررسی کن، سپس وارد شو.';
    else { setUser(result.data.user); closeAuth(); toast('با موفقیت وارد شدی.'); loadPublicMessages(); }
  }
  $('#authForm').addEventListener('submit', e => { e.preventDefault(); auth('signin'); });
  $('#signUpBtn').addEventListener('click', () => auth('signup'));

  async function loadPublicMessages() {
    const box = $('#publicMessages');
    if (!supabase) return;
    const {data, error} = await supabase.from('public_messages').select('id, user_id, username, content, created_at').order('created_at', {ascending:true}).limit(100);
    if (error) { toast('بارگذاری پیام‌ها ناموفق بود. تنظیمات دیتابیس را بررسی کن.'); return; }
    box.innerHTML = '';
    if (!data.length) box.innerHTML = '<div class="welcome-card"><div class="welcome-emoji">👋</div><h3>اولین پیام رو تو بفرست!</h3><p>چت عمومی آماده است.</p></div>';
    data.forEach(m => addMessage(box, {...m, time:fmtTime(new Date(m.created_at))}, m.user_id === session?.id));
    if (publicChannel) supabase.removeChannel(publicChannel);
    publicChannel = supabase.channel('public-room').on('postgres_changes', {event:'INSERT', schema:'public', table:'public_messages'}, payload => {
      const m = payload.new;
      if (!box.querySelector(`[data-id="${m.id}"]`)) {
        const node = messageNode({...m, time:fmtTime(new Date(m.created_at))}, m.user_id === session?.id);
        node.dataset.id = m.id;
        const welcome = box.querySelector('.welcome-card'); if (welcome) welcome.remove();
        box.appendChild(node); box.scrollTop = box.scrollHeight;
      }
    }).subscribe();
  }
  $('#publicForm').addEventListener('submit', async e => {
    e.preventDefault();
    const content = $('#publicInput').value.trim(); if (!content) return;
    if (!session) { openAuth(); return; }
    if (!supabase) { toast('برای ارسال واقعی پیام، Supabase را تنظیم کن.'); return; }
    const username = session.user_metadata?.username || session.email.split('@')[0];
    const {error} = await supabase.from('public_messages').insert({user_id:session.id, username, content});
    if (error) toast('پیام ارسال نشد: ' + error.message);
    else $('#publicInput').value = '';
  });
  $('#emojiBtn').addEventListener('click', () => { const i=$('#publicInput'); i.value += ' 😊'; i.focus(); });

  $('#newListingBtn').addEventListener('click', () => {
    if (!session) { openAuth(); return; }
    const title = prompt('عنوان آگهی:'); if (!title?.trim()) return;
    const game = prompt('نام بازی:') || 'بازی';
    const description = prompt('توضیحات آگهی:') || 'برای جزئیات بیشتر پیام بده.';
    if (!supabase) { toast('ثبت آگهی واقعی پس از اتصال Supabase فعال می‌شود.'); return; }
    supabase.from('listings').insert({user_id:session.id, title:title.trim(), game:game.trim(), description:description.trim(), status:'active'})
      .then(({error}) => error ? toast('ثبت آگهی ناموفق بود: '+error.message) : (toast('آگهی ثبت شد.'), loadListings()));
  });
  async function loadListings() {
    if (!supabase) return;
    const {data,error}=await supabase.from('listings').select('id,title,game,description,status,created_at').eq('status','active').order('created_at',{ascending:false}).limit(30);
    if (error || !data) return;
    const grid=$('#marketGrid'); grid.innerHTML='';
    if (!data.length) { grid.innerHTML='<div class="rail-card">هنوز آگهی‌ای ثبت نشده است.</div>'; return; }
    data.forEach((x,i) => {
      const article=document.createElement('article'); article.className='listing-card';
      article.innerHTML=`<div class="listing-cover ${['cover-pink','cover-blue','cover-purple'][i%3]}">${['🎯','🚗','⚽'][i%3]}</div><div class="listing-body"><span class="tag">${escapeHTML(x.game)}</span><h3>${escapeHTML(x.title)}</h3><p>${escapeHTML(x.description)}</p><div class="listing-foot"><b>قیمت توافقی</b><button class="outline-btn" data-goto="trades">درخواست معامله</button></div></div>`;
      article.querySelector('button').addEventListener('click',()=>navigate('trades')); grid.appendChild(article);
    });
  }

  $('#joinTradeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code=$('#tradeCode').value.trim().toUpperCase();
    if (!session) { openAuth(); return; }
    if (!supabase) {
      $('#joinTradeResult').textContent='حالت نمایشی: برای ورود واقعی باید کد اتاق از دیتابیس بررسی شود.';
      return;
    }
    const {data,error}=await supabase.rpc('join_trade_room', {invite_code:code});
    if (error || !data) { $('#joinTradeResult').textContent='کد نامعتبر است یا اجازه ورود نداری.'; return; }
    activeTrade=data;
    $('#tradeRoomTitle').textContent=data.title;
    $('#tradeRoomSubtitle').textContent='اتاق معامله فعال · کد '+code;
    $('#tradeInput').disabled=false; $('#tradeForm button').disabled=false;
    $('#tradeMessages').innerHTML='<div class="welcome-card"><div class="welcome-emoji">🤝</div><h3>گفت‌وگو شروع شد</h3><p>لطفاً توافق‌ها را روشن ثبت کنید.</p></div>';
    loadTradeMessages();
    navigate('trades');
    $('#joinTradeResult').textContent='وارد اتاق شدی.';
  });
  async function loadTradeMessages() {
    if (!supabase || !activeTrade) return;
    const box=$('#tradeMessages');
    const {data,error}=await supabase.from('trade_messages').select('id,user_id,username,content,created_at').eq('room_id',activeTrade.id).order('created_at',{ascending:true}).limit(100);
    if (error) { toast('پیام‌های اتاق بارگذاری نشدند.'); return; }
    box.innerHTML=''; data.forEach(m=>addMessage(box,{...m,time:fmtTime(new Date(m.created_at))},m.user_id===session?.id));
    if (tradeChannel) supabase.removeChannel(tradeChannel);
    tradeChannel=supabase.channel('trade-'+activeTrade.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'trade_messages',filter:'room_id=eq.'+activeTrade.id},payload=>{
      const m=payload.new; const node=messageNode({...m,time:fmtTime(new Date(m.created_at))},m.user_id===session?.id); node.dataset.id=m.id;
      const welcome=box.querySelector('.welcome-card'); if(welcome) welcome.remove(); box.appendChild(node); box.scrollTop=box.scrollHeight;
    }).subscribe();
  }
  $('#tradeForm').addEventListener('submit', async e=>{
    e.preventDefault(); const content=$('#tradeInput').value.trim(); if(!content||!session||!activeTrade||!supabase)return;
    const username=session.user_metadata?.username||session.email.split('@')[0];
    const {error}=await supabase.from('trade_messages').insert({room_id:activeTrade.id,user_id:session.id,username,content});
    if(error) toast('ارسال پیام ناموفق بود: '+error.message); else $('#tradeInput').value='';
  });
  $('#createTradeForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!session){openAuth();return;}
    if(!supabase){$('#createdTradeResult').textContent='حالت نمایشی: برای ساخت اتاق واقعی ابتدا Supabase و نقش مدیر را تنظیم کن.';return;}
    const title=$('#tradeTitle').value.trim(), buyer=$('#buyerName').value.trim(), seller=$('#sellerName').value.trim();
    const {data,error}=await supabase.rpc('create_trade_room',{room_title:title,buyer_username:buyer,seller_username:seller});
    if(error){$('#createdTradeResult').textContent='ساخت اتاق ناموفق بود. مطمئن شو حساب تو نقش مدیر دارد.';return;}
    $('#createdTradeResult').innerHTML=`کد اتاق ساخته شد: <b>${escapeHTML(data.invite_code)}</b> <button type="button" class="tiny-btn" id="copyCode">کپی</button>`;
    $('#copyCode').addEventListener('click',()=>navigator.clipboard.writeText(data.invite_code).then(()=>toast('کد کپی شد.')));
    $('#createTradeForm').reset();
  });
  async function init() {
    if (supabase) {
      const {data}=await supabase.auth.getSession(); setUser(data.session?.user || null);
      supabase.auth.onAuthStateChange((_event,s) => { setUser(s?.user || null); if(s?.user){loadPublicMessages();loadListings();} });
      await loadPublicMessages(); await loadListings();
    } else {
      setUser(null);
      $('#publicMessages').innerHTML='<div class="welcome-card"><div class="welcome-emoji">👋</div><h3>به جمعمون خوش اومدی!</h3><p>ظاهر سایت آماده است. برای چت زنده و ورود واقعی، Supabase را در config.js تنظیم کن و SQL همراه پروژه را اجرا کن.</p></div>';
    }
  }
  // Private messages (requires the matching SQL migration below).
let activeDM = null, dmChannel = null;
async function openDM(username) {
  if (!session) { openAuth(); return; }
  if (!supabase) { $('#dmResult').textContent='برای پیوی واقعی ابتدا Supabase را تنظیم کن.'; return; }
  const {data,error}=await supabase.rpc('open_direct_conversation',{target_username:username.trim()});
  if(error || !data) { $('#dmResult').textContent='کاربر پیدا نشد یا امکان باز کردن پیوی وجود ندارد.'; return; }
  activeDM=data; $('#dmTitle').textContent='پیوی با '+username.trim(); $('#dmSubtitle').textContent='گفت‌وگوی خصوصی بین دو عضو';
  $('#dmInput').disabled=false; $('#dmForm button').disabled=false; $('#dmResult').textContent='گفت‌وگو باز شد.';
  await loadDMMessages(); navigate('inbox');
}
$('#dmOpenForm')?.addEventListener('submit',e=>{e.preventDefault();openDM($('#dmUsername').value);});
async function loadDMMessages(){
  if(!supabase||!activeDM)return; const box=$('#dmMessages');
  const {data,error}=await supabase.from('direct_messages').select('id,conversation_id,sender_id,username,content,created_at').eq('conversation_id',activeDM.id).order('created_at',{ascending:true}).limit(100);
  if(error){$('#dmResult').textContent='بارگذاری پیوی ناموفق بود. '+error.message;return;}
  box.innerHTML=''; if(!data.length) box.innerHTML='<div class="welcome-card"><h3>اولین پیام رو بفرست!</h3></div>';
  data.forEach(m=>{const n=messageNode({username:m.username,content:m.content,time:fmtTime(new Date(m.created_at))},m.sender_id===session.id);n.dataset.id=m.id;box.appendChild(n);}); box.scrollTop=box.scrollHeight;
  if(dmChannel) supabase.removeChannel(dmChannel);
  dmChannel=supabase.channel('dm-'+activeDM.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'direct_messages',filter:'conversation_id=eq.'+activeDM.id},payload=>{
    const m=payload.new;if(box.querySelector(`[data-id="${m.id}"]`))return;const n=messageNode({username:m.username,content:m.content,time:fmtTime(new Date(m.created_at))},m.sender_id===session?.id);n.dataset.id=m.id;const w=box.querySelector('.welcome-card');if(w)w.remove();box.appendChild(n);box.scrollTop=box.scrollHeight;
  }).subscribe();
}
$('#dmForm')?.addEventListener('submit',async e=>{e.preventDefault();const content=$('#dmInput').value.trim();if(!content||!session||!activeDM||!supabase)return;const username=session.user_metadata?.username||session.email.split('@')[0];const {error}=await supabase.from('direct_messages').insert({conversation_id:activeDM.id,sender_id:session.id,username,content});if(error)toast('پیام خصوصی ارسال نشد: '+error.message);else $('#dmInput').value='';});

  init();
})();
