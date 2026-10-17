/* GRAVLAB core: physics and numerics, from "Static Gravity Lab" by Mohamed Sobh, LIAG (reused unchanged except
   for the optional gravimetric factor of longman()). */
/* ===== GRAVLAB core: physics + numerics (no DOM) ===== */
const GL=(function(){
"use strict";
const G=6.67430e-11;            // CODATA 2018, m^3 kg^-1 s^-2
const SI2MGAL=1e5, SI2UGAL=1e8;
const D2R=Math.PI/180;

/* ---------- reference Earth (GRS80, Moritz 2000) ---------- */
const GRS80={a:6378137,ge:9.7803267715,k:0.001931851353,e2:0.00669438002290,gp:9.8321863685};
function normalGravity(latDeg){const s2=Math.sin(latDeg*D2R)**2;return GRS80.ge*(1+GRS80.k*s2)/Math.sqrt(1-GRS80.e2*s2)*SI2MGAL;} // mGal
function normalGradNS(latDeg){return 0.8140*Math.sin(2*latDeg*D2R);} // mGal per km toward north (approx.)
/* height correction, Hinze et al. (2005): positive number to ADD to observed gravity */
function freeAir(h,latDeg){const s2=Math.sin(latDeg*D2R)**2;return (0.3087691-0.0004398*s2)*h-7.2125e-8*h*h;}
const FA_SIMPLE=0.3086;         // mGal/m
function bouguerFactor(rho){return 2*Math.PI*G*rho*1000*SI2MGAL;} // mGal per m, rho in g/cm3
function bouguer(rho,h){return bouguerFactor(rho)*h;}
function atmCorr(h){return 0.874-9.9e-5*h+3.56e-9*h*h;} // mGal (Hinze et al. 2005)
function bullardB(h){return 1.464e-3*h-3.533e-7*h*h+4.5e-14*h*h*h;} // mGal, rho=2.67 (Whitman 1991 approximation)
function pressureNormal(H){return 1013.25*Math.pow(1-0.0065*H/288.15,5.2559);} // hPa (DIN 5450)

/* ---------- Longman (1959) Earth tide, ported from LongmanTide (J. Leeman / Z. Brady) ----------
   returns g0 in mGal: the tidal CORRECTION to be added to readings (effect on readings = -g0).
   Includes the gravimetric factor 1 + h2 - 1.5 k2 = 1.1575. */
function longman(lat,lon,alt,utcMs,factor){
  const mu=6.673e-8,Mm=7.3537e25,Ss=1.993e33,e=0.05490,m=0.074804,c=3.84402e10,c1=1.495e13,love=factor||(1+0.612-1.5*0.303),a=6.378270e8,i=0.08979719,om=23.452*D2R;
  const origin=Date.UTC(1899,11,31,12,0,0),days=(utcMs-origin)/86400000,T=days/36525,T2=T*T,T3=T2*T;
  const d0=new Date(utcMs);let t0=d0.getUTCHours()+d0.getUTCMinutes()/60+d0.getUTCSeconds()/3600+d0.getUTCMilliseconds()/3.6e6;
  const phi=-lon,la=lat*D2R,cl=Math.cos(la),sl=Math.sin(la),H=alt*100;
  const s=4.72000889397+8399.70927456*T+3.45575191895e-05*T2+3.49065850399e-08*T3;
  const p=5.83515162814+71.0180412089*T+0.000180108282532*T2+1.74532925199e-07*T3;
  const h=4.88162798259+628.331950894*T+5.23598775598e-06*T2;
  const N=4.52360161181-33.757146295*T+3.6264063347e-05*T2+3.39369576777e-08*T3,cN=Math.cos(N),sN=Math.sin(N);
  const I=Math.acos(Math.cos(om)*Math.cos(i)-Math.sin(om)*Math.sin(i)*cN);
  const nu=Math.asin(Math.sin(i)*sN/Math.sin(I));
  const t=(15*(t0-12)-phi)*D2R;
  const chi=t+h-nu;
  const ca=cN*Math.cos(nu)+sN*Math.sin(nu)*Math.cos(om),sa=Math.sin(om)*sN/Math.sin(I),al=2*Math.atan(sa/(1+ca));
  const xi=N-al,sig=s-xi;
  const l=sig+2*e*Math.sin(s-p)+1.25*e*e*Math.sin(2*(s-p))+3.75*m*e*Math.sin(s-2*h+p)+(11/8)*m*m*Math.sin(2*(s-h));
  const p1=4.90822941839+0.0300025492114*T+7.85398163397e-06*T2+5.3329504922e-08*T3;
  const e1=0.01675104-0.00004180*T-0.000000126*T2;
  const chi1=t+h,l1=h+2*e1*Math.sin(h-p1);
  const cth=sl*Math.sin(I)*Math.sin(l)+cl*(Math.cos(0.5*I)**2*Math.cos(l-chi)+Math.sin(0.5*I)**2*Math.cos(l+chi));
  const cph=sl*Math.sin(om)*Math.sin(l1)+cl*(Math.cos(0.5*om)**2*Math.cos(l1-chi1)+Math.sin(0.5*om)**2*Math.cos(l1+chi1));
  const C=Math.sqrt(1/(1+0.006738*sl*sl)),r=C*a+H;
  const ap=1/(c*(1-e*e)),ap1=1/(c1*(1-e1*e1));
  const d=1/((1/c)+ap*e*Math.cos(s-p)+ap*e*e*Math.cos(2*(s-p))+(15/8)*ap*m*e*Math.cos(s-2*h+p)+ap*m*m*Math.cos(2*(s-h)));
  const D=1/((1/c1)+ap1*e1*Math.cos(h-p1));
  const gm=(mu*Mm*r/d**3)*(3*cth*cth-1)+1.5*(mu*Mm*r*r/d**4)*(5*cth**3-3*cth);
  const gs=mu*Ss*r/D**3*(3*cph*cph-1);
  return {moon:gm*1e3*love,sun:gs*1e3*love,total:(gm+gs)*1e3*love};}

/* ---------- forward models ---------- */
// sphere: x horizontal offset (m), z depth to centre (m), R radius (m), drho g/cc -> mGal
function sphere(x,z,R,drho){return 4/3*Math.PI*G*drho*1000*R*R*R*z/Math.pow(x*x+z*z,1.5)*SI2MGAL;}
// infinite horizontal cylinder (2-D)
function cylinder(x,z,R,drho){return 2*Math.PI*G*drho*1000*R*R*z/(x*x+z*z)*SI2MGAL;}
// thin semi-infinite horizontal sheet (fault step), thickness t, depth z to its centre, edge at x0, sheet extends to +x
function faultSheet(x,x0,z,t,drho){return 2*G*drho*1000*t*(Math.PI/2+Math.atan((x-x0)/z))*SI2MGAL;}
// point mass (kg) at depth d, radial distance r: vertical attraction, microGal
function pointMassUgal(r,d,M){return G*M*d/Math.pow(r*r+d*d,1.5)*SI2UGAL;}
/* 2-D polygon (Talwani et al. 1959; Blakely 1995 gpoly). xs,zs in m, z positive DOWN, vertices CLOCKWISE (x right, z down).
   returns mGal for density rho (g/cc) at station (x0,z0). */
function poly2d(x0,z0,xs,zs,rho){let sum=0;const n=xs.length;
  for(let k=0;k<n;k++){const k2=(k+1)%n;const x1=xs[k]-x0,z1=zs[k]-z0,x2=xs[k2]-x0,z2=zs[k2]-z0;
    const r1=x1*x1+z1*z1,r2=x2*x2+z2*z2;if(r1===0||r2===0)continue;
    let den=z2-z1;if(den===0)den=1e-9;const alpha=(x2-x1)/den,beta=(x1*z2-x2*z1)/den,fac=beta/(1+alpha*alpha);
    let th=Math.atan2(z2,x2)-Math.atan2(z1,x1);if(th>Math.PI)th-=2*Math.PI;if(th<-Math.PI)th+=2*Math.PI;
    sum+=fac*(0.5*Math.log(r2/r1)-alpha*th);}
  return 2*rho*1000*G*sum*SI2MGAL;}
/* Hammer (1939) ring-sector: mean height difference dh (m), radii r1<r2 (m), n sectors, rho g/cc -> mGal */
function hammerSector(r1,r2,n,dh,rho){dh=Math.abs(dh);return 2*Math.PI*G*rho*1000/n*((r2-r1)+Math.sqrt(r1*r1+dh*dh)-Math.sqrt(r2*r2+dh*dh))*SI2MGAL;}
const HAMMER=[['B',2,16.6,4],['C',16.6,53.3,6],['D',53.3,170.1,6],['E',170.1,390.1,8],['F',390.1,894.8,8],['G',894.8,1529.4,12],['H',1529.4,2614.4,12],['I',2614.4,4468.8,12],['J',4468.8,6652.2,16]];
/* Mogi (1958) point source, Poisson ratio nu: vertical surface displacement (m) */
function mogiUz(r,d,dV,nu=0.25){return (1-nu)*dV/Math.PI*d/Math.pow(r*r+d*d,1.5);}

/* ---------- FFT and 2-D spectral filters ---------- */
function fft(re,im,inv){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
  for(let len=2;len<=n;len<<=1){const a=(inv?2:-2)*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);
    for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const p=i+k,q=p+len/2,xr=re[q]*cr-im[q]*ci,xi=re[q]*ci+im[q]*cr;re[q]=re[p]-xr;im[q]=im[p]-xi;re[p]+=xr;im[p]+=xi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}
  if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}}
function fft2(re,im,Nx,Ny,inv){const rr=new Float64Array(Nx),ri=new Float64Array(Nx),cr=new Float64Array(Ny),ci=new Float64Array(Ny);
  for(let r=0;r<Ny;r++){const o=r*Nx;for(let c=0;c<Nx;c++){rr[c]=re[o+c];ri[c]=im[o+c];}fft(rr,ri,inv);for(let c=0;c<Nx;c++){re[o+c]=rr[c];im[o+c]=ri[c];}}
  for(let c=0;c<Nx;c++){for(let r=0;r<Ny;r++){cr[r]=re[r*Nx+c];ci[r]=im[r*Nx+c];}fft(cr,ci,inv);for(let r=0;r<Ny;r++){re[r*Nx+c]=cr[r];im[r*Nx+c]=ci[r];}}}
/* grid g={nx,ny,cell,z}; filter F(kx,ky,k) returns [re,im] multiplier; k in rad/m. Cosine-tapered padding. */
function specFilter(g,F){const {nx,ny,cell,z}=g;let Nx=1,Ny=1;while(Nx<nx+32)Nx<<=1;while(Ny<ny+32)Ny<<=1;
  const ox=(Nx-nx)>>1,oy=(Ny-ny)>>1,pw=Math.max(6,Math.min(ox,oy)-1);let mean=0;for(const v of z)mean+=v;mean/=z.length;
  const re=new Float64Array(Nx*Ny),im=new Float64Array(Nx*Ny);
  for(let r=0;r<Ny;r++)for(let c=0;c<Nx;c++){const rr=Math.max(0,Math.min(ny-1,r-oy)),cc=Math.max(0,Math.min(nx-1,c-ox)),d=Math.hypot(r-oy-rr,c-ox-cc);
    const w=d>=pw?0:0.5*(1+Math.cos(Math.PI*d/pw));re[r*Nx+c]=(z[rr*nx+cc]-mean)*w;}
  fft2(re,im,Nx,Ny,false);
  for(let r=0;r<Ny;r++){const ky=2*Math.PI*(r<=Ny/2?r:r-Ny)/(Ny*cell);for(let c=0;c<Nx;c++){const kx=2*Math.PI*(c<=Nx/2?c:c-Nx)/(Nx*cell),k=Math.hypot(kx,ky),i=r*Nx+c;
    const [a,b]=F(kx,ky,k,r===0&&c===0);const x=re[i],y=im[i];re[i]=x*a-y*b;im[i]=x*b+y*a;}}
  fft2(re,im,Nx,Ny,true);const out=new Float64Array(nx*ny);for(let r=0;r<ny;r++)for(let c=0;c<nx;c++)out[r*nx+c]=re[(r+oy)*Nx+c+ox];
  return {out,mean};}
const FILT={
  up:h=>(kx,ky,k,dc)=>dc?[1,0]:[Math.exp(-k*h),0],
  vd:cell=>(kx,ky,k)=>[k/(1+Math.pow(k*2.5*cell/(2*Math.PI),8)),0],
  dx:cell=>(kx,ky,k)=>[0,kx/(1+Math.pow(k*2.5*cell/(2*Math.PI),8))],
  dy:cell=>(kx,ky,k)=>[0,ky/(1+Math.pow(k*2.5*cell/(2*Math.PI),8))],
  lowpass:(lam,n=4)=>(kx,ky,k,dc)=>[dc?1:1/(1+Math.pow(k*lam/(2*Math.PI),2*n)),0],
  highpass:(lam,n=4)=>(kx,ky,k,dc)=>[dc?0:1-1/(1+Math.pow(k*lam/(2*Math.PI),2*n)),0]};

/* ---------- least squares ---------- */
function cholSolve(N,b){const n=b.length,L=N.map(r=>r.slice());
  for(let j=0;j<n;j++){let s=L[j][j];for(let k=0;k<j;k++)s-=L[j][k]*L[j][k];if(s<=0)throw new Error('singular');L[j][j]=Math.sqrt(s);
    for(let i=j+1;i<n;i++){let t=L[i][j];for(let k=0;k<j;k++)t-=L[i][k]*L[j][k];L[i][j]=t/L[j][j];}}
  const fw=v=>{const y=new Array(n);for(let i=0;i<n;i++){let s=v[i];for(let k=0;k<i;k++)s-=L[i][k]*y[k];y[i]=s/L[i][i];}return y;};
  const bw=y=>{const x=new Array(n);for(let i=n-1;i>=0;i--){let s=y[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}return x;};
  const x=bw(fw(b));const inv=[];for(let j=0;j<n;j++){const e=new Array(n).fill(0);e[j]=1;inv.push(bw(fw(e)));}
  return {x,Qxx:inv};}
/* weighted LSQ: rows A (arrays), l, sigma (per obs). returns x, Qxx, residuals v=Ax-l, normalized w, s0^2 */
function lsq(A,l,sig){const n=A.length,u=A[0].length,N=Array.from({length:u},()=>new Array(u).fill(0)),b=new Array(u).fill(0);
  for(let i=0;i<n;i++){const p=1/(sig[i]*sig[i]),a=A[i];for(let j=0;j<u;j++){if(!a[j])continue;b[j]+=a[j]*p*l[i];for(let k=0;k<u;k++)if(a[k])N[j][k]+=a[j]*p*a[k];}}
  const {x,Qxx}=cholSolve(N,b);const v=[],w=[],qvv=[];let vpv=0;
  for(let i=0;i<n;i++){const a=A[i];let ax=0;for(let j=0;j<u;j++)ax+=a[j]*x[j];const vi=ax-l[i];v.push(vi);vpv+=vi*vi/(sig[i]*sig[i]);
    let q=0;for(let j=0;j<u;j++)if(a[j])for(let k=0;k<u;k++)if(a[k])q+=a[j]*Qxx[j][k]*a[k];const qv=Math.max(1e-12,sig[i]*sig[i]-q);qvv.push(qv);w.push(vi/Math.sqrt(qv));}
  const f=n-u;return {x,Qxx,v,w,qvv,vpv,f,s02:f>0?vpv/f:NaN};}
/* normal & chi-square quantiles */
function normInv(p){const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00],
  b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01],c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00],d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  const pl=0.02425;let q,r;if(p<pl){q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p>1-pl){q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  q=p-0.5;r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
function chi2Inv(p,f){const z=normInv(p),h=2/(9*f);return f*Math.pow(1-h+z*Math.sqrt(h),3);} // Wilson-Hilferty

/* ---------- misc ---------- */
function rng(seed){let a=seed>>>0;const R=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
  R.gauss=()=>{let u=0,v=0;while(u===0)u=R();while(v===0)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};return R;}
function polyfit(xs,ys,deg){const n=deg+1,N=Array.from({length:n},()=>new Array(n).fill(0)),b=new Array(n).fill(0);
  const xm=xs.reduce((s,v)=>s+v,0)/xs.length,xsd=Math.max(1e-9,Math.sqrt(xs.reduce((s,v)=>s+(v-xm)**2,0)/xs.length));
  xs.forEach((x0,i)=>{const x=(x0-xm)/xsd,p=[];let q=1;for(let k=0;k<n;k++){p.push(q);q*=x;}for(let j=0;j<n;j++){b[j]+=p[j]*ys[i];for(let k=0;k<n;k++)N[j][k]+=p[j]*p[k];}});
  const {x:c}=cholSolve(N,b);return x0=>{const x=(x0-xm)/xsd;let s=0,q=1;for(let k=0;k<n;k++){s+=c[k]*q;q*=x;}return s;};}
function corr(a,b){const n=a.length;let ma=0,mb=0;for(let i=0;i<n;i++){ma+=a[i];mb+=b[i];}ma/=n;mb/=n;let sab=0,saa=0,sbb=0;
  for(let i=0;i<n;i++){const x=a[i]-ma,y=b[i]-mb;sab+=x*y;saa+=x*x;sbb+=y*y;}return sab/Math.sqrt(saa*sbb);}

return {G,SI2MGAL,SI2UGAL,D2R,GRS80,normalGravity,normalGradNS,freeAir,FA_SIMPLE,bouguerFactor,bouguer,atmCorr,bullardB,pressureNormal,
  longman,sphere,cylinder,faultSheet,pointMassUgal,poly2d,hammerSector,HAMMER,mogiUz,fft,fft2,specFilter,FILT,cholSolve,lsq,normInv,chi2Inv,rng,polyfit,corr};
})();


