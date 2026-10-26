import { appUrl } from "@/lib/util";

/**
 * Трекер обращений. Ставится на сайт владельца одной строкой вместе с кодом Метрики.
 * Запоминает, из какого объявления пришёл человек (utm-метки), и отмечает обращения:
 * отправку формы, клик по телефону, переход в мессенджер. Шлёт цели в Метрику (если есть) и нам.
 */
export async function GET() {
  const endpoint = `${appUrl()}/api/t`;
  const js = `(function(){
var s=document.currentScript||document.querySelector('script[data-key]');if(!s)return;
var key=s.getAttribute('data-key'),ym=s.getAttribute('data-ym'),E=${JSON.stringify(endpoint)};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
var vid=ls('pz_vid');if(!vid){vid=Math.random().toString(36).slice(2)+Date.now().toString(36);ls('pz_vid',vid)}
var q=new URLSearchParams(location.search);
if(q.get('utm_source')){ls('pz_src',JSON.stringify({s:q.get('utm_source'),c:q.get('utm_campaign'),a:q.get('utm_content'),t:Date.now()}))}
function src(){try{var x=JSON.parse(ls('pz_src')||'null');if(x&&Date.now()-x.t<30*864e5)return x}catch(e){}return null}
var sent={};
function send(kind,extra){var k=kind+(extra&&extra.contact||'');if(sent[k]&&Date.now()-sent[k]<60000)return;sent[k]=Date.now();
var x=src()||{};var body=JSON.stringify({key:key,kind:kind,vid:vid,source:x.s||null,campaign:x.c||null,ad:x.a||null,page:location.href,name:extra&&extra.name,contact:extra&&extra.contact});
if(ym&&window.ym){try{ym(+ym,'reachGoal','pz_'+kind);ym(+ym,'reachGoal','pz_lead')}catch(e){}}
if(navigator.sendBeacon){navigator.sendBeacon(E,new Blob([body],{type:'text/plain'}))}else{fetch(E,{method:'POST',body:body,keepalive:true,headers:{'Content-Type':'text/plain'}})}}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';
if(/^tel:/i.test(h))send('phone');else if(/wa\\.me|whatsapp|t\\.me\\/|telegram|vk\\.me|max\\.ru/i.test(h))send('messenger')},true);
document.addEventListener('submit',function(e){var f=e.target;if(!f||f.hasAttribute('data-pz-ignore'))return;var d={};try{var fd=new FormData(f);fd.forEach(function(v,k){if(/name|имя/i.test(k))d.name=String(v).slice(0,80);if(/phone|tel|телефон|contact/i.test(k))d.contact=String(v).slice(0,80)})}catch(_){}
send('form',d)},true);
window.pzLead=function(kind,extra){send(kind||'form',extra||{})};
})();`;
  return new Response(js, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
