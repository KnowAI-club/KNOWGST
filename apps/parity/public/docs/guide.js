import {pages} from './content.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aliases={'install':'setup','first-run':'setup','first-invoice':'invoices','customize':'print-settings','thermal':'print-settings','navigation':'index','backups-updates':'backups'};
let selected=new URLSearchParams(location.search).get('topic')||'index';selected=aliases[selected]||selected;
let current=pages.find(p=>p.id===selected)||pages[0];
function navigation(query=''){
 const filtered=pages.filter(p=>`${p.title} ${p.intro} ${p.steps.join(' ')} ${p.notes}`.toLowerCase().includes(query.toLowerCase()));
 let group='';$('nav').innerHTML=filtered.map(p=>{let title='';if(group!==p.group){group=p.group;title=`<h2>${esc(group)}</h2>`;}return `${title}<a href="?topic=${p.id}" ${p.id===current.id?'aria-current="page"':''}>${esc(p.title)}</a>`;}).join('');
 $('#search-status').textContent=query?`${filtered.length} topic${filtered.length===1?'':'s'} found`:'';
}
const index=pages.indexOf(current);
document.title=`${current.title} · KNOWGST guide`;
$('#article').innerHTML=`<div class="breadcrumb">Guide <span>/</span> ${esc(current.group)}</div><section id="overview"><div class="badge">KNOWGST GUIDE</div><h1>${esc(current.title)}</h1><p class="intro">${esc(current.intro)}</p></section>${current.screen?`<section id="screen"><h2>In the app</h2><figure><a href="./screenshots/${current.screen}.png" target="_blank" rel="noopener" aria-label="Open full-size ${esc(current.title)} screenshot"><img src="./screenshots/${current.screen}.png" alt="Current KNOWGST ${esc(current.title.toLowerCase())} screen with fictional sample records" width="1440" height="1000" fetchpriority="high"></a><figcaption>Actual KNOWGST screen · Sample data · 29 Oct 2026. Select the image to view full size.</figcaption></figure>${current.id==='purchases'?`<figure><a href="./screenshots/purchase-form.png" target="_blank" rel="noopener"><img src="./screenshots/purchase-form.png" alt="Actual Add Purchase form with sample supplier and item details" width="1440" height="1000" loading="lazy"></a><figcaption>Add Purchase: enter the details from your supplier’s bill.</figcaption></figure>`:''}</section>`:''}<section id="steps"><h2>Step by step</h2><ol>${current.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>${current.view?`<a class="action" href="/?view=${current.view}">Open ${esc(current.title)} in KNOWGST ↗</a>`:''}</section><section id="notes" class="note"><h2>Before you continue</h2><p>${esc(current.notes)}</p></section><div class="pagination">${index>0?`<a href="?topic=${pages[index-1].id}"><small>Previous</small>← ${esc(pages[index-1].title)}</a>`:'<span></span>'}${index<pages.length-1?`<a href="?topic=${pages[index+1].id}"><small>Next</small>${esc(pages[index+1].title)} →</a>`:''}</div><footer>KNOWGST · GPL-3.0-only · Upstream MIT notices retained.<br><a href="https://github.com/KnowAI-club/KNOWGST">Source, release evidence and issue reporting ↗</a></footer>`;
if(!current.screen) $('.contents a[href="#screen"]').remove();
navigation();$('#search').addEventListener('input',e=>navigation(e.target.value));
$('#menu').onclick=()=>{const open=$('#menu').getAttribute('aria-expanded')!=='true';$('#menu').setAttribute('aria-expanded',String(open));$('#navigation').classList.toggle('expanded',open);};
function setTheme(theme){document.documentElement.dataset.theme=theme;$('#theme').setAttribute('aria-label',`Switch to ${theme==='dark'?'light':'dark'} theme`);}
let saved;try{saved=localStorage.getItem('knowgst-guide-theme');}catch{}setTheme(saved||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('#theme').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(theme);try{localStorage.setItem('knowgst-guide-theme',theme);}catch{}};
