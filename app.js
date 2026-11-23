const $ = (id) => document.getElementById(id);
const state = {
  clientId: localStorage.getItem("fd_client_id") || "",
  token: null,
  calendars: [],
  selected: JSON.parse(localStorage.getItem("fd_selected") || "[]"),
  events: [],
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  location: JSON.parse(localStorage.getItem("fd_location") || '{"name":"Stockton, California","lat":37.9577,"lon":-121.2908}'),
  use24: localStorage.getItem("fd_24hour") === "true",
  showForecast: localStorage.getItem("fd_forecast") !== "false"
};
const palette = ["#a9d5ff","#f6c978","#b8e3c5","#d8b9ff","#ffb8b0","#9fe2df","#f2b8dc","#c7d4a1"];
let tokenClient = null;
let toastTimer = null;

function showToast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3200)}
function localDateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function parseEventDate(ev){const v=ev.start?.dateTime||ev.start?.date;if(!v)return null;return ev.start?.date?new Date(`${v}T00:00:00`):new Date(v)}
function fmtTime(d){if(!d)return "All day";return new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",hour12:!state.use24}).format(d)}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function setStatus(connected){$("connectionStatus").textContent=connected?"Google connected":"Not connected";$("connectionStatus").classList.toggle("connected",connected)}
function openSettings(){$("settingsBackdrop").hidden=false}
function closeSettings(){$("settingsBackdrop").hidden=true}
function updateLabels(){
  $("todayLabel").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(new Date());
  $("monthLabel").textContent=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(state.month);
  $("agendaDate").textContent=new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date());
}
function savePrefs(){localStorage.setItem("fd_selected",JSON.stringify(state.selected));localStorage.setItem("fd_24hour",String(state.use24));localStorage.setItem("fd_forecast",String(state.showForecast))}
function googleReady(){return window.google?.accounts?.oauth2}
function saveClient(){state.clientId=$("clientId").value.trim();localStorage.setItem("fd_client_id",state.clientId);showToast("Google Client ID saved.");initGoogle()}
function initGoogle(){
  if(!state.clientId||!googleReady())return;
  tokenClient=google.accounts.oauth2.initTokenClient({client_id:state.clientId,scope:"https://www.googleapis.com/auth/calendar.readonly",callback:async(resp)=>{if(resp.error){showToast("Google sign-in failed: "+resp.error);return}state.token=resp.access_token;setStatus(true);await loadCalendars();await loadEvents();}});
}
function connectGoogle(){
  if(!state.clientId){showToast("Add your Google OAuth Client ID in Settings first.");return}
  if(!googleReady()){showToast("Google sign-in is still loading. Try again in a moment.");return}
  initGoogle();tokenClient.requestAccessToken({prompt:"consent"});
}
async function googleFetch(url){
  if(!state.token)throw new Error("Connect Google Calendar first.");
  const res=await fetch(url,{headers:{Authorization:`Bearer ${state.token}`}});
  if(res.status===401){state.token=null;setStatus(false);throw new Error("Google authorization expired. Reconnect Google Calendar.")}
  if(!res.ok)throw new Error(`Google Calendar error (${res.status}).`);
  return res.json();
}
async function loadCalendars(){
  try{
    const data=await googleFetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250");
    state.calendars=(data.items||[]).filter(c=>c.accessRole!=="freeBusyReader");
    if(!state.selected.length)state.selected=state.calendars.map(c=>c.id);
    state.selected=state.selected.filter(id=>state.calendars.some(c=>c.id===id));
    renderCalendarChoices();renderLegend();savePrefs();
  }catch(e){showToast(e.message)}
}
function renderCalendarChoices(){
  const wrap=$("calendarChoices");
  if(!state.calendars.length){wrap.innerHTML='<p class="help">No calendars found yet.</p>';return}
  wrap.innerHTML=state.calendars.map((c,i)=>`<label class="calendar-choice"><input type="checkbox" data-calendar="${esc(c.id)}" ${state.selected.includes(c.id)?"checked":""}><span class="legend-dot" style="background:${palette[i%palette.length]}"></span><span>${esc(c.summary)}</span></label>`).join("");
  wrap.querySelectorAll("input").forEach(el=>el.addEventListener("change",()=>{const id=el.dataset.calendar;state.selected=el.checked?[...state.selected,id]:state.selected.filter(x=>x!==id);savePrefs();renderLegend();loadEvents()}));
}
function calendarColor(id){const i=state.calendars.findIndex(c=>c.id===id);return palette[(i<0?0:i)%palette.length]}
function renderLegend(){
  $("calendarLegend").innerHTML=state.calendars.filter(c=>state.selected.includes(c.id)).map(c=>`<span class="legend-item"><span class="legend-dot" style="background:${calendarColor(c.id)}"></span>${esc(c.summary)}</span>`).join("")||'<span class="muted">Choose calendars in Settings.</span>';
}
async function loadEvents(){
  if(!state.token){renderCalendar();renderAgenda();return}
  try{
    const start=new Date(state.month.getFullYear(),state.month.getMonth()-1,1);
    const end=new Date(state.month.getFullYear(),state.month.getMonth()+2,1);
    const chosen=state.calendars.filter(c=>state.selected.includes(c.id));
    const all=await Promise.all(chosen.map(async c=>{
      const q=new URLSearchParams({timeMin:start.toISOString(),timeMax:end.toISOString(),singleEvents:"true",orderBy:"startTime",maxResults:"250"});
      const data=await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`);
      return (data.items||[]).map(ev=>({...ev,_calendarId:c.id,_calendarName:c.summary,_color:calendarColor(c.id)}));
    }));
    state.events=all.flat().filter(e=>!e.status||e.status==="confirmed").sort((a,b)=>(parseEventDate(a)||0)-(parseEventDate(b)||0));
    renderCalendar();renderAgenda();
  }catch(e){showToast(e.message)}
}
function renderCalendar(){
  updateLabels();const grid=$("calendarGrid");const first=new Date(state.month.getFullYear(),state.month.getMonth(),1);const start=new Date(first);start.setDate(first.getDate()-first.getDay());
  const weekdays=["SUN","MON","TUE","WED","THU","FRI","SAT"];
  let html=weekdays.map(d=>`<div class="weekday">${d}</div>`).join("");
  const today=localDateKey(new Date());
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=localDateKey(d);
    const todays=state.events.filter(ev=>{const dt=parseEventDate(ev);return dt&&localDateKey(dt)===key});
    html+=`<div class="day-cell ${d.getMonth()!==state.month.getMonth()?"other-month":""} ${key===today?"today":""}"><div class="day-number">${d.getDate()}</div>${todays.slice(0,3).map(ev=>`<div class="event-chip" style="--event-color:${ev._color}" title="${esc(ev.summary)}">${esc(ev.summary||"(No title)")}</div>`).join("")}${todays.length>3?`<div class="more-events">+${todays.length-3} more</div>`:""}</div>`;
  }
  grid.innerHTML=html;
}
function renderAgenda(){
  const now=new Date();const upcoming=state.events.filter(ev=>{const d=parseEventDate(ev);return d&&((ev.end?.dateTime?new Date(ev.end.dateTime):d)>=new Date(now.getTime()-60*60*1000))}).slice(0,18);
  if(!upcoming.length){$("agendaList").innerHTML='<div class="empty-state">No upcoming events found. Enjoy the breathing room!</div>';return}
  let lastDay="";
  $("agendaList").innerHTML=upcoming.map(ev=>{
    const d=parseEventDate(ev);const key=localDateKey(d);let heading="";
    if(key!==lastDay){lastDay=key;heading=`<div class="agenda-day">${new Intl.DateTimeFormat(undefined,{weekday:"long",month:"short",day:"numeric"}).format(d).toUpperCase()}</div>`}
    const time=ev.start?.date?"All day":fmtTime(d);
    const end=ev.end?.dateTime?fmtTime(new Date(ev.end.dateTime)):"";
    return `${heading}<div class="agenda-item" style="--event-color:${ev._color}"><div class="agenda-time">${time}</div><div class="agenda-bar"></div><div class="agenda-copy"><div class="agenda-title">${esc(ev.summary||"(No title)")}</div><div class="agenda-meta">${esc(ev._calendarName)}${end?" · "+end:""}${ev.location?" · "+esc(ev.location):""}</div></div></div>`;
  }).join("");
}
async function setWeatherLocation(){
  const query=$("locationInput").value.trim();if(!query)return;
  try{
    const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const data=await fetch(url).then(r=>r.json());const place=data.results?.[0];
    if(!place)throw new Error("Couldn't find that location. Try a nearby city.");
    state.location={name:[place.name,place.admin1].filter(Boolean).join(", "),lat:place.latitude,lon:place.longitude};
    localStorage.setItem("fd_location",JSON.stringify(state.location));await loadWeather();showToast("Weather location updated.");
  }catch(e){showToast(e.message)}
}
const weatherCodes={0:["Clear sky","☀️"],1:["Mainly clear","🌤️"],2:["Partly cloudy","⛅"],3:["Overcast","☁️"],45:["Fog","🌫️"],48:["Rime fog","🌫️"],51:["Light drizzle","🌦️"],53:["Drizzle","🌦️"],55:["Heavy drizzle","🌧️"],61:["Light rain","🌦️"],63:["Rain","🌧️"],65:["Heavy rain","🌧️"],71:["Light snow","🌨️"],73:["Snow","🌨️"],75:["Heavy snow","❄️"],80:["Rain showers","🌦️"],81:["Showers","🌧️"],82:["Heavy showers","⛈️"],95:["Thunderstorm","⛈️"],96:["Thunderstorm and hail","⛈️"],99:["Severe thunderstorm","⛈️"]};
async function loadWeather(){
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${state.location.lat}&longitude=${state.location.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5`;
    const data=await fetch(url).then(r=>r.json());const c=data.current;const [desc,icon]=weatherCodes[c.weather_code]||["Current conditions","🌤️"];
    $("weatherLocation").textContent=state.location.name.toUpperCase();$("temperature").textContent=`${Math.round(c.temperature_2m)}°`; $("weatherDescription").textContent=desc;$("weatherIcon").textContent=icon;
    $("feelsLike").textContent=`Feels like ${Math.round(c.apparent_temperature)}°`;$("detailFeels").textContent=`${Math.round(c.apparent_temperature)}°`;$("detailWind").textContent=`${Math.round(c.wind_speed_10m)} mph`;$("detailHumidity").textContent=`${c.relative_humidity_2m}%`;
    $("forecast").style.display=state.showForecast?"grid":"none";
    $("forecast").innerHTML=data.daily.time.slice(1,5).map((date,i)=>{const code=data.daily.weather_code[i+1];const [label,ico]=weatherCodes[code]||["Weather","🌤️"];const day=new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{weekday:"short"});return `<div class="forecast-day"><span>${day}</span><b>${ico}</b><strong>${Math.round(data.daily.temperature_2m_max[i+1])}° / ${Math.round(data.daily.temperature_2m_min[i+1])}°</strong></div>`}).join("");
  }catch(e){$("weatherDescription").textContent="Weather unavailable";console.error(e)}
}
function refreshAll(){loadWeather();loadEvents();showToast("Refreshing dashboard…")}
function init(){
  $("clientId").value=state.clientId;$("locationInput").value=state.location.name;$("24hour").checked=state.use24;$("showForecast").checked=state.showForecast;
  updateLabels();renderCalendar();renderAgenda();loadWeather();
  $("settingsOpen").onclick=openSettings;$("settingsClose").onclick=closeSettings;$("doneSettings").onclick=closeSettings;
  $("settingsBackdrop").addEventListener("click",e=>{if(e.target===$("settingsBackdrop"))closeSettings()});
  $("saveClient").onclick=saveClient;$("connectGoogle").onclick=connectGoogle;$("disconnectGoogle").onclick=()=>{state.token=null;state.events=[];state.calendars=[];state.selected=[];setStatus(false);renderCalendarChoices();renderLegend();renderCalendar();renderAgenda();showToast("Disconnected. Revoke app access in your Google Account to fully remove permission.")};
  $("saveLocation").onclick=setWeatherLocation;$("refreshAll").onclick=refreshAll;
  $("24hour").onchange=e=>{state.use24=e.target.checked;savePrefs();renderAgenda()};$("showForecast").onchange=e=>{state.showForecast=e.target.checked;savePrefs();loadWeather()};
  $("prevMonth").onclick=()=>{state.month.setMonth(state.month.getMonth()-1);loadEvents();renderCalendar()};$("nextMonth").onclick=()=>{state.month.setMonth(state.month.getMonth()+1);loadEvents();renderCalendar()};$("goToday").onclick=()=>{state.month=new Date(new Date().getFullYear(),new Date().getMonth(),1);loadEvents()};
  setStatus(false);setTimeout(initGoogle,1200);
}
document.addEventListener("DOMContentLoaded",init);
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));


// Simple approximate lunar phase display.
function updateMoon(){
  const synodic=29.530588853;
  const knownNewMoon=Date.UTC(2000,0,6,18,14);
  const now=Date.now();
  const age=((now-knownNewMoon)/86400000%synodic+synodic)%synodic;
  const illumination=Math.round((1-Math.cos(2*Math.PI*age/synodic))/2*100);
  const phases=[
    [1.85,"New Moon","🌑"],[5.53,"Waxing Crescent","🌒"],[9.22,"First Quarter","🌓"],
    [12.91,"Waxing Gibbous","🌔"],[16.61,"Full Moon","🌕"],[20.30,"Waning Gibbous","🌖"],
    [23.99,"Last Quarter","🌗"],[27.68,"Waning Crescent","🌘"],[29.54,"New Moon","🌑"]
  ];
  const p=phases.find(x=>age<x[0])||phases[0];
  const name=age<1.85?"New Moon":p[1];
  $("moonPhaseName").textContent=name;
  $("moonVisual").textContent=p[2];
  $("moonIllumination").textContent=`${illumination}% illuminated`;
  const next=phases.find(x=>x[0]>age);
  $("moonNextPhase").textContent=next?`Next: ${next[1]}`:"";
}
const originalInit=init;
document.addEventListener("DOMContentLoaded",updateMoon);
