const API="https://api.opendota.com/api";
const CDN="https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react";
const $=id=>document.getElementById(id);
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const fmt=n=>(n||0).toLocaleString("ru-RU");
const time=s=>`${Math.floor((s||0)/60)}:${String(Math.floor((s||0)%60)).padStart(2,"0")}`;
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
let HEROES={},ITEMS={};

const CONST_KEY="wr_constants_v1", CONST_TTL=3*24*3600*1000, MATCH_KEY="wr_matches_v1", MATCH_CACHE_SIZE=8;
const store={
 get(k){try{return JSON.parse(localStorage.getItem(k)||"null")}catch(e){return null}},
 set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}
};
async function getJSON(url){
 const r=await fetch(url);
 if(r.status===429)throw Error("OpenDota временно ограничил запросы (лимит 60/мин). Подожди минуту и попробуй снова");
 if(r.status===404)throw Error("Матч не найден");
 if(!r.ok)throw Error(`OpenDota ответил ${r.status}`);
 return r.json();
}
async function fetchConstants(){
 const [h,it]=await Promise.all([getJSON(`${API}/constants/heroes`),getJSON(`${API}/constants/items`)]);
 const heroes={},items={};
 for(const x of Object.values(h))heroes[x.id]={localized_name:x.localized_name,img:x.img};
 for(const x of Object.values(it))if(x&&x.id!=null)items[x.id]={dname:x.dname,img:x.img};
 store.set(CONST_KEY,{ts:Date.now(),heroes,items});
 return {heroes,items};
}
let constantsReady=null;
function loadConstants(){
 if(constantsReady)return constantsReady;
 const cached=store.get(CONST_KEY);
 if(cached&&cached.heroes&&Object.keys(cached.heroes).length){
   HEROES=cached.heroes; ITEMS=cached.items||{};
   if(Date.now()-cached.ts>CONST_TTL)fetchConstants().then(c=>{HEROES=c.heroes;ITEMS=c.items}).catch(()=>{});
   return constantsReady=Promise.resolve();
 }
 return constantsReady=fetchConstants().then(c=>{HEROES=c.heroes;ITEMS=c.items}).catch(()=>{constantsReady=null});
}
const TF_FIELDS=["deaths","damage","healing","gold_delta","killed","buybacks"];
const PLAYER_FIELDS=["player_slot","account_id","personaname","hero_id","kills","deaths","assists","last_hits","denies","gold_per_min","xp_per_min","net_worth","hero_damage","tower_damage","hero_healing","obs_placed","sentry_placed","lane_role","rank_tier","buyback_log","kills_log","gold_t","xp_t","item_0","item_1","item_2","item_3","item_4","item_5","backpack_0","backpack_1","backpack_2","item_neutral"];
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
function trimMatch(m){
 return {...pick(m,["match_id","duration","radiant_win","radiant_score","dire_score","version","radiant_gold_adv","objectives"]),
  players:(m.players||[]).map(p=>pick(p,PLAYER_FIELDS)),
  teamfights:m.teamfights?m.teamfights.map(f=>({start:f.start,end:f.end,players:(f.players||[]).map(x=>pick(x,TF_FIELDS))})):m.teamfights};
}
function cachedMatch(id){const c=store.get(MATCH_KEY)||[];return (c.find(x=>String(x.match_id)===String(id))||null);}
function cacheMatch(m){
 if(!m.version)return;
 let c=(store.get(MATCH_KEY)||[]).filter(x=>x.match_id!==m.match_id);
 c.unshift(m); c=c.slice(0,MATCH_CACHE_SIZE);
 while(c.length&&!store.set(MATCH_KEY,c))c.pop();
}
async function loadMatch(id){
 const hit=cachedMatch(id); if(hit)return hit;
 const m=trimMatch(await getJSON(`${API}/matches/${id}`)); cacheMatch(m); return m;
}
loadConstants();

function parseMatchId(v){const x=String(v||"").match(/\d{6,}/);return x?x[0]:null;}
let currentRun=0, LAST=null;
function focusFromUrl(){const t=(new URLSearchParams(location.search).get("team")||"").toLowerCase();return t==="radiant"?"Radiant":t==="dire"?"Dire":null;}
function setUrl(id,team){const url=new URL(location.href); url.searchParams.set("match",id); if(team)url.searchParams.set("team",team.toLowerCase()); else url.searchParams.delete("team"); history.replaceState(null,"",url);}
async function run(id,scroll=false,focus=null){
 const runId=++currentRun;
 $("status").textContent="Загружаем матч…"; $("result").classList.add("hidden"); $("parseBox").classList.add("hidden");
 const btn=$("submitBtn"); btn.disabled=true; btn.classList.add("loading");
 try{
  const [m]=await Promise.all([loadMatch(id),loadConstants()]);
  if(runId!==currentRun)return;
  analyze(m,focus); startSideVideo(); $("status").textContent=`Матч ${id} обработан`;
  if(scroll)$("scoreboard").scrollIntoView({behavior:"smooth",block:"start"});
  setUrl(id,focus);
  if(!m.version)showParseOffer(id);
 }catch(err){if(runId===currentRun)$("status").textContent="Ошибка: "+err.message}
 finally{if(runId===currentRun){btn.disabled=false;btn.classList.remove("loading")}}
}
function setFocus(team){
 if(!LAST)return;
 const y=scrollY; analyze(LAST,team); scrollTo(0,y);
 setUrl(LAST.match_id,team);
}
// Видео справа: без контролов, после старта его нельзя поставить на паузу или заглушить.
// Если браузер не дал запустить со звуком (нет взаимодействия со страницей), играет без звука и включает звук при первом клике/нажатии.
const sideVideo=$("sideVideo");
let sideVideoOn=false, sideSoundOk=false;
function startSideVideo(){
 if(sideVideoOn)return;
 sideVideoOn=true; sideVideo.classList.remove("hidden");
 sideVideo.muted=false; sideVideo.volume=1;
 sideVideo.play().then(()=>{sideSoundOk=true}).catch(()=>{sideVideo.muted=true; sideVideo.play().catch(()=>{})});
}
function unlockSideSound(){
 if(!sideVideoOn||sideSoundOk)return;
 sideSoundOk=true; sideVideo.muted=false; sideVideo.volume=1; sideVideo.play().catch(()=>{});
}
["pointerdown","keydown","touchstart"].forEach(t=>addEventListener(t,unlockSideSound,{capture:true}));
sideVideo.addEventListener("pause",()=>{if(sideVideoOn)sideVideo.play().catch(()=>{})});
sideVideo.addEventListener("volumechange",()=>{
 if(!sideVideoOn)return;
 if(sideVideo.volume<1)sideVideo.volume=1;
 if(sideVideo.muted&&sideSoundOk)sideVideo.muted=false;
});
sideVideo.addEventListener("contextmenu",e=>e.preventDefault());
if("mediaSession" in navigator)for(const a of ["pause","stop"])try{navigator.mediaSession.setActionHandler(a,()=>{})}catch(e){}

$("form").addEventListener("submit",e=>{
 e.preventDefault(); const id=parseMatchId($("matchId").value);
 if(!id){$("status").textContent="Введи числовой Match ID или ссылку на матч (OpenDota / Dotabuff / STRATZ)";return;}
 $("matchId").value=id; run(id,true);
});
{const id=parseMatchId(new URLSearchParams(location.search).get("match")); if(id){$("matchId").value=id; run(id,false,focusFromUrl());}}

function showParseOffer(id){
 const box=$("parseBox"); box.classList.remove("hidden");
 box.innerHTML=`<div><b>Матч ещё не разобран OpenDota</b><span>Без разбора нет драк, линий и событий — анализ получается грубым. Разбор обычно занимает 1–5 минут.</span></div><button type="button" id="requestParse">ЗАПРОСИТЬ РАЗБОР</button>`;
 $("requestParse").onclick=()=>requestParse(id);
}
async function requestParse(id){
 const btn=$("requestParse"); btn.disabled=true; btn.textContent="ОТПРАВЛЯЕМ…";
 try{
  const r=await fetch(`${API}/request/${id}`,{method:"POST"});
  if(!r.ok)throw Error(r.status===429?"слишком много запросов, попробуй через минуту":`OpenDota ответил ${r.status}`);
  const job=(await r.json())?.job?.jobId;
  const started=Date.now();
  const tick=async()=>{
    if(Date.now()-started>8*60*1000){btn.disabled=false;btn.textContent="ПРОВЕРИТЬ ЕЩЁ РАЗ";btn.onclick=()=>run(id);return;}
    btn.textContent=`РАЗБИРАЕТСЯ… ${time((Date.now()-started)/1000)}`;
    try{
      const s=job?await getJSON(`${API}/request/${job}`):null;
      if(s===null||!job){const m=trimMatch(await getJSON(`${API}/matches/${id}`)); if(m.version){cacheMatch(m);return run(id);}}
    }catch(e){}
    setTimeout(tick,10000);
  };
  setTimeout(tick,5000);
 }catch(err){btn.disabled=false;btn.textContent="ЗАПРОСИТЬ РАЗБОР";$("status").textContent="Не удалось запросить разбор: "+err.message}
}

function playerName(p){return p?.personaname||`Игрок ${(p?.idx??0)+1}`;}
function fightOf(f,p){return f&&f.players?f.players[p.idx]:undefined;}
function fightKills(x){return Object.values(x?.killed||{}).reduce((a,n)=>a+n,0);}
function heroData(p){return HEROES[String(p.hero_id)]||HEROES[p.hero_id]||{};}
function heroName(p){return heroData(p).localized_name||`Hero #${p.hero_id}`;}
function heroImg(p){const h=heroData(p); if(h.img)return `https://cdn.cloudflare.steamstatic.com${h.img}`; return `${CDN}/heroes/${String(h.localized_name||'').toLowerCase().replace(/[^a-z0-9]/g,'')}.png`;}
function itemData(id){return ITEMS[String(id)]||ITEMS[id]||{};}
function itemImg(id){const it=itemData(id); if(it.img)return `https://cdn.cloudflare.steamstatic.com${it.img}`; return "";}
function itemName(id){return itemData(id).dname||itemData(id).localized_name||"Item";}
function rankName(t){const n=Number(t||0),m=Math.floor(n/10),stars=n%10; const name=({1:"Herald",2:"Guardian",3:"Crusader",4:"Archon",5:"Legend",6:"Ancient",7:"Divine",8:"Immortal"})[m]||"Unranked"; return stars?`${name} ${stars}`:name;}
function rankImg(t){const m=Math.floor(Number(t||0)/10);return m?`https://www.opendota.com/assets/images/dota2/rank_icons/rank_icon_${m}.png`:"";}
function itemsOf(p){return [0,1,2,3,4,5].map(k=>p[`item_${k}`]).concat([0,1,2].map(k=>p[`backpack_${k}`])).concat([p.item_neutral]).filter(Boolean);}

function inferRoles(team,duration){
  const value=x=>(x.net_worth||0)*.55+(x.gold_per_min||0)*.25+(x.last_hits||0)*.12+(x.xp_per_min||0)*.08;
  const lane=x=>Number(x.lane_role||0);
  const assigned=new Map();

  const mid=team.filter(x=>lane(x)===2).sort((a,b)=>value(b)-value(a));
  if(mid.length) assigned.set(mid[0].player_slot,{position:2,role:'Pos 2 · Mid',confidence:99,source:'OpenDota lane_role'});

  const safe=team.filter(x=>lane(x)===1).sort((a,b)=>value(b)-value(a));
  if(safe.length>=2){
    assigned.set(safe[0].player_slot,{position:1,role:'Pos 1 · Carry',confidence:96,source:'OpenDota safe lane + resource split'});
    assigned.set(safe[1].player_slot,{position:5,role:'Pos 5 · Hard Support',confidence:96,source:'OpenDota safe lane + resource split'});
  }else if(safe.length===1){
    const p=safe[0], rank=team.filter(x=>lane(x)!==2).sort((a,b)=>value(b)-value(a));
    const isCore=value(p)>=value(rank[Math.min(2,rank.length-1)]||p);
    assigned.set(p.player_slot,{position:isCore?1:5,role:isCore?'Pos 1 · Carry':'Pos 5 · Hard Support',confidence:78,source:'OpenDota safe lane + fallback'});
  }

  const off=team.filter(x=>lane(x)===3).sort((a,b)=>value(b)-value(a));
  if(off.length>=2){
    assigned.set(off[0].player_slot,{position:3,role:'Pos 3 · Offlane',confidence:96,source:'OpenDota offlane + resource split'});
    assigned.set(off[1].player_slot,{position:4,role:'Pos 4 · Soft Support',confidence:96,source:'OpenDota offlane + resource split'});
  }else if(off.length===1){
    const p=off[0];
    const nonMid=team.filter(x=>lane(x)!==2).sort((a,b)=>value(b)-value(a));
    const isCore=value(p)>=value(nonMid[Math.min(1,nonMid.length-1)]||p);
    assigned.set(p.player_slot,{position:isCore?3:4,role:isCore?'Pos 3 · Offlane':'Pos 4 · Soft Support',confidence:78,source:'OpenDota offlane + fallback'});
  }

  const positions=[1,2,3,4,5];
  const used=new Set([...assigned.values()].map(x=>x.position));
  const missing=positions.filter(x=>!used.has(x));
  const remaining=team.filter(p=>!assigned.has(p.player_slot)).sort((a,b)=>value(b)-value(a));
  for(const pos of missing){
    const p=remaining.shift(); if(!p)break;
    const data={
      1:['Pos 1 · Carry',62],2:['Pos 2 · Mid',70],3:['Pos 3 · Offlane',62],4:['Pos 4 · Soft Support',58],5:['Pos 5 · Hard Support',58]
    }[pos];
    assigned.set(p.player_slot,{position:pos,role:data[0],confidence:data[1],source:'fallback from match stats'});
  }

  return Object.fromEntries(team.map(p=>[p.player_slot,assigned.get(p.player_slot)||{position:5,role:'Pos 5 · Hard Support',confidence:40,source:'fallback'}]));
}

function inferRole(p,team,duration){
  return inferRoles(team,duration)[p.player_slot] || {position:5,role:'Pos 5 · Hard Support',confidence:40,source:'fallback'};
}
function withRoles(all,duration){
  const roles={...inferRoles(all.filter(p=>p.team==='Radiant'),duration),...inferRoles(all.filter(p=>p.team==='Dire'),duration)};
  return all.map(p=>({...p,roleInfo:roles[p.player_slot]}));
}
function roleWeights(role){
 const pos=Number(String(role||'').match(/Pos (\d)/)?.[1]||0);
 return ({
  1:{farm:.26,fight:.23,error:.30,obj:.14,utility:.07},
  2:{farm:.16,fight:.30,error:.29,obj:.18,utility:.07},
  3:{farm:.11,fight:.30,error:.25,obj:.23,utility:.11},
  4:{farm:.06,fight:.30,error:.23,obj:.20,utility:.21},
  5:{farm:.04,fight:.27,error:.20,obj:.17,utility:.32}
 })[pos]||{farm:.15,fight:.27,error:.27,obj:.20,utility:.11};
}

function analyze(m,focus=null){
 if(!m||!Array.isArray(m.players)||!m.players.length)throw Error("В ответе OpenDota нет данных игроков");
 LAST=m;
 const duration=m.duration||1;
 const players=withRoles(m.players.map((p,i)=>({...p,idx:i,team:p.player_slot<128?"Radiant":"Dire"})),duration);
 const losing=m.radiant_win?"Dire":"Radiant";
 const focusTeam=focus||losing;
 const team=players.filter(p=>p.team===focusTeam), win=players.filter(p=>p.team!==focusTeam);
 const teamKills=team.reduce((a,p)=>a+(p.kills||0),0), teamDamage=team.reduce((a,p)=>a+(p.hero_damage||0),0)||1;
 const scored=team.map(p=>scorePlayer(p,{team,win,m,teamKills,teamDamage,duration})).sort((a,b)=>b.score-a.score);
 const culprit=scored[0];
 const closeRuiner=scored[1]||null;
 const gap=closeRuiner?culprit.score-closeRuiner.score:99;
 const dataFull=!!(m.teamfights&&m.teamfights.length)&&goldAdvSeries(m,players).length>1;
 culprit.clarity={gap,dataFull,level:gap>=12?"явный":gap>=6?"заметный":"спорный"};
 render(m,players,scored,culprit,closeRuiner,focusTeam);
 if(culprit?.account_id&&!culprit.rank_tier){
   getJSON(`${API}/players/${culprit.account_id}`).then(pp=>{
     if(!pp?.rank_tier)return;
     $("culpritRank").src=rankImg(pp.rank_tier); $("culpritRankText").textContent=rankName(pp.rank_tier);
   }).catch(()=>{});
 }
}

function scorePlayer(p,c){
 const deaths=p.deaths||0,kills=p.kills||0,assists=p.assists||0;
 const kp=c.teamKills?100*(kills+assists)/c.teamKills:0, dmgShare=100*(p.hero_damage||0)/c.teamDamage;
 const farm=p.gold_per_min||0, duration=c.duration||1, role=p.roleInfo?.role||'Unknown', w=roleWeights(role);
 let lowFightEvents=0;
 for(const f of (c.m.teamfights||[])){const x=fightOf(f,p); if(x&&x.deaths>0&&(x.damage||0)<500)lowFightEvents++;}
 const expectedGpm={"Pos 1 · Carry":520,"Pos 2 · Mid":480,"Pos 3 · Offlane":420,"Pos 4 · Soft Support":330,"Pos 5 · Hard Support":270}[role]||400;
 const expectedDamage={"Pos 1 · Carry":.23,"Pos 2 · Mid":.22,"Pos 3 · Offlane":.18,"Pos 4 · Soft Support":.11,"Pos 5 · Hard Support":.09}[role]||.17;
 const expectedKP={"Pos 1 · Carry":58,"Pos 2 · Mid":62,"Pos 3 · Offlane":62,"Pos 4 · Soft Support":66,"Pos 5 · Hard Support":68}[role]||60;
 const farmGap=clamp((expectedGpm-farm)/8,0,18);
 const damageGap=clamp((expectedDamage*100-dmgShare)*.65,0,15);
 const kpGap=clamp((expectedKP-kp)*.20,0,12);
 const fightPenalty=damageGap+kpGap+Math.min(6,lowFightEvents*1.5);
 const lateFactor=duration>45*60?1.8:duration>35*60?1.45:duration>25*60?1.15:.85;
 let errorPenalty=Math.min(24,deaths*1.9*lateFactor);
 if(duration>35*60 && deaths>=2 && !(p.buyback_log||[]).length) errorPenalty+=3;
 const objectiveTarget={"Pos 1 · Carry":1100,"Pos 2 · Mid":900,"Pos 3 · Offlane":1200,"Pos 4 · Soft Support":700,"Pos 5 · Hard Support":500}[role]||900;
 const objectivePenalty=clamp((objectiveTarget-(p.tower_damage||0))/110,0,11);
 const utility=((p.hero_healing||0)/500)+(p.obs_placed||0)*1.5+(p.sentry_placed||0)*.8;
 const utilityCredit=clamp(utility,0,10);
 const resourceWaste=(farm>expectedGpm+80 && (dmgShare<expectedDamage*100*.72) && (p.tower_damage||0)<objectiveTarget*.7)?7:0;
 const raw=100*(w.farm*(farmGap/18)+w.fight*(fightPenalty/33)+w.error*(errorPenalty/27)+w.obj*(objectivePenalty/11)+w.utility*Math.max(0,(6-utilityCredit)/6));
 const score=clamp(raw+resourceWaste,0,100);
 const avgDeaths=c.team.reduce((a,x)=>a+(x.deaths||0),0)/Math.max(1,c.team.length);
 const isCore=(p.roleInfo?.position||5)<=3;
 const tdSum=list=>list.reduce((a,x)=>a+(x.tower_damage||0),0);
 const teamHadWindows=tdSum(c.team)>=tdSum(c.win)*.4;
 const parts=[
  ['farm',(expectedGpm-farm)/expectedGpm>=.12?(expectedGpm-farm)/expectedGpm:0],
  ['fight',(expectedDamage*100-dmgShare)/(expectedDamage*100)>=.3?(expectedDamage*100-dmgShare)/(expectedDamage*100):0],
  ['kp',(expectedKP-kp)/expectedKP>=.2?(expectedKP-kp)/expectedKP:0],
  ['deaths',deaths>=6&&deaths>=avgDeaths*1.15?(deaths-avgDeaths)/Math.max(1,avgDeaths)+.15:0],
  ['waste',resourceWaste?.3:0],
  ['objects',isCore&&teamHadWindows&&(p.tower_damage||0)<objectiveTarget*.4?.6*(objectiveTarget-(p.tower_damage||0))/objectiveTarget:0]
 ].filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
 const mainKind=parts[0]?.[0]||null;
 const metrics={gpm:farm,expGpm:expectedGpm,dmg:dmgShare,expDmg:expectedDamage*100,kp,expKp:expectedKP,deaths,td:p.tower_damage||0,expTd:objectiveTarget};
 const reasons=[];
 if(farmGap>5) reasons.push([`Фарм ниже ожидания для ${role}`,`GPM ${farm}; ориентир модели ≈ ${expectedGpm}.`]);
 if(damageGap>5) reasons.push([`Низкий Fight Impact для ${role}`,`${fmt(p.hero_damage)} hero damage — ${dmgShare.toFixed(1)}% командного урона.`]);
 if(kpGap>5) reasons.push([`Низкое участие в убийствах`,`Kill Participation ${kp.toFixed(0)}%; ориентир модели ≈ ${expectedKP}%.`]);
 if(errorPenalty>7) reasons.push([`Цена смертей слишком высока`,`${deaths} смертей с повышенным весом поздней игры.`]);
 if(resourceWaste) reasons.push([`Ресурсы не конвертированы в результат`,`Высокий GPM сочетался с низким уроном и слабым давлением на строения.`]);
 if(objectivePenalty>5) reasons.push([`Слабое давление на объекты`,`${fmt(p.tower_damage)} урона по строениям для ${role}.`]);
 if(utilityCredit>4) reasons.push([`Положительный вклад поддержки`,`Вклад в вижен/лечение снижает итоговый blame.`]);
 if(!reasons.length) reasons.push([`Нет одного доминирующего провала`,`Score собран из нескольких сигналов с учётом предполагаемой роли.`]);
 return {...p,score:Math.round(score),reasons,kp,dmgShare,role,mainKind,metrics,roleConfidence:p.roleInfo?.confidence||0};
}

const teamCls=t=>t==='Radiant'?'radiant':'dire';
function teamChip(team,result){return `<span class="teamChip ${teamCls(team)}"><i></i>${team}${result?` · ${result}`:''}</span>`;}
function posTag(p){const n=p.roleInfo?.position;return n?`<span class="posTag" title="${esc(p.roleInfo.role)}">P${n}</span>`:'';}
function roleText(p){return (p.roleInfo?.role||'').replace(/^Pos \d · /,'');}
const byPos=list=>list.slice().sort((a,b)=>(a.roleInfo?.position||9)-(b.roleInfo?.position||9));

function scoreboard(m,all,winTeam,focusTeam){
 const side=team=>{
   const won=team===winTeam, list=byPos(all.filter(p=>p.team===team)), focused=team===focusTeam;
   const nw=list.reduce((a,p)=>a+(p.net_worth||0),0);
   return `<div class="sbSide ${teamCls(team)} ${won?'won':'lost'} ${focused?'focused':''}" data-team="${team}" role="button" tabindex="0" title="${focused?'Эта команда сейчас разбирается':`Разобрать ${team}`}">
     <div class="sbTeamRow"><span class="sbTeam">${team}</span><span class="sbResult">${won?'Победа':'Поражение'}</span></div>
     <div class="sbHeroes">${list.map(p=>`<figure title="${esc(playerName(p))} — ${esc(heroName(p))} (${esc(p.roleInfo?.role||'')})"><img decoding="async" src="${heroImg(p)}" alt="${esc(heroName(p))}" onerror="this.style.visibility='hidden'"><figcaption>P${p.roleInfo?.position||'?'}</figcaption></figure>`).join('')}</div>
     <div class="sbNw">${fmt(nw)} net worth</div>
     ${focused?'<div class="sbFocus">РАЗБИРАЕМ ЭТУ КОМАНДУ</div>':'<div class="sbPick">Нажми, чтобы разобрать</div>'}
   </div>`;
 };
 const rosh=(m.objectives||[]).filter(o=>o.type==='CHAT_MESSAGE_ROSHAN_KILL').length;
 return `${side('Radiant')}
  <div class="sbCenter">
   <div class="sbScore"><b class="radiant">${fmt(m.radiant_score)}</b><span>:</span><b class="dire">${fmt(m.dire_score)}</b></div>
   <div class="sbMeta">${time(m.duration)} · матч ${esc(m.match_id||'')}</div>
   <div class="sbStats"><span>Драк <b>${(m.teamfights||[]).length||'—'}</b></span><span>Рошанов <b>${m.objectives?rosh:'—'}</b></span></div>
   <button id="shareResult" type="button" class="shareBtn">КОПИРОВАТЬ ИТОГ</button>
  </div>
  ${side('Dire')}`;
}

function clarityHtml(c){
 const gapText=c.gap>=99?'в команде нет второго игрока для сравнения':`отрыв от следующего игрока — ${c.gap} ${plural(c.gap,'балл','балла','баллов')}`;
 return `<details class="clarity"><summary>Вывод <b class="cl-${c.level==='явный'?'clear':c.level==='заметный'?'mid':'weak'}">${c.level}</b> · данные ${c.dataFull?'полные':'неполные'} <span class="clarityQ">?</span></summary><p>Это не вероятность и не «процент правоты». Здесь две простые вещи:</p><ul><li><b>Насколько выделяется игрок.</b> Сейчас ${gapText}. От 12 баллов — вывод явный, 6–11 — заметный, меньше 6 — спорный: двое сыграли примерно одинаково.</li><li><b>Полнота данных.</b> ${c.dataFull?'OpenDota разобрал реплей: есть драки, поминутное золото и линии.':'Реплей не разобран: нет данных о драках и линиях, оценка грубее. Нажми «Запросить разбор» вверху.'}</li></ul></details>`;
}
function plural(n,one,few,many){const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many;}
function teamSwitch(m,focusTeam,winTeam){
 return `<span class="tsLabel">Кого разбираем:</span>${['Radiant','Dire'].map(t=>`<button type="button" class="tsBtn ${teamCls(t)} ${t===focusTeam?'active':''}" data-team="${t}"><i></i>${t}<small>${t===winTeam?'победа':'поражение'}</small></button>`).join('')}`;
}
function render(m,all,players,culprit,closeRuiner,focusTeam){
 const winTeam=m.radiant_win?"Radiant":"Dire", loseTeam=winTeam==='Radiant'?'Dire':'Radiant';
 const focusWon=focusTeam===winTeam, otherTeam=focusTeam==='Radiant'?'Dire':'Radiant';
 const winners=byPos(all.filter(p=>p.team===winTeam)), others=byPos(all.filter(p=>p.team===otherTeam));
 const badge=focusWon?'СЛАБОЕ ЗВЕНО':'РУИНЕР';
 $("result").classList.remove("hidden");
 $("scoreboard").innerHTML=scoreboard(m,all,winTeam,focusTeam);
 $("teamSwitch").innerHTML=teamSwitch(m,focusTeam,winTeam);
 document.querySelectorAll("#teamSwitch .tsBtn,#scoreboard .sbSide").forEach(el=>{
   const go=()=>{if(el.dataset.team!==focusTeam)setFocus(el.dataset.team)};
   el.addEventListener("click",go); el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}});
 });
 $("plain").innerHTML=plainSummary(m,all,players,culprit,focusTeam,winTeam);
 $("ruinerLabel").textContent=badge;
 $("whyRuinerBtn").textContent=focusWon?'ПОЧЕМУ ОН?':'ПОЧЕМУ ИМЕННО ОН?';
 $("impactTitle").textContent=focusWon?'Насколько слабо сыграл':'Влияние на поражение';
 $("culpritHero").src=heroImg(culprit); $("culpritRank").src=rankImg(culprit.rank_tier); $("culpritRankText").textContent=rankName(culprit.rank_tier);
 $("culpritName").textContent=playerName(culprit);
 $("culpritMeta").innerHTML=`${teamChip(culprit.team)}<span>${esc(heroName(culprit))}</span><span>${esc(culprit.roleInfo?.role||'')}</span>`;
 $("culpritScore").textContent=impactLabel(culprit.score); $("culpritScore").className=`impactValue ${impactClass(culprit.score)}`; $("confidence").innerHTML=clarityHtml(culprit.clarity);
 $("summary").innerHTML=verdictText(m,culprit,closeRuiner,focusWon);
 $("whyRuinerContent").innerHTML=culprit.reasons.map(r=>`<div class="reason"><strong>${esc(r[0].replace(/ для (Pos [1-5].*)$/,"").replace(/Pos [1-5] · (Carry|Mid|Offlane|Soft Support|Hard Support)/g,"роль"))}</strong><span>${esc(r[1].replace(/для Pos [1-5] · (Carry|Mid|Offlane|Soft Support|Hard Support)/g,"с учётом роли"))}</span></div>`).join("") || '<div class="empty">Недостаточно отдельных сигналов, чтобы объяснить оценку подробнее.</div>';
 $("nearRuiner").innerHTML=closeRuiner?nearRuinerHtml(closeRuiner,focusWon):'<div class="nearEmpty">Второй игрок не набрал достаточно сигналов для отдельного сравнения.</div>';
 const losers=all.filter(p=>p.team===loseTeam);
 const mvp=winners.slice().sort((a,b)=>awardScore(b)-awardScore(a))[0];
 const bestLoser=losers.slice().sort((a,b)=>awardScore(b)-awardScore(a))[0];
 const anti=culprit;
 $("awards").innerHTML=[awardCard('MVP МАТЧА',mvp,'good','Лучший вклад в победившей команде'),awardCard('ЛУЧШИЙ В ПОРАЖЕНИИ',bestLoser,'neutral','Сильнейший профиль среди проигравших'),awardCard(focusWon?'СЛАБОЕ ЗВЕНО ПОБЕДИТЕЛЕЙ':'РУИНЕР',anti,'bad',focusWon?'Слабее всех в победившей команде':'Сильнее всех повлиял на поражение')].join('');
 $("goldGraph").innerHTML=goldAdvantageGraph(m,all);
 $("roleCompare").innerHTML=roleComparison(all,winTeam);
 $("shareResult").onclick=()=>{const link=`${location.origin}${location.pathname}?match=${m.match_id||$('matchId').value}`;const text=`WHO RUINED? | Match ${m.match_id||$('matchId').value}\nПобедитель: ${winTeam} (${fmt(m.radiant_score)}:${fmt(m.dire_score)})\nMVP: ${playerName(mvp)} (${heroName(mvp||{})})\nЛучший в поражении: ${playerName(bestLoser)} (${heroName(bestLoser||{})})\n${focusWon?'Слабое звено':'Руинер'} (${focusTeam}): ${playerName(anti)} (${heroName(anti||{})}) — ${anti?.score??'—'}\nРазбор: ${link}${focusTeam===loseTeam?'':`&team=${focusTeam.toLowerCase()}`}`; if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>{$('shareResult').textContent='СКОПИРОВАНО'}).catch(()=>window.prompt('Скопируй результат',text));else window.prompt('Скопируй результат',text);};

 $("loserPanel").className=`panel wide teamPanel ${teamCls(focusTeam)}`; $("winnerPanel").className=`panel wide teamPanel ${teamCls(otherTeam)}`;
 $("loserTeamName").innerHTML=teamChip(focusTeam,focusWon?'победа':'поражение');
 $("winnerTeamName").innerHTML=teamChip(otherTeam,focusWon?'поражение':'победа');
 $("focusHint").textContent=focusWon?'Число справа — score слабых мест: чем выше, тем больше у игрока было проблем, даже несмотря на победу.':'Число справа — негативный score: чем выше, тем сильнее игрок повлиял на поражение.';
 $("eventsTitle").textContent=`Ключевые эпизоды · ${playerName(culprit)}`;
 $("winnerTeam").innerHTML=others.map(p=>winnerPlayerCard(p)).join("");
 $("players").innerHTML=players.map((p)=>playerCard(p,p===culprit,badge)).join("");
 $("matchStory").innerHTML=matchStory(m,all,players,culprit,focusTeam);
 const events=buildEvents(m,culprit); $("events").innerHTML=events.length?events.map(e=>`<div class="event ${e.danger?'danger':e.neutral?'neutral':'positive'}"><div class="eventTop"><span class="eventTime">${e.t}</span><span class="eventTag ${e.danger?'bad':e.neutral?'neutral':''}">${e.danger?'НЕГАТИВ':e.neutral?'НЕЙТРАЛЬНО':'ПОЗИТИВ'}</span></div><b>${esc(e.title)}</b><div class="eventWhat">${esc(e.text)}</div><div class="eventWhy">${esc(e.why)}</div></div>`).join(""):`<div class="empty">Для этого матча parsed event data недостаточно.</div>`;
}
const whyModal=$("whyRuinerModal");
$("whyRuinerBtn").addEventListener("click",()=>whyModal.classList.remove("hidden"));
$("closeWhyRuiner").addEventListener("click",()=>whyModal.classList.add("hidden"));
whyModal.addEventListener("click",e=>{if(e.target.dataset.closeWhy)whyModal.classList.add("hidden")});
document.addEventListener("keydown",e=>{if(e.key==="Escape")whyModal.classList.add("hidden")});

function awardScore(p){return (p.kills||0)*2.2+(p.assists||0)*.9-(p.deaths||0)*1.7+(p.hero_damage||0)/1800+(p.tower_damage||0)/2500+(p.gold_per_min||0)/180+(p.xp_per_min||0)/250;}
function awardCard(label,p,tone,desc){if(!p)return '';return `<div class="awardCard ${tone}"><div class="awardLabel">${label}</div><div class="awardPlayer"><img loading="lazy" decoding="async" src="${heroImg(p)}" onerror="this.style.visibility='hidden'"><div><b>${esc(playerName(p))}</b><span>${esc(heroName(p))} · ${esc(roleText(p))}</span></div></div>${teamChip(p.team)}<p>${desc}</p><small>K/D/A ${p.kills||0}/${p.deaths||0}/${p.assists||0} · GPM ${fmt(p.gold_per_min)} · Урон ${fmt(p.hero_damage)}</small></div>`;}
function goldAdvSeries(m,all){
 if(Array.isArray(m.radiant_gold_adv)&&m.radiant_gold_adv.length>1)return m.radiant_gold_adv.map(Number);
 const rad=all.filter(p=>p.team==='Radiant'),dire=all.filter(p=>p.team==='Dire');
 const maxLen=Math.max(0,...all.map(p=>Array.isArray(p.gold_t)?p.gold_t.length:0));
 const sum=(team,i)=>team.reduce((n,p)=>n+(Array.isArray(p.gold_t)?Number(p.gold_t[i]||0):0),0);
 return maxLen>1?Array.from({length:maxLen},(_,i)=>sum(rad,i)-sum(dire,i)):[];
}
function goldAdvantageGraph(m,all){
 const adv=goldAdvSeries(m,all);
 if(adv.length<2)return '<div class="empty">OpenDota не вернул временной ряд золота для этого матча. После разбора матча график появится автоматически.</div>';
 const max=Math.max(1000,...adv.map(Math.abs)), W=1000, H=200, mid=H/2, n=adv.length-1;
 const x=i=>(i/n*W).toFixed(1), y=v=>(mid-v/max*(mid-6)).toFixed(1);
 const line=adv.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
 const area=`0,${mid} ${line} ${W},${mid}`;
 const peakR=Math.max(0,...adv), peakD=Math.max(0,...adv.map(v=>-v)), last=adv[n];
 const ticks=[];for(let i=10;i<n-3;i+=10)ticks.push(i);
 return `<div class="graphBox">
  <span class="gLabel top radiant">▲ Radiant, пик +${fmt(peakR)}</span><span class="gLabel bottom dire">▼ Dire, пик +${fmt(peakD)}</span>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Преимущество по золоту">
   <defs><clipPath id="clipTop"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath><clipPath id="clipBot"><rect x="0" y="${mid}" width="${W}" height="${mid}"/></clipPath></defs>
   ${ticks.map(i=>`<line x1="${x(i)}" y1="0" x2="${x(i)}" y2="${H}" class="gGrid"/>`).join('')}
   <polygon points="${area}" class="gAreaR" clip-path="url(#clipTop)"/><polygon points="${area}" class="gAreaD" clip-path="url(#clipBot)"/>
   <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" class="gZero"/>
   <polyline points="${line}" class="gLineR" clip-path="url(#clipTop)"/><polyline points="${line}" class="gLineD" clip-path="url(#clipBot)"/>
  </svg>
  <div class="gTicks"><span style="left:0">0:00</span>${ticks.map(i=>`<span style="left:${(i/n*100).toFixed(2)}%">${i}:00</span>`).join('')}<span class="end">${time(m.duration)}</span></div>
 </div>
 <div class="graphFoot">Под конец матча: ${last>=0?`<b class="radiant">Radiant +${fmt(last)}</b>`:`<b class="dire">Dire +${fmt(-last)}</b>`} золота.</div>`;
}
function roleComparison(all,winTeam){
 const EXP={"Pos 1 · Carry":[520,550],"Pos 2 · Mid":[480,530],"Pos 3 · Offlane":[420,470],"Pos 4 · Soft Support":[330,390],"Pos 5 · Hard Support":[270,340]};
 const row=p=>{const exp=EXP[p.roleInfo?.role]||[400,450];const g=Math.round((p.gold_per_min||0)/exp[0]*100),x=Math.round((p.xp_per_min||0)/exp[1]*100);
   const bar=(v,label,val)=>`<div class="roleMetric ${v>=100?'over':'under'}"><span>${label}</span><div><i style="width:${clamp(v,0,150)/1.5}%"></i><em></em></div><b>${fmt(val)} <small>${v}%</small></b></div>`;
   return `<div class="roleRow ${teamCls(p.team)}"><img loading="lazy" decoding="async" src="${heroImg(p)}" onerror="this.style.visibility='hidden'"><div class="rolePlayer"><b>${esc(playerName(p))}</b><span>${posTag(p)} ${esc(heroName(p))}</span></div>${bar(g,'GPM',p.gold_per_min)}${bar(x,'XPM',p.xp_per_min)}</div>`;};
 return [winTeam,winTeam==='Radiant'?'Dire':'Radiant'].map(t=>`<div class="rcGroup"><div class="rcHead">${teamChip(t,t===winTeam?'победа':'поражение')}</div>${byPos(all.filter(p=>p.team===t)).map(row).join('')}</div>`).join('');
}
function plainSummary(m,all,scored,culprit,focusTeam,winTeam){
 const loseTeam=winTeam==='Radiant'?'Dire':'Radiant', focusWon=focusTeam===winTeam, otherTeam=focusTeam==='Radiant'?'Dire':'Radiant';
 const ws=m.radiant_win?m.radiant_score:m.dire_score, ls=m.radiant_win?m.dire_score:m.radiant_score;
 const sum=(t,k)=>all.filter(p=>p.team===t).reduce((a,p)=>a+(p[k]||0),0);
 const T=t=>`<b class="${teamCls(t)}">${t}</b>`;
 const adv=goldAdvSeries(m,all), sign=winTeam==='Radiant'?1:-1, wa=adv.map(v=>v*sign);
 const lines=[`${T(winTeam)} выиграли за ${time(m.duration)} со счётом ${fmt(ws)}:${fmt(ls)}.`];
 if(wa.length>1){
   const minLead=Math.min(...wa), minAt=wa.indexOf(minLead), at12=wa[Math.min(12,wa.length-1)], end=wa[wa.length-1];
   const midMax=Math.max(...wa.slice(0,Math.max(1,wa.length-5)).map(Math.abs));
   if(minLead<=-5000)lines.push(`Это был камбэк: на ${minAt}-й минуте ${T(loseTeam)} вели на ${fmt(-minLead)} золота, но не дожали игру.`);
   else if(at12>=3000)lines.push(`Игра решилась рано: уже к 12-й минуте ${T(winTeam)} были впереди на ${fmt(at12)} золота и дальше только увеличивали отрыв.`);
   else if(midMax<5000)lines.push(`Матч долго шёл на равных — всё решилось в последние минуты.`);
   else if(end>0)lines.push(`${T(winTeam)} постепенно наращивали преимущество и к концу были впереди на ${fmt(end)} золота.`);
   else lines.push(`По золоту ${T(winTeam)} к концу не были впереди — победу принесли драки и снос зданий.`);
 }
 const fd=sum(focusTeam,'deaths'), od=sum(otherTeam,'deaths'), ft=sum(focusTeam,'tower_damage'), ot=sum(otherTeam,'tower_damage');
 const fn=sum(focusTeam,'net_worth'), on=sum(otherTeam,'net_worth'), fh=sum(focusTeam,'hero_damage'), oh=sum(otherTeam,'hero_damage');
 const rel=(a,b)=>b>0?(b-a)/b:0;
 const issues=[
  [fd>od&&fd-od>=6?rel(od,fd):0,`команда умирала слишком часто — ${fd} ${plural(fd,'смерть','смерти','смертей')} против ${od} у соперника.`],
  [rel(ft,ot)>=.35?rel(ft,ot)*.4:0,`слабо давили здания — ${fmt(ft)} урона по строениям против ${fmt(ot)} у соперника.`],
  [rel(fn,on)>=.12?rel(fn,on):0,`отстали по золоту — ${fmt(fn)} net worth против ${fmt(on)} у соперника.`],
  [rel(fh,oh)>=.2?rel(fh,oh):0,`в драках было меньше урона — ${fmt(fh)} против ${fmt(oh)} у соперника.`]
 ].filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]);
 if(issues.length)lines.push(focusWon?`Слабое место ${T(focusTeam)}, даже несмотря на победу: ${issues[0][1]}`:`Главная проблема ${T(focusTeam)}: ${issues[0][1]}`);
 else lines.push(focusWon?`У ${T(focusTeam)} не было явных командных провалов — они переиграли соперника по смертям, золоту, урону и зданиям.`:`Командного провала по цифрам не видно — ${T(focusTeam)} уступили в мелочах, поэтому смотри советы по игрокам.`);
 const support=p=>(p.roleInfo?.position||5)>=4;
 const advice=p=>{const x=p.metrics||{};switch(p.mainKind){
  case 'farm':return support(p)?`Даже саппорту нужен минимум золота: ${fmt(x.gpm)} GPM при норме около ${x.expGpm}. Забирать лес и стаки, когда коры не нуждаются в помощи, чтобы вовремя купить ключевые предметы.`:`Больше фармить: ${fmt(x.gpm)} GPM при норме около ${x.expGpm} для этой позиции. Между драками стоять на линиях и в лесу, а не бродить по карте без цели.`;
  case 'fight':return `Наносить больше урона в драках: ${x.dmg.toFixed(0)}% урона команды при норме около ${Math.round(x.expDmg)}%. Заходить в драку вместе с командой и успевать прожать всё, что есть.`;
  case 'kp':return `Чаще быть рядом с командой: участие в убийствах ${x.kp.toFixed(0)}% при норме около ${x.expKp}%. Когда команда собирается в драку — идти туда, а не фармить на другом конце карты.`;
  case 'deaths':return `Меньше умирать: ${x.deaths} ${plural(x.deaths,'смерть','смерти','смертей')}. Не ходить без обзора и не стоять первым в поздней игре — там каждая смерть стоит очень дорого.`;
  case 'waste':return `Превращать золото в результат: фарм был, а урона и давления на здания — мало. После ключевого предмета идти в драки и на башни, а не продолжать фармить.`;
  case 'objects':return `Больше бить здания: ${fmt(x.td)} урона по строениям при норме около ${fmt(x.expTd)}. После выигранной драки сразу идти на башню.`;
  default:return p===culprit?`Одного явного провала нет — score набран из нескольких небольших минусов. Смотри разбор ниже: «${p.reasons[0]?.[0]||'несколько сигналов'}».`:`Отыграл свою позицию на нормальном уровне — серьёзных претензий нет.`;}};
 const sev=p=>p===culprit?['bad',focusWon?'слабое звено':'руинер']:p.mainKind?['mid','есть что улучшить']:['ok','норм'];
 const rows=byPos(scored).map(p=>{const [c,l]=sev(p);return `<div class="adviceRow ${teamCls(p.team)}"><img decoding="async" src="${heroImg(p)}" alt="" onerror="this.style.visibility='hidden'"><div class="adviceMain"><div class="adviceWho"><b>${esc(playerName(p))}</b><span>${posTag(p)} ${esc(heroName(p))}</span><em class="sev ${c}">${l}</em></div><p>${esc(advice(p))}</p></div></div>`}).join('');
 return `<div class="plainGrid"><div class="plainStory">${lines.map(l=>`<p>${l}</p>`).join('')}</div><div class="plainAdvice"><h3>${focusWon?'Что можно было сыграть лучше':'Что нужно было сделать иначе'}</h3>${rows}</div></div>`;
}
function metricLine(label,value,detail){return `<div class="vmetric"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(detail)}</small></div>`;}
function impactLabel(score){ if(score>=75)return "Очень высокое"; if(score>=55)return "Высокое"; if(score>=35)return "Умеренное"; if(score>=20)return "Небольшое"; return "Низкое"; }
function impactClass(score){ if(score>=75)return "very-high"; if(score>=55)return "high"; if(score>=35)return "moderate"; if(score>=20)return "low"; return "minimal"; }
function verdictText(m,p,r,focusWon=false){
 const gap=r?Math.max(0,p.score-r.score):0;
 const lead= r && gap>=8 ? `Он заметно оторвался от следующего игрока по модели: ${gap} ${plural(gap,"балл","балла","баллов")}.` : r ? `Разрыв с ближайшим по score игроком небольшой — всего ${gap} ${plural(gap,"балл","балла","баллов")}, поэтому матч нельзя сводить к одной цифре.` : `Для сравнения доступен только основной результат модели.`;
 const deathText=(p.deaths||0)>=4?`${p.deaths} смертей — заметный источник потерь темпа, особенно с учётом длительности ${time(m.duration)}.`:(p.deaths||0)>=2?`${p.deaths} смертей добавили команде цену ошибок, но сами по себе не являются главным доказательством.`:`Смертей немного (${p.deaths||0}), поэтому итог не строится только на KDA.`;
 const farmText=`${fmt(p.gold_per_min)} GPM, ${fmt(p.net_worth)} net worth и ${fmt(p.last_hits)} last hits`;
 const fightText=`${p.kp.toFixed(0)}% KP и ${p.dmgShare.toFixed(1)}% командного hero damage`;
 const objText=`${fmt(p.tower_damage)} урона по строениям`;
 const reasons=p.reasons.slice(0,3).map(x=>`<li><b>${esc(x[0])}</b><span>${esc(x[1])}</span></li>`).join('');
 const intro=focusWon?`<strong>${esc(playerName(p))}</strong> сыграл слабее всех в победившей команде — команда выиграла несмотря на это. Его показатели сравниваются с тем, что обычно ждут от <strong>его позиции</strong>.`:`<strong>${esc(playerName(p))}</strong> сыграл наиболее негативную роль в поражении. Его показатели сравниваются с тем, что обычно ждут от <strong>его позиции</strong>, и провал должен подтверждаться несколькими сигналами сразу.`;
 return `<div class="verdictCopy"><p>${intro}</p><p>${esc(lead)} Здесь важен контекст: ${esc(deathText)}</p><div class="vmetrics">${metricLine('Экономика',farmText,`ожидания роли учитываются отдельно`)}${metricLine('Влияние в драках',fightText,`урон + участие в убийствах`)}${metricLine('Объекты',objText,`давление на карту и здания`)}${metricLine(focusWon?'Слабые места':'Влияние на поражение',impactLabel(p.score),`вывод ${p.clarity?.level||'—'}`)}</div><div class="verdictReasons"><h3>Что сильнее всего повлияло</h3><ul>${reasons||'<li><b>Сигналы распределены равномерно</b><span>Нет одного показателя, который объясняет поражение целиком.</span></li>'}</ul></div></div>`;
}
function nearRuinerHtml(p,focusWon=false){
 const rs=p.reasons.slice(0,3).map(x=>`<li><b>${esc(x[0])}</b><span>${esc(x[1])}</span></li>`).join('');
 return `<div class="nearHead"><img loading="lazy" decoding="async" src="${heroImg(p)}" onerror="this.style.visibility='hidden'"><div><div class="nearLabel">${focusWon?'СЛЕДУЮЩИЙ ПО СЛАБЫМ МЕСТАМ':'БЛИЗКИЙ К РУИНУ ИГРОК'}</div><h3>${esc(playerName(p))}</h3><p>${esc(heroName(p))}</p></div><strong>${p.score}</strong></div><div class="nearStats"><span>K/D/A <b>${p.kills||0}/${p.deaths||0}/${p.assists||0}</b></span><span>GPM <b>${fmt(p.gold_per_min)}</b></span><span>KP <b>${p.kp.toFixed(0)}%</b></span><span>Hero DMG <b>${fmt(p.hero_damage)}</b></span></div><ul class="nearReasons">${rs}</ul>`;
}

function teamPhaseStats(m,all,start,end,teamName){
 const team=all.filter(p=>p.team===teamName);
 const kills=team.reduce((a,p)=>a+(p.kills_log||[]).filter(k=>k.time>=start&&k.time<end).length,0);
 const events=(m.teamfights||[]).filter(f=>Number(f.start||0)>=start&&Number(f.start||0)<end);
 const objectives=(m.objectives||[]).filter(o=>Number(o.time||0)>=start&&Number(o.time||0)<end);
 return {kills,events:events.length,objectives:objectives.length};
}
function phaseNetGap(adv,start,end,teamName){
 if(adv.length<2)return null;
 const at=sec=>adv[Math.min(adv.length-1,Math.max(0,Math.floor(sec/60)))];
 const d=at(end)-at(start); return teamName==='Radiant'?d:-d;
}
function matchStory(m,all,players,culprit,focusTeam){
 const dur=m.duration||1, winTeam=m.radiant_win?'Radiant':'Dire', loseTeam=winTeam==='Radiant'?'Dire':'Radiant';
 const otherTeam=focusTeam==='Radiant'?'Dire':'Radiant';
 const phases=[{name:'Лайнинг',start:0,end:Math.min(dur,12*60)},{name:'Мидгейм',start:12*60,end:Math.min(dur,25*60)},{name:'Лейт',start:25*60,end:dur}];
 const adv=goldAdvSeries(m,all);
 const rows=phases.filter(x=>x.end>x.start).map(ph=>{
   const l=teamPhaseStats(m,all,ph.start,ph.end,loseTeam), w=teamPhaseStats(m,all,ph.start,ph.end,winTeam);
   const hasKills=all.some(p=>Array.isArray(p.kills_log));
   const netGap=phaseNetGap(adv,ph.start,ph.end,loseTeam)??0, killGap=hasKills?l.kills-w.kills:0;
   const leader=netGap<=-1800||killGap<=-3?winTeam:netGap>=1800||killGap>=3?loseTeam:null;
   const gold=Math.abs(netGap), goldTeam=netGap<0?winTeam:loseTeam;
   let text=adv.length<2&&!hasKills?'Для этой фазы нет поминутных данных OpenDota.':'Равная фаза: заметного перевеса ни у кого не было.';
   if(leader)text=`Перевес ${leader}: ${[gold>=1800&&goldTeam===leader?`+${fmt(gold)} золота`:'',Math.abs(killGap)>=3?`на ${Math.abs(killGap)} убийств больше`:''].filter(Boolean).join(' и ')||'перевес по ходу фазы'}.`;
   const rk=t=>(t==='Radiant'?(loseTeam==='Radiant'?l:w):(loseTeam==='Dire'?l:w)).kills;
   return `<div class="phase ${leader?teamCls(leader):'neutral'}"><div class="phaseHead"><b>${ph.name}</b><span>${time(ph.start)}–${time(ph.end)}</span></div>${leader?teamChip(leader,'забрали фазу'):'<span class="teamChip neutral"><i></i>Равенство</span>'}<p>${text}</p><small>${hasKills?`Убийства: <b class="radiant">Radiant ${rk('Radiant')}</b> : <b class="dire">${rk('Dire')} Dire</b>`:''}${hasKills&&adv.length>1?' · ':''}${adv.length>1?`Золото за фазу: <b class="${teamCls(goldTeam)}">${goldTeam} +${fmt(gold)}</b>`:''}</small></div>`;
 }).join('');
 const turning=findTurningPoint(m,all,culprit,focusTeam,otherTeam);
 const lesson=mainLesson(culprit,turning,m);
 const innocence=notTheirFault(culprit,m,all,loseTeam);
 return `<div class="storyGrid"><div class="phases">${rows}</div><div class="turning"><div class="storyLabel">МОМЕНТ ПЕРЕЛОМА</div><h3>${esc(turning.title)}</h3><div class="turnTime">${turning.t}</div><p>${esc(turning.text)}</p><b>${esc(turning.why)}</b></div><div class="lesson"><div class="storyLabel">ГЛАВНЫЙ УРОК</div><h3>${esc(lesson.title)}</h3><p>${esc(lesson.text)}</p><div class="nextGame"><span>В следующей игре</span><b>${esc(lesson.action)}</b></div></div><div class="innocence"><div class="storyLabel goodLabel">ЧТО НЕ БЫЛО ЕГО ОШИБКОЙ</div><h3>${esc(innocence.title)}</h3><p>${esc(innocence.text)}</p></div></div>`;
}
function findTurningPoint(m,all,p,loseTeam,winTeam){
 const swing=(f,team)=>all.filter(x=>x.team===team).reduce((a,x)=>{const z=fightOf(f,x);return a+(z?(z.gold_delta??(fightKills(z)*200-(z.deaths||0)*200)):0)},0);
 const fights=(m.teamfights||[]).map(f=>({f,score:swing(f,winTeam)-swing(f,loseTeam),cp:fightOf(f,p)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 const best=fights.slice(0,3).find(x=>x.cp&&(x.cp.deaths||0)>0)||fights[0];
 if(best){
   const x=best.cp||{}; return {t:time(best.f.start||0),title:(x.deaths||0)>0?`${playerName(p)} погиб в важной драке`:'Команда проиграла ключевую драку',text:`${winTeam} выиграли на этой драке ${fmt(Math.round(best.score))} золота. У ${playerName(p)}: ${fmt(x.damage||0)} hero damage, ${fightKills(x)} kills, ${x.deaths||0} death.`,why:(x.deaths||0)>0?'Это одна из самых дорогих драк матча, и игрок в ней погиб.':'Это самая дорогая для разбираемой команды драка по доступным данным.'};
 }
 const late=p.deaths>=2?`${playerName(p)} потерял темп из-за нескольких смертей в поздней игре`:'Преимущество постепенно перешло к сопернику';
 return {t:'—',title:late,text:'В данных OpenDota нет достаточного количества событий, чтобы уверенно привязать перелом к одному моменту.',why:'Поэтому сервис не придумывает конкретную причину.'};
}
function mainLesson(p,turning,m){
 const r=p.reasons[0];
 if(r) return {title:r[0],text:r[1],action: lessonAction(p)};
 return {title:'Не один показатель решал исход',text:'Вклад игрока сформирован несколькими сигналами, поэтому исправлять нужно не одну цифру.',action:'Смотри на связку фарм → драка → объект, а не только на KDA.'};
}
function lessonAction(p){
 const role=p.role||'';
 if(/Pos 1/.test(role)) return 'После ключевого предмета искать окно для драки или объекта, а не продолжать фарм автоматически.';
 if(/Pos 2/.test(role)) return 'После получения преимущества превращать его в драки и объекты, а не только в дополнительный farm.';
 if(/Pos 3/.test(role)) return 'Инициировать игру вокруг своей команды и объектов, а не отдавать темп пассивным фармом.';
 return 'Искать активное влияние на карту: драки, объекты, вижен и помощь core в правильный момент.';
}
function notTheirFault(p,m,all,loseTeam){
 const death=(p.deaths||0), dmg=p.dmgShare||0, kp=p.kp||0;
 if(kp>=55 && dmg>=12) return {title:'Он реально участвовал в драках',text:`${kp.toFixed(0)}% KP и ${dmg.toFixed(1)}% командного hero damage показывают, что одного KDA мало, чтобы описать его игру.`};
 if(death<=2) return {title:'Смерти не были главным источником проблем',text:`У него ${death} ${death===1?'смерть':death>=2&&death<=4?'смерти':'смертей'}. Итоговый вывод не строится только на количестве смертей.`};
 return {title:'Результат был командным',text:'Даже при высоком score одного игрока нельзя считать его единственной причиной исхода: оценка учитывает вклад относительно роли и контекста матча.'};
}

function winnerPlayerCard(p){
 const kd=`${p.kills||0}/${p.deaths||0}/${p.assists||0}`;
 return `<div class="winnerPlayer"><img loading="lazy" decoding="async" class="heroIcon" src="${heroImg(p)}" onerror="this.style.visibility='hidden'"><div class="winnerPlayerMain"><b>${esc(playerName(p))}</b><span>${posTag(p)} ${esc(heroName(p))} · ${esc(roleText(p))}</span><small>K/D/A ${kd} · GPM ${fmt(p.gold_per_min)} · XPM ${fmt(p.xp_per_min)} · Урон ${fmt(p.hero_damage)}</small></div><strong>${fmt(p.net_worth)} NW</strong></div>`;
}
function playerCard(p,isCulprit,badge='РУИНЕР'){
 const kd=`${p.kills||0}/${p.deaths||0}/${p.assists||0}`, items=itemsOf(p);
 return `<div class="playerCard ${teamCls(p.team)} ${isCulprit?'culprit':''}">
  <div class="playerHead"><img loading="lazy" decoding="async" class="heroIcon" src="${heroImg(p)}" onerror="this.style.visibility='hidden'"><div><div class="pname">${esc(playerName(p))}${isCulprit?` <span class="culpritBadge">${badge}</span>`:''}</div><div class="heroName">${posTag(p)} ${esc(heroName(p))} · ${esc(roleText(p))}</div></div><div class="pScore ${impactClass(p.score)}" title="Негативный score модели">${p.score}</div></div>
  <div class="statgrid"><span>K/D/A <b>${kd}</b></span><span>GPM <b>${fmt(p.gold_per_min)}</b></span><span>XPM <b>${fmt(p.xp_per_min)}</b></span><span>Last Hits <b>${fmt(p.last_hits)}</b></span><span>Hero DMG <b>${fmt(p.hero_damage)}</b></span><span>DMG Share <b>${p.dmgShare.toFixed(1)}%</b></span><span>KP <b>${p.kp.toFixed(0)}%</b></span><span>Tower DMG <b>${fmt(p.tower_damage)}</b></span><span>Net Worth <b>${fmt(p.net_worth)}</b></span><span>Healing <b>${fmt(p.hero_healing)}</b></span><span>Wards <b>${fmt((p.obs_placed||0)+(p.sentry_placed||0))}</b></span><span>Denies <b>${fmt(p.denies)}</b></span></div>
  <div class="build"><span>Сборка</span>${items.length?items.map(id=>`<img loading="lazy" decoding="async" title="${esc(itemName(id))}" src="${itemImg(id)}" onerror="this.style.visibility='hidden'">`).join(''):'<em>нет данных</em>'}</div>
 </div>`;
}
function objectiveLabel(o){
 const key=String(o.key||'').replace(/^npc_dota_(goodguys|badguys)_/,'');
 const building=key.replace(/^tower(\d)_(top|mid|bot)$/,(_,n,l)=>`башня T${n} ${({top:'топ',mid:'мид',bot:'бот'})[l]}`).replace(/^(melee|range)_rax_(top|mid|bot)$/,(_,t,l)=>`бараки ${t==='melee'?'ближние':'дальние'} ${({top:'топ',mid:'мид',bot:'бот'})[l]}`).replace(/^fort$/,'трон').replace(/^tower4$/,'башня T4');
 return ({
  building_kill:{title:'Снёс строение',text:building||'Строение противника'},
  CHAT_MESSAGE_FIRSTBLOOD:{title:'Первая кровь',text:'Игрок сделал first blood.'},
  CHAT_MESSAGE_ROSHAN_KILL:{title:'Рошан',text:'Убийство Рошана.'},
  CHAT_MESSAGE_AEGIS:{title:'Аегис',text:'Игрок подобрал Aegis.'},
  CHAT_MESSAGE_MINIBOSS_KILL:{title:'Торментор',text:'Убийство Tormentor.'}
 })[o.type]||{title:`Объект: ${o.type}`,text:o.subtype||'Событие найдено в данных матча.'};
}
function buildEvents(m,p){
 const out=[],slot=p.player_slot;
 const eventPlayer={name:playerName(p),hero:heroName(p),img:heroImg(p)};

 for(const f of (m.teamfights||[])){
   const x=fightOf(f,p); if(!x)continue;
   const dmg=x.damage||0, k=fightKills(x), heal=x.healing||0, d=x.deaths||0, sec=f.start||0;
   if(d>0){
     out.push({sec,t:time(sec),player:eventPlayer,title:`Смерть в командной драке`,text:`${fmt(dmg)} hero damage • ${k} kills • ${d} death`,danger:dmg<500,neutral:dmg>=500,why:dmg<500?"Смерть произошла при небольшом личном вкладе в драку.":"Смерть есть, но у игрока был заметный вклад уроном — поэтому эпизод не считается автоматической ошибкой."});
   } else if(dmg>1000 || k>=2 || heal>800){
     out.push({sec,t:time(sec),player:eventPlayer,title:`Заметный вклад в teamfight`,text:`${fmt(dmg)} hero damage • ${k} kills${heal?` • ${fmt(heal)} healing`:''}`,danger:false,why:"Игрок конвертировал присутствие в драке в урон или убийства — это положительный сигнал."});
   }
 }

 for(const o of (m.objectives||[])){
   if(o.player_slot!==slot||!o.type)continue;
   const obj=objectiveLabel(o); out.push({sec:o.time||0,t:time(o.time||0),player:eventPlayer,title:obj.title,text:obj.text,danger:false,why:"Участие в objective учитывается как вклад в продвижение команды."});
 }

 const real=out.map((e,i)=>({e,i})).sort((a,b)=>(b.e.danger-a.e.danger)||(a.i-b.i)).slice(0,10).map(x=>x.e).sort((a,b)=>a.sec-b.sec);
 if(real.length) return real;

 const deaths=p.deaths||0, kp=p.kp||0, dmgShare=p.dmgShare||0, tower=p.tower_damage||0;
 const gpm=p.gold_per_min||0;
 const derived=[];
 if(deaths>=3){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Высокая цена смертей`,text:`${deaths} смертей за матч`,danger:true,why:"Без таймлайна нельзя утверждать, какая именно смерть стала переломной, но количество смертей заметно увеличивает цену ошибок."});
 }
 if(kp<45){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Низкое участие в убийствах`,text:`Kill Participation ${kp.toFixed(0)}%`,danger:true,why:"Игрок редко участвовал в результативных действиях команды; для оценки важно учитывать его роль и ожидания от неё."});
 } else if(kp>=65){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Активное участие в убийствах`,text:`Kill Participation ${kp.toFixed(0)}%`,danger:false,why:"Высокое участие в убийствах снижает вероятность того, что игрок полностью выпал из командной игры."});
 }
 if(dmgShare<10){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Небольшой вклад в hero damage`,text:`${dmgShare.toFixed(1)}% командного hero damage`,danger:true,why:"Доля урона низкая. Это не самостоятельное доказательство ошибки — показатель оценивается вместе с ролью, фармом и участием в игре."});
 } else if(dmgShare>=20){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Высокий вклад в hero damage`,text:`${dmgShare.toFixed(1)}% командного hero damage`,danger:false,why:"Игрок внёс заметную долю командного урона, поэтому его нельзя оценивать только по KDA или смертям."});
 }
 if(tower<500){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Ограниченное давление на объекты`,text:`${fmt(tower)} урона по строениям`,danger:true,why:"Урон по зданиям небольшой. Значимость этого сигнала зависит от роли и от того, насколько команда вообще имела окна для пуша."});
 }
 if(gpm>0 && derived.length<2){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Экономика матча`,text:`${fmt(gpm)} GPM • ${fmt(p.net_worth)} net worth • ${fmt(p.last_hits)} last hits`,danger:false,why:"Экономика используется как контекст: высокий или низкий фарм сам по себе не доказывает руин."});
 }
 if(!derived.length){
   derived.push({t:'По итогам матча',player:eventPlayer,title:`Недостаточно событий для точной временной привязки`,text:`OpenDota не передал подробный teamfight/objective timeline`,danger:false,why:"Сервис показывает только проверяемые сигналы из статистики и не придумывает конкретные минуты или события."});
 }
 return derived.slice(0,5);
}
