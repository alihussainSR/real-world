const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json'}});
const enc=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const rnd=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
async function hash(p,salt,it=100000){const k=await crypto.subtle.importKey('raw',enc.encode(p),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:it},k,256));}
const IT=25000;async function hv(p,u){const m=/^p(\d+):(.*)$/.exec(u.hash);return m?(await hash(p,u.salt,+m[1]))===m[2]:(await hash(p,u.salt))===u.hash}
const TB='CREATE TABLE IF NOT EXISTS scores2(uid INTEGER PRIMARY KEY,name TEXT,best INTEGER,hp INTEGER,diff INTEGER)';
const cl=(v,a,b)=>Math.min(Math.max(v|0,a),b);
const SYS='أنت مساعد سيرفر ماينكرافت «العالم الواقعي». جاوب بالعربية بلهجة ودودة ومختصرة، وتقدر تجاوب على أي سؤال (رياضيات، علوم، برمجة، ألعاب، معلومات عامة). في المسائل الحسابية اشرح الخطوات باختصار واكتب الناتج النهائي بدقة. السيرفر مجاني ويدعم لعبة Doors والموسيقى التفاعلية.';
async function handle(request,env){try{return await inner(request,env)}catch(e){return J({error:"خطأ في السيرفر: تأكد من ربط DB و AI وإنشاء الجداول"},500)}}
let RDY=0,TC=null,TT=0;const ensure=async env=>{if(!RDY){await env.DB.prepare(TB).run();RDY=1}};
async function inner(request,env){
 const path=new URL(request.url).pathname.replace(/^\/api\/?/,'');
 const post=request.method==='POST';
 const b=post?await request.json().catch(()=>({})):{};
 const tok=(request.headers.get('authorization')||'').slice(7);
 const me=tok?await env.DB.prepare('SELECT u.id,u.name,u.admin FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token=?').bind(tok).first():null;
 const login=async id=>{const t=rnd()+rnd();await env.DB.prepare('INSERT INTO sessions VALUES(?,?)').bind(t,id).run();return t;};
 if(path==='register'&&post){
  const n=String(b.name||'').trim(),p=String(b.pass||'');
  if(!/^[\w\u0600-\u06FF]{3,20}$/.test(n))return J({error:'الاسم 3-20 حرف بدون مسافات'},400);
  if(p.length<6)return J({error:'كلمة المرور 6 أحرف على الأقل'},400);
  if(await env.DB.prepare('SELECT 1 FROM users WHERE name=?').bind(n).first())return J({error:'الاسم مستخدم مسبقاً'},400);
  const cnt=(await env.DB.prepare('SELECT COUNT(*) c FROM users').first()).c;
  const salt=rnd();
  const r=await env.DB.prepare('INSERT INTO users(name,hash,salt,admin) VALUES(?,?,?,?)').bind(n,'p'+IT+':'+await hash(p,salt,IT),salt,cnt?0:1).run();
  return J({token:await login(r.meta.last_row_id),user:{name:n,admin:cnt?0:1}});
 }
 if(path==='login'&&post){
  const u=await env.DB.prepare('SELECT * FROM users WHERE name=?').bind(String(b.name||'').trim()).first();
  if(!u||!(await hv(String(b.pass||''),u)))return J({error:'الاسم أو كلمة المرور غير صحيحة'},401);
  return J({token:await login(u.id),user:{name:u.name,admin:u.admin}});
 }
 if(path==='news'&&!post)return J((await env.DB.prepare('SELECT id,tag,text FROM news ORDER BY id DESC LIMIT 20').all()).results);
 if(path==='top'&&!post){if(TC&&Date.now()-TT<1000)return J(TC);await ensure(env);TC=(await env.DB.prepare('SELECT name,best,hp,diff FROM scores2 ORDER BY best DESC LIMIT 10').all()).results;TT=Date.now();return J(TC);}
 if(!me)return J({error:'سجّل دخولك أولاً'},401);
 if(path==='score'&&post){await ensure(env);TT=0;await env.DB.prepare('INSERT INTO scores2 VALUES(?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name,best=excluded.best,hp=excluded.hp,diff=excluded.diff WHERE excluded.best>scores2.best').bind(me.id,me.name,cl(b.score,0,1e7),cl(b.hp,0,8),cl(b.diff,0,2)).run();return J({ok:1});}
 if(path==='me')return J({user:me});
 if(path==='logout'){await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(tok).run();return J({ok:1});}
 if(path==='history')return J((await env.DB.prepare('SELECT role,text FROM (SELECT id,role,text FROM msgs WHERE uid=? ORDER BY id DESC LIMIT 40) ORDER BY id').bind(me.id).all()).results);
 if(path==='clear'){await env.DB.prepare('DELETE FROM msgs WHERE uid=?').bind(me.id).run();return J({ok:1});}
 if(path==='chat'&&post){
  const t=String(b.text||'').trim().slice(0,1000);if(!t)return J({error:'رسالة فارغة'},400);
  const h=(await env.DB.prepare('SELECT role,text FROM (SELECT id,role,text FROM msgs WHERE uid=? ORDER BY id DESC LIMIT 10) ORDER BY id').bind(me.id).all()).results;
  let reply;
  try{const r=await env.AI.run('@cf/mistralai/mistral-small-3.1-24b-instruct',{messages:[{role:'system',content:SYS},...h.map(m=>({role:m.role,content:m.text})),{role:'user',content:t}],max_tokens:600});reply=r.response||'ما قدرت أرد، جرب مرة ثانية.';}
  catch(e){reply='⚠️ المساعد غير متاح حالياً، تأكد من ربط Workers AI.';}
  await env.DB.batch([env.DB.prepare('INSERT INTO msgs(uid,role,text) VALUES(?,?,?)').bind(me.id,'user',t),env.DB.prepare('INSERT INTO msgs(uid,role,text) VALUES(?,?,?)').bind(me.id,'assistant',reply)]);
  return J({reply});
 }
 if(path==='password'&&post){
  const u=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(me.id).first();
  if(!(await hv(String(b.old||''),u)))return J({error:'كلمة المرور الحالية غير صحيحة'},400);
  if(String(b.new||'').length<6)return J({error:'كلمة المرور الجديدة قصيرة'},400);
  const s=rnd();await env.DB.prepare('UPDATE users SET hash=?,salt=? WHERE id=?').bind('p'+IT+':'+await hash(b.new,s,IT),s,me.id).run();return J({ok:1});
 }
 if(path==='delete'&&post){
  await ensure(env);TT=0;for(const q of['DELETE FROM scores2 WHERE uid=?','DELETE FROM msgs WHERE uid=?','DELETE FROM sessions WHERE uid=?','DELETE FROM users WHERE id=?'])await env.DB.prepare(q).bind(me.id).run();
  return J({ok:1});
 }
 if(me.admin&&path==='news/add'&&post){
  const t=String(b.text||'').trim().slice(0,500);if(!t)return J({error:'اكتب الخبر'},400);
  await env.DB.prepare('INSERT INTO news(tag,text) VALUES(?,?)').bind(String(b.tag||'خبر').slice(0,30),t).run();return J({ok:1});
 }
 if(me.admin&&path==='news/delete'&&post){await env.DB.prepare('DELETE FROM news WHERE id=?').bind(b.id).run();return J({ok:1});}
 return J({error:'غير موجود'},404);
}
export default{async fetch(request,env){const u=new URL(request.url);if(u.pathname.startsWith('/api/'))return handle(request,env);const r=await env.ASSETS.fetch(request);if(/\.(m4a|mp3|mp4|wav|ogg|aac)$/i.test(u.pathname)&&(r.headers.get('content-type')||'').includes('text/html'))return new Response('not found',{status:404});return r}};
