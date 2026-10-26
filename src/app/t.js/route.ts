import { appUrl } from "@/lib/util";

/**
 * Трекер обращений. Ставится на сайт владельца одной строкой вместе с кодом Метрики.
 * - Запоминает первое касание: при заходе по рекламной ссылке получает от сервера подпись utm-меток
 *   и хранит её в localStorage (подделать источник заявки из консоли нельзя).
 * - Отмечает обращения: клик по телефону, переход в мессенджер, отправку формы записи.
 * - Персональные данные НЕ собирает: значения полей форм не читаются и никуда не отправляются.
 *   Засчитываются только формы с полем телефона или с атрибутом data-pz-lead; формы с паролем — никогда.
 * - window.pzGoal(kind) — только цели Метрики (для нашей формы записи, которая сама шлёт заявку на сервер).
 */
export async function GET() {
  const endpoint = `${appUrl()}/api/t`;
  const js = `(function(){
var s=document.currentScript||document.querySelector('script[data-key][src*="/t.js"]');if(!s)return;
var key=s.getAttribute('data-key'),ym=s.getAttribute('data-ym'),E=${JSON.stringify(endpoint)};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
var vid=ls('pz_vid');if(!vid){vid=Math.random().toString(36).slice(2)+Date.now().toString(36);ls('pz_vid',vid)}
function ft(){try{var x=JSON.parse(ls('pz_ft')||'null');if(x&&x.v&&Date.now()-x.t<30*864e5)return x.v}catch(e){}return null}
var q;try{q=new URLSearchParams(location.search)}catch(e){q=null}
if(q&&q.get('utm_source')&&!ft()&&window.fetch){
fetch(E,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({key:key,kind:'visit',source:q.get('utm_source'),campaign:q.get('utm_campaign'),ad:q.get('utm_content')})})
.then(function(r){return r.json()}).then(function(d){if(d&&d.ft)ls('pz_ft',JSON.stringify({v:d.ft,t:Date.now()}))})['catch'](function(){})}
function goal(kind){if(ym&&window.ym){try{ym(+ym,'reachGoal','pz_'+kind);ym(+ym,'reachGoal','pz_lead')}catch(e){}}}
var sent={};
function send(kind){if(sent[kind]&&Date.now()-sent[kind]<60000)return;sent[kind]=Date.now();goal(kind);
var body=JSON.stringify({key:key,kind:kind,vid:vid,ft:ft()});
try{if(navigator.sendBeacon&&navigator.sendBeacon(E,new Blob([body],{type:'text/plain'})))return}catch(e){}
if(window.fetch)fetch(E,{method:'POST',body:body,keepalive:true,headers:{'Content-Type':'text/plain'}})['catch'](function(){})}
function isLeadForm(f){if(f.hasAttribute('data-pz-lead'))return true;try{if(f.querySelector('input[type=password]'))return false;
return !!f.querySelector('input[type=tel],input[autocomplete=tel],input[name*=phone i],input[name*=tel i],input[name*=телефон i]')}catch(e){return false}}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';
if(/^tel:/i.test(h))send('phone');else if(/wa\\.me|whatsapp|t\\.me\\/|telegram|vk\\.me|max\\.ru/i.test(h))send('messenger')},true);
document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.hasAttribute||f.hasAttribute('data-pz-ignore')||!isLeadForm(f))return;send('form')},true);
window.pzLead=function(kind){send(kind==='phone'||kind==='messenger'?kind:'form')};
window.pzGoal=goal;
window.pzFirstTouch=ft;
})();`;
  return new Response(js, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
