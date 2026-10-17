
/* ===== UI helpers ===== */
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||getComputedStyle(document.body).getPropertyValue(n).trim();
const acc=()=>getComputedStyle(document.body).getPropertyValue('--accent').trim();
const isF=Number.isFinite;
const fmt=(v,d=1)=>{if(v===undefined||v===null||!isF(v))return '–';if(Math.abs(v)<0.5*Math.pow(10,-d))v=0;return Math.abs(v)>=10000?v.toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):v.toFixed(d);};
const sgn=(v,d=1)=>(v>0?'+':v<0?'−':'')+fmt(Math.abs(v),d);
const MU=t=>String(t).replace(/µ/g,'<span style="text-transform:none">µ</span>');
const EQ=(s,lbl,small)=>`<div class="eq">${lbl?`<span class="lbl">${MU(lbl)}</span>`:''}${s}${small?`<small>${small}</small>`:''}</div>`;
const FR=(a,b)=>`<span class="frac"><span>${a}</span><span>${b}</span></span>`;
const ICON={field:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v5" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="10.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  warn:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v4M8 11.6v.9" stroke="currentColor" stroke-width="1.6"/></svg>',
  key:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7v4.5M8 4.4v.9" stroke="currentColor" stroke-width="1.6"/></svg>'};
const NOTE=(kind,title,html)=>`<div class="note ${kind}"><p class="nh">${ICON[kind]||''}${MU(title)}</p>${html}</div>`;
const FOLD=(t,html)=>`<details class="fold"><summary>${t}</summary>${html}</details>`;
const KPIT=(k,v,cls='')=>`<div class="kpi ${cls}"><div class="k">${k}</div><div class="v t">${v}</div></div>`;
const sci=v=>{const e=Math.floor(v),m=Math.pow(10,v-e);return m.toFixed(1)+' × 10'+String(e).replace(/\d/g,d=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);};
const KPI=(k,v,cls='')=>`<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

function setup(cv,h){const dpr=Math.min(2,window.devicePixelRatio||1),w=cv.clientWidth||cv.parentNode.clientWidth||600;const H=h!==undefined?h:Math.round(w*0.6);
  cv.style.height=H+'px';cv.width=Math.round(w*dpr);cv.height=Math.round(H*dpr);const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,W:w,H,dpr};}
function slider(id,label,min,max,step,val,unit,disp){return `<div class="ctrl"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output id="${id}o" for="${id}">${disp?disp(+val):val} ${unit}</output></div>`;}
function bindSlider(id,unit,fn,disp){const el=$(id),o=$(id+'o');if(!el)return;let raf=0;el.addEventListener('input',()=>{const v=+el.value;o.textContent=(disp?disp(v):v)+' '+unit;cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>fn(v));});}
function segHTML(id,opts,cur,label){return `<div class="seg" id="${id}" role="group" aria-label="${label||id}">${opts.map(([v,t])=>`<button type="button" data-v="${v}" aria-pressed="${String(v)===String(cur)}">${t}</button>`).join('')}</div>`;}
function bindSeg(id,fn){const el=$(id);if(!el)return;el.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{el.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));fn(b.dataset.v);}));}
function legend(el,items){if(!el)return;el.innerHTML=items.map(it=>it.text?`<span>${it.text}</span>`:`<span><i class="${it.dash?'dash':''}${it.dot?'dot':''}${it.box?'box':''}" style="${it.dot||it.box?'background':'border-top-color'}:${it.color}"></i>${it.label}</span>`).join('');}

/* ---------- line plot with hover read-out ---------- */
function nice(lo,hi,n){const span=hi-lo||1,s0=span/n,mag=Math.pow(10,Math.floor(Math.log10(s0))),r=s0/mag,step=(r<1.5?1:r<3?2:r<7?5:10)*mag;const out=[];for(let v=Math.ceil(lo/step-1e-9)*step;v<=hi+1e-9*step;v+=step)out.push(+v.toFixed(10));return {ticks:out,step};}
function nearestIdx(xa,x){let lo=0,hi=xa.length-1;if(xa[hi]<xa[lo]){let b=0;for(let i=1;i<xa.length;i++)if(Math.abs(xa[i]-x)<Math.abs(xa[b]-x))b=i;return b;}while(hi-lo>1){const m=(lo+hi)>>1;if(xa[m]<x)lo=m;else hi=m;}return Math.abs(xa[lo]-x)<=Math.abs(xa[hi]-x)?lo:hi;}
function plot(cv,cfg){cv._cfg=cfg;const {ctx,W,H}=setup(cv,cfg.h||(window.innerWidth<640?220:250));const pad=Object.assign({l:58,r:cfg.y2?52:12,t:12,b:38},cfg.pad||{});const [x0,x1]=cfg.xlim;
  const rng=(ser,lim)=>{let lo=Infinity,hi=-Infinity;if(lim)return lim;for(const s of ser){if(s.noscale)continue;for(let i=0;i<s.x.length;i++){const x=s.x[i];if(x<x0||x>x1)continue;const v=s.y[i];if(!isF(v))continue;if(v<lo)lo=v;if(v>hi)hi=v;}}
    for(const m of (cfg.markers||[]))if(!m.y2&&m.x>=x0&&m.x<=x1){lo=Math.min(lo,m.y);hi=Math.max(hi,m.y);}for(const v of (cfg.hlines||[])){lo=Math.min(lo,v.y);hi=Math.max(hi,v.y);}
    if(!isF(lo)){lo=-1;hi=1;}const p=(hi-lo)*0.07||Math.abs(hi)*0.1||1;return [lo-p,hi+p];};
  let [lo,hi]=rng(cfg.series.filter(s=>!s.y2),cfg.ylim);if(cfg.yzero){lo=Math.min(lo,0);hi=Math.max(hi,0);}
  const X=x=>pad.l+(x-x0)/(x1-x0)*(W-pad.l-pad.r);let Y=y=>pad.t+(1-(y-lo)/(hi-lo))*(H-pad.t-pad.b);if(cfg.flipY)Y=y=>pad.t+((y-lo)/(hi-lo))*(H-pad.t-pad.b);
  let lo2,hi2,Y2;if(cfg.y2){[lo2,hi2]=rng(cfg.series.filter(s=>s.y2),cfg.y2lim);Y2=y=>pad.t+(1-(y-lo2)/(hi2-lo2))*(H-pad.t-pad.b);}
  cv._inv=px=>x0+(px-pad.l)/(W-pad.l-pad.r)*(x1-x0);cv._X=X;cv._Y=Y;
  const muted=css('--muted'),rule=css('--rule'),ink=css('--ink');ctx.font='500 12px '+css('--disp');ctx.strokeStyle=rule;ctx.lineWidth=1;
  for(const b of (cfg.bands||[])){ctx.fillStyle=b.color;ctx.fillRect(X(b.x0),pad.t,X(b.x1)-X(b.x0),H-pad.t-pad.b);}
  for(const b of (cfg.ybands||[])){ctx.fillStyle=b.color;const ya=Y(b.y0),yb=Y(b.y1);ctx.fillRect(pad.l,Math.min(ya,yb),W-pad.l-pad.r,Math.abs(yb-ya));}
  ctx.fillStyle=muted;const yt=nice(lo,hi,cfg.yticks||4);ctx.textAlign='right';ctx.textBaseline='middle';
  for(const v of yt.ticks){const y=Y(v);if(y<pad.t-1||y>H-pad.b+1)continue;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillText(cfg.yfmt?cfg.yfmt(v):fmt(v,yt.step<0.01?3:yt.step<0.1?2:yt.step<1?1:0),pad.l-6,y);}
  if(cfg.y2){ctx.textAlign='left';const t2=nice(lo2,hi2,4);for(const v of t2.ticks){const y=Y2(v);if(y<pad.t||y>H-pad.b)continue;ctx.fillText(fmt(v,t2.step<0.1?2:t2.step<1?1:0),W-pad.r+6,y);}
    ctx.save();ctx.translate(W-10,pad.t+(H-pad.t-pad.b)/2);ctx.rotate(Math.PI/2);ctx.textAlign='center';ctx.fillStyle=cfg.y2color||muted;ctx.fillText(cfg.y2label||'',0,0);ctx.restore();ctx.fillStyle=muted;}
  const xt=cfg.xstep?{ticks:Array.from({length:Math.floor((x1-x0)/cfg.xstep+1e-9)+1},(_,i)=>x0+i*cfg.xstep),step:cfg.xstep}:nice(x0,x1,cfg.xticks||(W<480?4:6));ctx.textAlign='center';ctx.textBaseline='top';
  for(const v of xt.ticks){const x=X(v);if(x<pad.l-1||x>W-pad.r+1)continue;ctx.beginPath();ctx.moveTo(x,H-pad.b);ctx.lineTo(x,H-pad.b+4);ctx.stroke();ctx.textAlign=x>W-pad.r-18?'right':'center';ctx.fillText(cfg.xfmt?cfg.xfmt(v):String(+v.toFixed(6)),x>W-pad.r-18?W-pad.r:x,H-pad.b+6);}ctx.textAlign='center';
  ctx.fillText(cfg.xlabel||'',pad.l+(W-pad.l-pad.r)/2,H-15);
  ctx.save();ctx.translate(13,pad.t+(H-pad.t-pad.b)/2);ctx.rotate(-Math.PI/2);ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(cfg.ylabel||'mGal',0,0);ctx.restore();
  for(const v of (cfg.hlines||[])){ctx.strokeStyle=v.color||muted;ctx.setLineDash(v.dash||[4,3]);ctx.lineWidth=v.w||1;ctx.beginPath();ctx.moveTo(pad.l,Y(v.y));ctx.lineTo(W-pad.r,Y(v.y));ctx.stroke();ctx.setLineDash([]);if(v.label){ctx.fillStyle=v.color||muted;ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(v.label,pad.l+4,Y(v.y)-2);}}
  ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,W-pad.l-pad.r,H-pad.t-pad.b);ctx.clip();
  for(const s of cfg.series){const YY=s.y2?Y2:Y;ctx.strokeStyle=s.color;ctx.lineWidth=s.w||1.8;ctx.setLineDash(s.dash||[]);ctx.globalAlpha=s.alpha||1;
    if(s.fill!==undefined){ctx.fillStyle=s.fillColor||s.color;ctx.globalAlpha=s.fillAlpha||0.14;ctx.beginPath();let st=false;for(let i=0;i<s.x.length;i++){if(!isF(s.y[i]))continue;const px=X(s.x[i]),py=YY(s.y[i]);if(!st){ctx.moveTo(px,YY(s.fill));ctx.lineTo(px,py);st=true;}else ctx.lineTo(px,py);}
      if(st){ctx.lineTo(X(s.x[s.x.length-1]),YY(s.fill));ctx.closePath();ctx.fill();}ctx.globalAlpha=s.alpha||1;}
    if(s.bars){ctx.fillStyle=s.color;const bw=s.bw||((X(s.x[1]??1)-X(s.x[0]??0))*0.7);for(let i=0;i<s.x.length;i++){const y0=YY(0),y1=YY(s.y[i]);ctx.fillRect(X(s.x[i])-bw/2,Math.min(y0,y1),bw,Math.abs(y1-y0));}}
    else if(s.dots){ctx.fillStyle=s.color;for(let i=0;i<s.x.length;i++){if(s.x[i]<x0||s.x[i]>x1||!isF(s.y[i]))continue;ctx.beginPath();ctx.arc(X(s.x[i]),YY(s.y[i]),s.r||3.5,0,6.283);if(s.hollow){ctx.lineWidth=1.6;ctx.stroke();}else ctx.fill();
      if(s.err){const e=s.err[i];ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(X(s.x[i]),YY(s.y[i]-e));ctx.lineTo(X(s.x[i]),YY(s.y[i]+e));ctx.stroke();}}}
    else if(s.step){ctx.beginPath();for(let i=0;i<s.x.length;i++){const px=X(s.x[i]),py=YY(s.y[i]);if(i===0)ctx.moveTo(px,py);else{ctx.lineTo(px,YY(s.y[i-1]));ctx.lineTo(px,py);}}ctx.stroke();}
    else{ctx.beginPath();let pen=false;for(let i=0;i<s.x.length;i++){const x=s.x[i];if(!isF(s.y[i])){pen=false;continue;}const px=X(x),py=YY(s.y[i]);if(!pen){ctx.moveTo(px,py);pen=true;}else ctx.lineTo(px,py);}ctx.stroke();}
    ctx.setLineDash([]);ctx.globalAlpha=1;}
  for(const v of (cfg.vlines||[])){ctx.strokeStyle=v.color||muted;ctx.setLineDash(v.dash||[4,3]);ctx.lineWidth=v.w||1.2;ctx.beginPath();ctx.moveTo(X(v.x),pad.t);ctx.lineTo(X(v.x),H-pad.b);ctx.stroke();ctx.setLineDash([]);
    if(v.label){ctx.fillStyle=v.color||muted;ctx.font='700 11.5px '+css('--disp');ctx.textAlign=X(v.x)>W*0.7?'right':'left';ctx.textBaseline='top';ctx.fillText(v.label,X(v.x)+(X(v.x)>W*0.7?-4:4),pad.t+2);}}
  for(const m of (cfg.markers||[])){const YY=m.y2?Y2:Y,px=X(m.x),py=YY(m.y),r=m.r||4.5;ctx.fillStyle=m.color;ctx.strokeStyle=css('--paper');ctx.lineWidth=1.3;ctx.beginPath();
    if(m.shape==='diamond'){ctx.moveTo(px,py-r-1.5);ctx.lineTo(px+r+1.5,py);ctx.lineTo(px,py+r+1.5);ctx.lineTo(px-r-1.5,py);ctx.closePath();}else if(m.shape==='tri'){ctx.moveTo(px,py-r-2);ctx.lineTo(px+r+1,py+r);ctx.lineTo(px-r-1,py+r);ctx.closePath();}else ctx.arc(px,py,r,0,6.283);
    if(m.hollow){ctx.strokeStyle=m.color;ctx.lineWidth=2;ctx.stroke();}else{ctx.fill();ctx.stroke();}
    if(m.label){ctx.fillStyle=m.lcolor||ink;ctx.font='700 11.5px '+css('--disp');ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(m.label,px,py-r-4);}}
  ctx.restore();
  if(cfg.cursor!==undefined&&cfg.cursor>=x0&&cfg.cursor<=x1&&!cfg.nohover){const cx=X(cfg.cursor);ctx.strokeStyle=ink;ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(cx,pad.t);ctx.lineTo(cx,H-pad.b);ctx.stroke();ctx.setLineDash([]);
    const rows=[[`${cfg.xname||'x'} = ${cfg.xfmt?cfg.xfmt(cfg.cursor):fmt(cfg.cursor,cfg.xdec||0)}`,ink]];
    for(const s of cfg.series){if(!s.name||!s.x.length)continue;const i=nearestIdx(s.x,cfg.cursor);if(Math.abs(s.x[i]-cfg.cursor)>(cfg.snap||Infinity))continue;const v=s.y[i];if(!isF(v))continue;rows.push([`${s.name}: ${fmt(v,s.dec??(Math.abs(v)<1?3:Math.abs(v)<100?2:1))}${s.unit?' '+s.unit:''}`,s.color]);
      ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(X(s.x[i]),(s.y2?Y2:Y)(v),3.5,0,6.283);ctx.fill();}
    ctx.font='600 12px '+css('--disp');const bw=Math.max(...rows.map(r=>ctx.measureText(r[0]).width))+16,bh=rows.length*16+8;let bx=cx+10;if(bx+bw>W-pad.r)bx=cx-10-bw;
    ctx.fillStyle=css('--paper');ctx.globalAlpha=0.95;ctx.fillRect(bx,pad.t+2,bw,bh);ctx.globalAlpha=1;ctx.strokeStyle=rule;ctx.strokeRect(bx,pad.t+2,bw,bh);ctx.textAlign='left';ctx.textBaseline='top';rows.forEach((r,i)=>{ctx.fillStyle=r[1];ctx.fillText(r[0],bx+8,pad.t+7+i*16);});}
  if(!cv._hooked){cv._hooked=true;const mv=e=>{const c=cv._cfg;if(!c||c.nohover)return;const r=cv.getBoundingClientRect();c.cursor=cv._inv(e.clientX-r.left);plot(cv,c);c.onHover&&c.onHover(c.cursor);};
    cv.addEventListener('pointermove',mv);cv.addEventListener('pointerdown',mv);cv.addEventListener('pointerleave',()=>{const c=cv._cfg;if(!c)return;c.cursor=undefined;plot(cv,c);c.onHover&&c.onHover(null);});}
  return {X,Y,W,H,pad,ctx};}

/* ---------- colour maps + grid painting ---------- */
const PALS={
  spectral:[[0,[43,48,140]],[0.14,[41,104,196]],[0.3,[74,168,196]],[0.45,[140,208,160]],[0.58,[232,232,150]],[0.72,[247,178,90]],[0.86,[222,90,56]],[1,[150,24,48]]],
  viridis:[[0,[68,1,84]],[0.25,[59,82,139]],[0.5,[33,145,140]],[0.75,[94,201,98]],[1,[253,231,37]]],
  div:[[0,[33,82,165]],[0.5,[244,244,242]],[1,[190,50,36]]],
  terrain:[[0,[42,98,74]],[0.3,[118,152,86]],[0.55,[198,186,122]],[0.8,[160,124,92]],[1,[244,240,234]]]};
const LUT={};for(const k in PALS){const s=PALS[k],L=new Uint8ClampedArray(768);for(let i=0;i<256;i++){const t=i/255;let j=1;while(j<s.length-1&&t>s[j][0])j++;const [a,ca]=s[j-1],[b,cb]=s[j],f=Math.max(0,Math.min(1,(t-a)/(b-a||1)));for(let q=0;q<3;q++)L[i*3+q]=ca[q]+(cb[q]-ca[q])*f;}LUT[k]=L;}
function colAt(pal,t){const i=Math.max(0,Math.min(255,Math.round(t*255)))*3,L=LUT[pal];return `rgb(${L[i]},${L[i+1]},${L[i+2]})`;}
function pctl(sorted,p){return sorted[Math.max(0,Math.min(sorted.length-1,Math.round(p*(sorted.length-1))))];}
/* paint grid {nx,ny,z} (row 0 = south) into rect; opts {pal,stretch:'lin'|'hist'|'sym',shade,lo,hi} returns {lo,hi,q} */
function paintGrid(ctx,x,y,w,h,g,o){o=Object.assign({pal:'spectral',stretch:'lin',shade:true},o);const {nx,ny,z}=g,n=z.length;const s=Float64Array.from(z).sort();let t=new Float64Array(n),lo,hi,q;
  if(o.stretch==='sym'){const m=o.hi??(Math.max(Math.abs(pctl(s,0.01)),Math.abs(pctl(s,0.99)))||1);lo=-m;hi=m;for(let i=0;i<n;i++)t[i]=0.5+0.5*z[i]/m;q=[-m,-m/2,0,m/2,m];}
  else if(o.stretch==='hist'){for(let i=0;i<n;i++){let a=0,b=n-1;const v=z[i];while(a<b){const m=(a+b)>>1;if(s[m]<v)a=m+1;else b=m;}t[i]=a/(n-1);}lo=s[0];hi=s[n-1];q=[0,.25,.5,.75,1].map(p=>pctl(s,p));}
  else{lo=o.lo??pctl(s,0.005);hi=o.hi??pctl(s,0.995);const d=(hi-lo)||1;for(let i=0;i<n;i++)t[i]=(z[i]-lo)/d;q=[0,.25,.5,.75,1].map(p=>lo+p*d);}
  const dpr=Math.min(2,window.devicePixelRatio||1),pw=Math.max(1,Math.round(w*dpr)),ph=Math.max(1,Math.round(h*dpr)),img=ctx.createImageData(pw,ph),d=img.data,L=LUT[o.pal];
  let sh=null;if(o.shade){sh=new Float64Array(n);const at=(r,c)=>t[Math.max(0,Math.min(ny-1,r))*nx+Math.max(0,Math.min(nx-1,c))];const gr=[];
    for(let r=0;r<ny;r++)for(let c=0;c<nx;c++)gr.push(Math.hypot(at(r,c+1)-at(r,c-1),at(r+1,c)-at(r-1,c)));const gs=pctl(Float64Array.from(gr).sort(),0.92)||1,ex=2.2/gs;
    for(let r=0;r<ny;r++)for(let c=0;c<nx;c++){const zx=ex*(at(r,c+1)-at(r,c-1))/2,zy=ex*(at(r+1,c)-at(r-1,c))/2;sh[r*nx+c]=Math.max(0.55,Math.min(1.18,0.9+(-0.6*zx+0.8*zy)/Math.hypot(zx,zy,1)*0.35));}}
  for(let py=0;py<ph;py++){const gy=(1-py/(ph-1))*(ny-1),r0=Math.min(ny-2,Math.floor(gy)),fy=gy-r0;
    for(let px=0;px<pw;px++){const gx=px/(pw-1)*(nx-1),c0=Math.min(nx-2,Math.floor(gx)),fx=gx-c0,i00=r0*nx+c0,w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
      let tv=t[i00]*w00+t[i00+1]*w10+t[i00+nx]*w01+t[i00+nx+1]*w11;tv=tv<0?0:tv>1?1:tv;const li=Math.round(tv*255)*3;let k=1;if(sh)k=sh[i00]*w00+sh[i00+1]*w10+sh[i00+nx]*w01+sh[i00+nx+1]*w11;
      const oo=(py*pw+px)*4;d[oo]=L[li]*k;d[oo+1]=L[li+1]*k;d[oo+2]=L[li+2]*k;d[oo+3]=255;}}
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.putImageData(img,Math.round(x*dpr),Math.round(y*dpr));ctx.restore();return {lo,hi,q};}
function cbar(cv,pal,q,units,dec){const {ctx,W}=setup(cv,34);for(let x=0;x<W;x++){ctx.fillStyle=colAt(pal,x/(W-1));ctx.fillRect(x,0,1.3,12);}
  ctx.fillStyle=css('--muted');ctx.font='500 12px '+css('--disp');ctx.textBaseline='top';q.forEach((v,i)=>{const x=i/(q.length-1)*W;ctx.textAlign=i===0?'left':i===q.length-1?'right':'center';const s=fmt(v,dec??(Math.abs(v)<1?2:1));ctx.fillText(i===q.length-1?s+' '+units:s,x,16);});}
function arrow(ctx,x1,y1,x2,y2,color,w=2,head=8){ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();const an=Math.atan2(y2-y1,x2-x1);
  if(Math.hypot(x2-x1,y2-y1)<2)return;ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-head*Math.cos(an-0.42),y2-head*Math.sin(an-0.42));ctx.lineTo(x2-head*Math.cos(an+0.42),y2-head*Math.sin(an+0.42));ctx.closePath();ctx.fill();}
/* horizontal log-scale bar chart; items {label,v,color,sub} */
function logBars(cv,items,cfg){const rowH=cfg.rowH||30,top=24,{ctx,W,H}=setup(cv,top+items.length*rowH+30);const lw=Math.min(W*0.46,cfg.labelW||230),x0=lw+10,x1=W-60;
  const lmin=Math.log10(cfg.min),lmax=Math.log10(cfg.max),X=v=>x0+(Math.log10(v)-lmin)/(lmax-lmin)*(x1-x0);
  ctx.font='500 11.5px '+css('--disp');ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=css('--muted');ctx.strokeStyle=css('--rule');
  for(let e=Math.ceil(lmin);e<=lmax;e++){const x=X(Math.pow(10,e));ctx.beginPath();ctx.moveTo(x,top-4);ctx.lineTo(x,H-26);ctx.stroke();ctx.fillText(cfg.tick?cfg.tick(e):('10'+String(e).replace('-','⁻').replace(/\d/g,d=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[d])),x,top-6);}
  items.forEach((it,i)=>{const y=top+i*rowH+5,bh=rowH-11;ctx.fillStyle=it.color;const xa=X(cfg.min);ctx.globalAlpha=it.faded?0.35:1;ctx.fillRect(xa,y,Math.max(2,X(it.v)-xa),bh);ctx.globalAlpha=1;
    ctx.fillStyle=css('--ink');ctx.textAlign='right';ctx.textBaseline='middle';ctx.font='600 13px '+css('--disp');ctx.fillText(it.label,lw,y+bh/2);
    ctx.textAlign='left';ctx.font='600 12px '+css('--mono');ctx.fillStyle=css('--ink');ctx.fillText(it.txt||fmt(it.v,it.v<1?3:0),X(it.v)+5,y+bh/2);});
  ctx.fillStyle=css('--muted');ctx.font='500 12px '+css('--disp');ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(cfg.xlabel||'',(x0+x1)/2,H-4);}

/* ===== generic app shell (used by both apps) ===== */
const ST={};  // per-chapter state
const HANNOVER={lat:52.3803,lon:9.7236,h:60};
const IC={
 apple:'<path d="M12 7c-2-2.2-6-1.4-6 3.2 0 4.3 3 8.8 6 8.8s6-4.5 6-8.8C18 5.6 14 4.8 12 7z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7c0-2 1-3.5 3-4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
 arrow:'<path d="M12 3v15M6 12l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
 layers:'<path d="M12 3 3 8l9 5 9-5z M3 12.5l9 5 9-5 M3 16.5l9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
 globe:'<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="8.5" ry="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 3.5v17" stroke="currentColor" stroke-width="1.4"/>',
 spring:'<path d="M12 2v3 l-4 1.5 8 3-8 3 8 3-4 1.5v2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="20" r="2.5" fill="currentColor"/>',
 level:'<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13.5" cy="10.8" r="2" fill="currentColor"/>',
 moon:'<path d="M15 3a8 8 0 1 0 6 12A7 7 0 0 1 15 3z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
 clock:'<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
 map:'<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
 grid:'<path d="M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16" fill="none" stroke="currentColor" stroke-width="1.5"/>',
 target:'<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
 ruler:'<path d="M3 16 16 3l5 5L8 21z M7 12l2 2 M10 9l2 2 M13 6l2 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
 mountain:'<path d="M2 20 9 7l4 6 3-4 6 11z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
 filter:'<path d="M3 5h18l-7 8v6l-4 2v-8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
 cube:'<path d="M12 2 21 7v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
 drop:'<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
 volcano:'<path d="M2 21 8 10h8l6 11z M10 10l1-3M14 10l-1-3M12 5V2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>',
 wave:'<path d="M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0 3.5-4 5-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
 scale:'<path d="M12 3v18 M5 21h14 M4 8h16 M4 8l-2.5 6h5z M20 8l-2.5 6h5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
 network:'<circle cx="5" cy="6" r="2.2" fill="currentColor"/><circle cx="19" cy="7" r="2.2" fill="currentColor"/><circle cx="12" cy="18" r="2.2" fill="currentColor"/><path d="M5 6l14 1-7 11z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
 check:'<path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
 sat:'<path d="M5 19 19 5 M8 8l-4 4 4 4 4-4z M16 8l4 4-4 4-4-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
 play:'<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
 tool:'<path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'};
const icon=(k,s=20)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${IC[k]||IC.check}</svg>`;

let APPI=null;
function makeApp(CFG){const CH=CFG.chapters;let cur=0;const KEY='gl-progress-'+(CFG.store||'app');let saved=[];try{saved=JSON.parse(localStorage.getItem(KEY)||'[]');}catch(e){}const visited=new Set(Array.isArray(saved)?saved:[]);
  const save=()=>{try{localStorage.setItem(KEY,JSON.stringify([...visited]));}catch(e){}};const MCS={};
  function renderRail(){$('rail').innerHTML=CFG.sections.map(([k,name])=>`<div class="rgroup"><div class="rhead">${name}</div>${CH.filter(c=>c.sec===k).map(c=>`<button type="button" class="ritem" data-id="${c.id}"><span class="rc">${c.id}</span><span>${c.short}</span></button>`).join('')}</div>`).join('');
    $('rail').querySelectorAll('.ritem').forEach(b=>b.addEventListener('click',()=>go(b.dataset.id,true)));}
  function mark(){$('rail').querySelectorAll('.ritem').forEach(b=>{const on=b.dataset.id===CH[cur].id;if(on)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');b.classList.toggle('done',visited.has(b.dataset.id)&&!on);});
    const el=$('rail').querySelector('[aria-current="step"]');if(el&&window.innerWidth<1200){const rl=$('rail');rl.scrollTo({left:el.offsetLeft-rl.clientWidth/2+el.clientWidth/2,behavior:'smooth'});}
    $('progBar').style.width=(100*(cur+1)/CH.length)+'%';}
  function render(){const c=CH[cur],secName=(CFG.sections.find(s=>s[0]===c.sec)||['',''])[1];const mn=$('main');mn.classList.remove('enter');void mn.offsetWidth;mn.classList.add('enter');
    $('chead').dataset.code=c.id;const mods=CFG.sections.map(x=>x[0]),mi=mods.indexOf(c.sec),inMod=CH.filter(x=>x.sec===c.sec),ci=inMod.indexOf(c);
    const track=`<div class="mtrack" aria-label="Chapters in this module"><span class="mpos">Module ${mi+1} of ${mods.length} · chapter ${ci+1} of ${inMod.length}</span><span class="mchips">${inMod.map(x=>`<button type="button" class="mchip${x===c?' on':''}${visited.has(x.id)&&x!==c?' seen':''}" data-go="${x.id}" title="${x.short}">${x.id}</button>`).join('')}</span></div>`;
    $('chead').innerHTML=`${track}<span class="csec"><i>${c.id}</i>${MU(secName)}</span><h2>${c.title}</h2><p class="tagl">${c.tag}</p>${c.goal?`<p class="goal"><span>${icon('target',16)}</span><span><b>You will</b> ${c.goal}</span></p>`:''}`;
    $('figs').innerHTML=c.figs.map((f,i)=>`<section class="panel" id="fig${i}"><p class="ptitle">${f.title}</p>${f.sub?`<p class="psub">${f.sub}</p>`:''}${f.html()}</section>`).join('');
    const ideas=(c.ideas||[]).map(([ic,t,d])=>`<div class="idea"><span class="ic">${icon(ic)}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('');
    $('ideas').innerHTML=`<div class="ideas">${ideas}${(c.eqs||[]).join('')}${c.tries&&c.tries.length?`<div class="try"><h4>${icon('play',13)}Try this</h4><ol>${c.tries.map(t=>`<li>${t}</li>`).join('')}</ol></div>`:''}${(c.notes||[]).join('')}</div>`;
    $('deeper').innerHTML=(c.deeper||[]).map(([t,h])=>`<details><summary>${t}</summary><div class="dd">${h}</div></details>`).join('');
    const mcs=c.mc||[];$('quiz').innerHTML=(mcs.length||(c.quiz&&c.quiz.length))?`<p class="qhead">Check yourself</p>`+mcs.map((m,k)=>`<div class="mcq" data-k="${k}"><p class="mq">${m[0]}</p><div class="mopts">${m[1].map((o,j)=>`<button type="button" class="mopt" data-j="${j}">${o}</button>`).join('')}</div><p class="mfb" aria-live="polite"></p></div>`).join('')+(c.quiz||[]).map(([q,a])=>`<details class="qa"><summary>${q}</summary><div class="ans">${a}</div></details>`).join(''):'';
    $('quiz').querySelectorAll('.mcq').forEach(box=>{const m=mcs[+box.dataset.k];box.querySelectorAll('.mopt').forEach(b=>b.onclick=()=>{const j=+b.dataset.j,ok=j===m[2];box.querySelectorAll('.mopt').forEach(x=>{x.classList.remove('right','wrong');if(+x.dataset.j===m[2]&&ok)x.classList.add('right');});b.classList.add(ok?'right':'wrong');
      box.querySelector('.mfb').innerHTML=(ok?'<b class="okt">Correct.</b> ':'<b class="not">Not quite, try again.</b> ')+(ok?m[3]:'');MCS[c.id+':'+box.dataset.k]=ok;});});
    const prev=CH[cur-1],next=CH[cur+1];$('navBtns').innerHTML=`<button class="btn" type="button" id="prevB" ${prev?'':'disabled'}>${prev?'← '+prev.id+' '+prev.short:'Start'}</button><button class="btn primary" type="button" id="nextB" ${next?'':'disabled'}>${next?next.id+' '+next.short+' →':'End'}</button>`;
    $('prevB').onclick=()=>prev&&go(prev.id,true);$('nextB').onclick=()=>next&&go(next.id,true);
    c.figs.forEach(f=>{try{f.draw();}catch(e){console.error(c.id,e);}});
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go,true));}
  function go(id,scroll){id=(CFG.alias&&CFG.alias[id])||id;const i=CH.findIndex(c=>c.id===id);if(i<0)return;cur=i;visited.add(id);save();mark();render();try{history.replaceState(null,'','#'+id);}catch(e){}
    if(scroll){const y=$('chead').getBoundingClientRect().top+window.scrollY-58;window.scrollTo({top:Math.max(0,y),behavior:'smooth'});}}
  function redraw(){CH[cur].figs.forEach(f=>{try{f.draw();}catch(e){console.error(e);}});}
  function init(){renderRail();document.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>go(b.dataset.start,true));
    let h=decodeURIComponent((location.hash||'').replace('#',''));h=(CFG.alias&&CFG.alias[h])||h;go(CH.some(c=>c.id===h)?h:CH[0].id,false);
    let rt=0,lw=window.innerWidth;window.addEventListener('resize',()=>{if(window.innerWidth===lw)return;lw=window.innerWidth;clearTimeout(rt);rt=setTimeout(()=>{redraw();CFG.heroSize&&CFG.heroSize();},160);});
    if(window.matchMedia)window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',redraw);
    window.addEventListener('hashchange',()=>{let id=decodeURIComponent((location.hash||'').replace('#',''));id=(CFG.alias&&CFG.alias[id])||id;if(CH.some(c=>c.id===id)&&id!==CH[cur].id)go(id,true);});
    document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='ArrowRight'&&CH[cur+1])go(CH[cur+1].id,false);if(e.key==='ArrowLeft'&&CH[cur-1])go(CH[cur-1].id,false);});
    CFG.heroInit&&CFG.heroInit();}
  function map(el){if(!el)return;el.innerHTML=`<div class="cmap">${CFG.sections.map(([k,name,ic,blurb],i)=>{const cs=CH.filter(x=>x.sec===k),done=cs.filter(x=>visited.has(x.id)).length;
      return `<div class="cmod"><div class="cmh"><span class="cmn">${i+1}</span><span class="cmi">${icon(ic||'check',22)}</span></div><b>${name}</b>${blurb?`<p>${blurb}</p>`:''}<div class="cmbar"><span style="width:${Math.round(100*done/cs.length)}%"></span></div><div class="cml">${cs.map(x=>`<button type="button" class="cmc${visited.has(x.id)?' seen':''}" data-go="${x.id}"><i>${x.id}</i>${x.short}</button>`).join('')}</div></div>`;}).join('')}</div>`;
    el.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go,true));}
  function reset(){visited.clear();save();mark();render();}
  APPI={go,init,redraw,map,reset};return APPI;}
function courseMap(id){APPI&&APPI.map($(id));}

