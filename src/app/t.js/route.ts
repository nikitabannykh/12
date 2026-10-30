import { appUrl } from "@/lib/util";

/**
 * Трекер обращений. Ставится на сайт владельца одной строкой вместе с кодом Метрики (Настройки → Подключение сайта).
 * Владельцу ничего настраивать не нужно — трекер сам находит обращения:
 *  - отправка формы, в которой есть поле телефона или почты (поиск, вход и формы с паролем — никогда);
 *  - клик по номеру телефона (tel:);
 *  - переход в мессенджер: WhatsApp, Telegram, Viber, VK-сообщения, MAX;
 *  - переход в онлайн-запись: DIKIDI, YCLIENTS / Altegio, Sonline, EasyWeek, Booksy (ссылки и кнопки виджета ms_booking).
 *    Засчитывается как заявка (kind=form, via=booking).
 * Каждое обращение уходит на /api/t и дублируется целью Метрики (pz_<вид> + pz_lead), если на сайте есть счётчик.
 * - Запоминает первое касание: при заходе по рекламной ссылке получает от сервера подпись utm-меток
 *   и хранит её в localStorage (подделать источник заявки из консоли нельзя).
 * - Персональные данные НЕ собирает: значения полей форм не читаются и никуда не отправляются.
 * - Раз в сутки на браузер (и при открытии сайта со ссылкой ?pz_check=1) шлёт короткий сигнал «код стоит» (kind=ping) —
 *   по нему в настройках видно, что код установлен.
 * - Ручная разметка: data-pz-lead на форме или ссылке — считать обращением; data-pz-ignore — не считать.
 * - window.pzGoal(kind) — только цели Метрики (для нашей формы записи, которая сама шлёт заявку на сервер).
 * - Для офлайн-конверсий запоминает ClientID Метрики (ym(id,'getClientID')) и yclid из ссылки Директа (30 дней)
 *   и передаёт их вместе с обращением: когда владелец отметит «Записался», мы загрузим это в Метрику.
 *   window.pzIds() — те же идентификаторы для нашей формы записи.
 */
export async function GET() {
  const endpoint = `${appUrl()}/api/t`;
  const js = `(function(){
var s=document.currentScript||document.querySelector('script[data-key][src*="/t.js"]');if(!s||window.__pzTracker)return;window.__pzTracker=1;
var key=s.getAttribute('data-key'),ymId=s.getAttribute('data-ym'),E=${JSON.stringify(endpoint)};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
var vid=ls('pz_vid');if(!vid){vid=Math.random().toString(36).slice(2)+Date.now().toString(36);ls('pz_vid',vid)}
function ft(){try{var x=JSON.parse(ls('pz_ft')||'null');if(x&&x.v&&Date.now()-x.t<30*864e5)return x.v}catch(e){}return null}
function post(o){var body=JSON.stringify(o);
try{if(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([body],{type:'text/plain'})))return}catch(e){}
if(window.fetch)fetch(E,{method:'POST',body:body,keepalive:true,headers:{'Content-Type':'text/plain'}})['catch'](function(){})}
var q;try{q=new URLSearchParams(location.search)}catch(e){q=null}
if(q&&q.get('utm_source')&&!ft()&&window.fetch){
fetch(E,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({key:key,kind:'visit',source:q.get('utm_source'),campaign:q.get('utm_campaign'),ad:q.get('utm_content'),host:location.host})})
.then(function(r){return r.json()}).then(function(d){if(d&&d.ft)ls('pz_ft',JSON.stringify({v:d.ft,t:Date.now()}))})['catch'](function(){})}
if(q){var yc=q.get('yclid');if(yc&&/^\\d{1,25}$/.test(yc))ls('pz_yclid',JSON.stringify({v:yc,t:Date.now()}))}
var chk=q&&q.get('pz_check'),seen=+ls('pz_seen')||0;
if(chk||Date.now()-seen>864e5){ls('pz_seen',String(Date.now()));post({key:key,kind:'ping',vid:vid,host:location.host,check:chk?1:0,ym:!!(ymId&&window.ym)})}
function ycl(){try{var x=JSON.parse(ls('pz_yclid')||'null');if(x&&x.v&&Date.now()-x.t<30*864e5)return x.v}catch(e){}return null}
var cid=ls('pz_ymcid');
function askCid(n){if(!ymId)return;if(window.ym){try{window.ym(+ymId,'getClientID',function(c){if(c&&/^\\d{1,25}$/.test(String(c))){cid=String(c);ls('pz_ymcid',cid)}})}catch(e){}}else if(n<20)setTimeout(function(){askCid(n+1)},500)}
askCid(0);
function ids(){return{cid:cid||null,yclid:ycl()}}
function goal(kind){if(ymId&&window.ym){try{window.ym(+ymId,'reachGoal','pz_'+kind);window.ym(+ymId,'reachGoal','pz_lead')}catch(e){}}}
var sent={};
function send(kind,via){var k=kind+(via||'');if(sent[k]&&Date.now()-sent[k]<60000)return;sent[k]=Date.now();goal(kind);
var i=ids();post({key:key,kind:kind,via:via||kind,vid:vid,ft:ft(),cid:i.cid,yclid:i.yclid,host:location.host})}
var MSG=/(^|\\.)(wa\\.me|whatsapp\\.com|t\\.me|telegram\\.me|telegram\\.dog|vk\\.me|viber\\.click|max\\.ru)$/,
BOOK=/(^|\\.)(dikidi\\.(net|ru|app)|yclients\\.com|altegio\\.(com|app)|sonline\\.su|easyweek\\.(io|ru)|booksy\\.com)$/;
function hostOf(h){try{return new URL(h,location.href).hostname.toLowerCase().replace(/^www\\./,'')}catch(e){return ''}}
function field(f,sel){try{return !!f.querySelector(sel)}catch(e){return false}}
var PHONE='input[type=tel],input[autocomplete=tel],input[name*=phone i],input[name*=tel i],input[name*=телефон i],input[placeholder*=телефон i]',
MAIL='input[type=email],input[autocomplete=email],input[name*=email i],input[name*=mail i]';
function isLeadForm(f){if(f.hasAttribute('data-pz-lead'))return true;
if(field(f,'input[type=password]')||f.getAttribute('role')==='search'||field(f,'input[type=search]'))return false;
if(/search|поиск/i.test((f.getAttribute('action')||'')+' '+(f.id||'')+' '+(f.className||'')))return false;
return field(f,PHONE)||field(f,MAIL)}
document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;
var a=t.closest('a[href],.ms_booking,[data-pz-lead]');if(!a||a.closest('[data-pz-ignore]'))return;
var h=a.getAttribute('href')||'',lead=a.getAttribute('data-pz-lead');
if(lead){send(lead==='phone'||lead==='messenger'?lead:'form',lead==='booking'?'booking':undefined);return}
if(/^tel:/i.test(h))send('phone');
else if(/^(viber|whatsapp|tg):/i.test(h))send('messenger');
else if(/\\bms_booking\\b/.test(a.className||''))send('form','booking');
else if(h&&!/^(#|javascript:|mailto:)/i.test(h)){var ho=hostOf(h);if(MSG.test(ho))send('messenger');else if(BOOK.test(ho))send('form','booking')}},true);
document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.hasAttribute||f.hasAttribute('data-pz-ignore')||!isLeadForm(f))return;send('form')},true);
window.pzLead=function(kind){send(kind==='phone'||kind==='messenger'?kind:'form',kind==='booking'?'booking':undefined)};
window.pzGoal=goal;
window.pzFirstTouch=ft;
window.pzIds=ids;
})();`;
  return new Response(js, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
